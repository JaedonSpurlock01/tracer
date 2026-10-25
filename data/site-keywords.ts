/**
 * -------------------------------------------------------------------------
 * @file   site-keywords.ts
 * @brief  Edits a Site's Service Area and Keywords under authorization.
 *
 * @description
 *  Lists a Site's Service Area, live Keywords, and last Keyword Suggestion
 *  set for anyone who can read its linked Workspace, and lets an Operator set the Service Area, add a
 *  Keyword with a phrase and a weight from 1 to 5, change a weight, and
 *  remove a Keyword. Phrases are trimmed and unique per Site without
 *  regard to case, and a Site keeps at most 25 live Keywords.
 *
 * @remarks
 *  Removal sets `removed_at` rather than deleting, so stored rank days
 *  stay as history and the runtime role needs no DELETE grant; the
 *  partial unique index frees the phrase for a new Keyword. The country
 *  defaults to United States because every Site serves one. Adds are
 *  serialized per Site with an advisory lock so the limit holds under
 *  concurrent requests.
 *
 * @see
 *  data/keyword-discovery.ts
 *  data/site-search.ts
 *  data/rank-check.ts
 *  data/workspace-authorization.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Database, Queryable } from "@/data/database";

import { AuthorizationError, type Actor } from "@/data/authorization";
import { withoutTrackedPhrases, type KeywordSuggestionSet } from "@/data/keyword-discovery";
import { canManageWorkspaces, readableWorkspaceSql } from "@/data/workspace-authorization";

/** Where a Site's business serves: a DataForSEO location picked by the Operator, with its name split for display. */
export interface ServiceArea {
  city: string | null;
  region: string | null;
  country: string | null;
  locationCode: number | null;
  locationName: string | null;
}

export interface SiteKeywordRecord {
  id: string;
  phrase: string;
  weight: number;
  createdAt: string;
}

export type SiteKeywordsErrorCode = "invalid_input" | "not_found" | "duplicate_phrase" | "keyword_limit";

export class SiteKeywordsError extends Error {
  constructor(public readonly code: SiteKeywordsErrorCode) {
    super(code);
    this.name = "SiteKeywordsError";
  }
}

export interface SiteKeywords {
  list(siteId: string): Promise<{ serviceArea: ServiceArea; keywords: SiteKeywordRecord[]; suggestions: KeywordSuggestionSet | null }>;
  add(siteId: string, input: { phrase: unknown; weight?: unknown }): Promise<SiteKeywordRecord>;
  update(siteId: string, keywordId: string, input: { weight: unknown }): Promise<SiteKeywordRecord>;
  remove(siteId: string, keywordId: string): Promise<void>;
  setServiceArea(siteId: string, input: { locationCode: unknown; locationName: unknown }): Promise<ServiceArea>;
}

export const siteKeywordLimit = 25;
export const defaultServiceAreaCountry = "United States";
const phraseMaxLength = 120;
const locationNameMaxLength = 160;

type KeywordRow = { id: string; phrase: string; weight: number; created_at: Date };
type ServiceAreaRow = { service_area_city: string | null; service_area_region: string | null; service_area_country: string | null; service_area_location_code: number | null; service_area_location_name: string | null };
export const serviceAreaColumns = "service_area_city, service_area_region, service_area_country, service_area_location_code, service_area_location_name";

function toKeyword(row: KeywordRow): SiteKeywordRecord {
  return { id: row.id, phrase: row.phrase, weight: row.weight, createdAt: row.created_at.toISOString() };
}

export function toServiceArea(row: ServiceAreaRow): ServiceArea {
  return {
    city: row.service_area_city,
    region: row.service_area_region,
    country: row.service_area_country ?? defaultServiceAreaCountry,
    locationCode: row.service_area_location_code,
    locationName: row.service_area_location_name,
  };
}

/** DataForSEO names a location "City,Region,Country"; the parts keep the display and the legacy columns in step. */
export function splitLocationName(locationName: string): { city: string | null; region: string | null; country: string } {
  const parts = locationName.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1) return { city: null, region: null, country: parts[0] };
  if (parts.length === 2) return { city: null, region: parts[0], country: parts[1] };
  return { city: parts[0], region: parts.slice(1, -1).join(", "), country: parts[parts.length - 1] };
}

function parseWeight(value: unknown, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) throw new SiteKeywordsError("invalid_input");
  return value;
}

function parsePhrase(value: unknown): string {
  if (typeof value !== "string") throw new SiteKeywordsError("invalid_input");
  const phrase = value.trim().replace(/\s+/g, " ");
  if (!phrase || phrase.length > phraseMaxLength) throw new SiteKeywordsError("invalid_input");
  return phrase;
}

function parseLocation(input: { locationCode: unknown; locationName: unknown }): { code: number; name: string } {
  if (typeof input.locationCode !== "number" || !Number.isInteger(input.locationCode) || input.locationCode <= 0) throw new SiteKeywordsError("invalid_input");
  if (typeof input.locationName !== "string") throw new SiteKeywordsError("invalid_input");
  const name = input.locationName.trim();
  if (!name || name.length > locationNameMaxLength) throw new SiteKeywordsError("invalid_input");
  return { code: input.locationCode, name };
}

export function readableSiteSql(actor: Actor, siteAlias: string, scope: unknown[]): string {
  if (canManageWorkspaces(actor)) {
    scope.push(actor.organizationId);
    return `${siteAlias}.organization_id = $${scope.length}`;
  }
  return `exists (select 1 from site_link l join workspace w on w.id = l.workspace_id where l.site_id = ${siteAlias}.id and l.ended_at is null and ${readableWorkspaceSql(actor, scope)})`;
}

export function createSiteKeywords(database: Database, actor: Actor): SiteKeywords {
  const organizationId = actor.organizationId;

  function requireOperator(): void {
    if (!canManageWorkspaces(actor)) throw new AuthorizationError(403);
  }

  async function requireOperatorSite(client: Queryable, siteId: string): Promise<void> {
    requireOperator();
    const site = await client.query("select 1 from site where id = $1 and organization_id = $2 and removed_at is null", [siteId, organizationId]);
    if (!site.rowCount) throw new SiteKeywordsError("not_found");
  }

  async function requireKeyword(siteId: string, keywordId: string): Promise<void> {
    requireOperator();
    const result = await database.query(
      `select 1 from site_keyword k join site s on s.id = k.site_id
        where k.id = $1 and k.site_id = $2 and s.organization_id = $3 and k.removed_at is null`,
      [keywordId, siteId, organizationId],
    );
    if (!result.rowCount) throw new SiteKeywordsError("not_found");
  }

  return {
    async list(siteId) {
      const scope: unknown[] = [siteId];
      const site = await database.query<ServiceAreaRow & { keyword_suggestions: KeywordSuggestionSet | null }>(
        `select s.service_area_city, s.service_area_region, s.service_area_country, s.service_area_location_code, s.service_area_location_name, s.keyword_suggestions from site s where s.id = $1 and s.removed_at is null and ${readableSiteSql(actor, "s", scope)}`,
        scope,
      );
      if (!site.rows[0]) throw new SiteKeywordsError("not_found");
      const keywords = await database.query<KeywordRow>("select id, phrase, weight, created_at from site_keyword where site_id = $1 and removed_at is null order by created_at, id", [siteId]);
      const stored = site.rows[0].keyword_suggestions;
      return {
        serviceArea: toServiceArea(site.rows[0]),
        keywords: keywords.rows.map(toKeyword),
        suggestions: stored ? withoutTrackedPhrases(stored, keywords.rows.map((row) => row.phrase)) : null,
      };
    },

    async add(siteId, input) {
      requireOperator();
      const phrase = parsePhrase(input.phrase);
      const weight = parseWeight(input.weight, 1);
      return database.transaction(async (client) => {
        await requireOperatorSite(client, siteId);
        const live = await client.query<{ count: string; duplicate: boolean }>(
          "select count(*)::text as count, bool_or(lower(phrase) = lower($2)) as duplicate from site_keyword where site_id = $1 and removed_at is null",
          [siteId, phrase],
        );
        if (live.rows[0].duplicate) throw new SiteKeywordsError("duplicate_phrase");
        if (Number(live.rows[0].count) >= siteKeywordLimit) throw new SiteKeywordsError("keyword_limit");
        const now = new Date();
        const inserted = await client.query<KeywordRow>(
          "insert into site_keyword (id, site_id, phrase, weight, created_at, updated_at) values ($1, $2, $3, $4, $5, $5) returning id, phrase, weight, created_at",
          [randomUUID(), siteId, phrase, weight, now],
        );
        return toKeyword(inserted.rows[0]);
      }, { lock: `tracer:site-keywords:${siteId}` });
    },

    async update(siteId, keywordId, input) {
      const weight = parseWeight(input.weight);
      await requireKeyword(siteId, keywordId);
      const updated = await database.query<KeywordRow>("update site_keyword set weight = $2, updated_at = $3 where id = $1 and removed_at is null returning id, phrase, weight, created_at", [keywordId, weight, new Date()]);
      if (!updated.rows[0]) throw new SiteKeywordsError("not_found");
      return toKeyword(updated.rows[0]);
    },

    async remove(siteId, keywordId) {
      await requireKeyword(siteId, keywordId);
      const now = new Date();
      const removed = await database.query("update site_keyword set removed_at = $2, updated_at = $2 where id = $1 and removed_at is null", [keywordId, now]);
      if (!removed.rowCount) throw new SiteKeywordsError("not_found");
    },

    async setServiceArea(siteId, input) {
      await requireOperatorSite(database, siteId);
      const location = parseLocation(input);
      const parts = splitLocationName(location.name);
      const updated = await database.query<ServiceAreaRow>(
        `update site set service_area_city = $2, service_area_region = $3, service_area_country = $4, service_area_location_code = $5, service_area_location_name = $6, updated_at = $7
          where id = $1 and organization_id = $8 returning ${serviceAreaColumns}`,
        [siteId, parts.city, parts.region, parts.country, location.code, location.name, new Date(), organizationId],
      );
      if (!updated.rows[0]) throw new SiteKeywordsError("not_found");
      return toServiceArea(updated.rows[0]);
    },
  };
}
