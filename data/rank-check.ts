/**
 * -------------------------------------------------------------------------
 * @file   rank-check.ts
 * @brief  Checks every tracked Keyword's Google position once per day.
 *
 * @description
 *  For every Organization with a DataForSEO connection, for every Site
 *  that is not removed, has an open Site Link, and has a Service Area,
 *  looks up each live Keyword without a successful rank day for today,
 *  finds the best-placed result on the Site's primary hostname with or
 *  without www across the organic list, the local pack, and the map, and
 *  stores the position, ranking URL, matched SERP feature, and top ten
 *  results into `keyword_rank_day`, counts the lookup on the connection,
 *  and stamps the connection's last check time. A lookup that fails is
 *  stored on the day's row as a failed check with the provider's reason.
 *
 * @remarks
 *  The unique index on Keyword and day plus the "no successful row for
 *  today" filter make a rerun idempotent: a Keyword is never queried twice
 *  in a day once it succeeded, a failed Keyword is retried by the next run,
 *  and a Keyword added later in the day is picked up by the next run. The
 *  Service Area's DataForSEO location code is sent when the Operator picked
 *  one; the concatenated name remains for Sites set before the picker.
 *  One Keyword's failure is counted and never stops the others; provider
 *  errors go through the connection's credential wrapper so the
 *  Integrations page shows the failure. The month's lookups reset when
 *  the stored month differs from the current one. Days are UTC because
 *  the task runs once a day at a fixed UTC minute.
 *
 * @see
 *  trigger/rank-check.ts
 *  data/dataforseo-connection.ts
 *  data/dataforseo-client.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Database } from "@/data/database";

import type { DataForSeoClient, DataForSeoSerpItem } from "@/data/dataforseo-client";
import { createDataForSeoConnection, recordDataForSeoLookup, type DataForSeoConnection } from "@/data/dataforseo-connection";
import { IntegrationsError } from "@/data/integrations-error";

export interface RankCheckDeps {
  database: Database;
  dataforseo: DataForSeoClient;
  masterKey: string;
  now: Date;
  organizationId?: string;
}

export interface RankCheckResult {
  sites: number;
  keywords: number;
  checked: number;
  failed: number;
}

export const rankCheckTopResults = 10;

type KeywordRow = {
  id: string;
  phrase: string;
  site_id: string;
  primary_hostname: string;
  location_name: string;
  location_code: number | null;
  checked_today: boolean;
};

function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function bareHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

export function siteRank(items: DataForSeoSerpItem[], primaryHostname: string): { position: number | null; rankingUrl: string | null; matchedType: string | null } {
  const target = bareHostname(primaryHostname);
  const match = items
    .filter((item) => bareHostname(item.domain) === target)
    .sort((left, right) => left.position - right.position)[0];
  return match ? { position: match.position, rankingUrl: match.url, matchedType: match.type } : { position: null, rankingUrl: null, matchedType: null };
}

async function checkKeyword(deps: RankCheckDeps, connection: DataForSeoConnection, keyword: KeywordRow): Promise<void> {
  const location = keyword.location_code !== null ? { locationCode: keyword.location_code } : { locationName: keyword.location_name };
  const { items } = await connection.withDataForSeoCredential((credential) =>
    deps.dataforseo.serp(credential, { keyword: keyword.phrase, ...location, languageCode: "en", depth: 100 }),
  );
  const rank = siteRank(items, keyword.primary_hostname);
  await deps.database.query(
    `insert into keyword_rank_day (id, site_keyword_id, day, position, ranking_url, top_results, checked_at, check_status, failure_reason, matched_type)
     values ($1, $2, $3::date, $4, $5, $6::jsonb, $7, 'checked', null, $8)
     on conflict (site_keyword_id, day) do update set
       position = excluded.position, ranking_url = excluded.ranking_url, top_results = excluded.top_results, checked_at = excluded.checked_at,
       check_status = 'checked', failure_reason = null, matched_type = excluded.matched_type
     where keyword_rank_day.check_status = 'failed'`,
    [randomUUID(), keyword.id, utcDay(deps.now), rank.position, rank.rankingUrl, JSON.stringify(items.slice(0, rankCheckTopResults)), deps.now, rank.matchedType],
  );
}

/** Keeps the failed check on the day's row so the Site page can say why; a later run the same day replaces it. */
async function recordFailedCheck(deps: RankCheckDeps, keyword: KeywordRow, error: unknown): Promise<void> {
  const reason = error instanceof IntegrationsError ? (error.detail ?? error.code) : error instanceof Error ? error.message : "Rank check failed";
  await deps.database.query(
    `insert into keyword_rank_day (id, site_keyword_id, day, position, ranking_url, top_results, checked_at, check_status, failure_reason, matched_type)
     values ($1, $2, $3::date, null, null, '[]'::jsonb, $4, 'failed', $5, null)
     on conflict (site_keyword_id, day) do update set checked_at = excluded.checked_at, failure_reason = excluded.failure_reason
     where keyword_rank_day.check_status = 'failed'`,
    [randomUUID(), keyword.id, utcDay(deps.now), deps.now, reason.slice(0, 300)],
  );
}

async function countLookup(deps: RankCheckDeps, organizationId: string): Promise<void> {
  await recordDataForSeoLookup(deps.database, organizationId, deps.now);
}

async function checkOrganization(deps: RankCheckDeps, organizationId: string, result: RankCheckResult): Promise<void> {
  const connection = createDataForSeoConnection({ database: deps.database, organizationId, dataforseo: deps.dataforseo, masterKey: deps.masterKey });
  const keywords = await deps.database.query<KeywordRow>(
    `select k.id, k.phrase, s.id as site_id, s.primary_hostname,
            coalesce(s.service_area_location_name, concat_ws(',', s.service_area_city, s.service_area_region, s.service_area_country)) as location_name,
            s.service_area_location_code as location_code,
            exists (select 1 from keyword_rank_day r where r.site_keyword_id = k.id and r.day = $2::date and r.check_status = 'checked') as checked_today
       from site_keyword k
       join site s on s.id = k.site_id
      where s.organization_id = $1 and s.removed_at is null and k.removed_at is null
        and (s.service_area_location_code is not null or (s.service_area_city is not null and s.service_area_region is not null and s.service_area_country is not null))
        and exists (select 1 from site_link l where l.site_id = s.id and l.ended_at is null)
      order by s.primary_hostname, k.created_at, k.id`,
    [organizationId, utcDay(deps.now)],
  );
  result.sites += new Set(keywords.rows.map((row) => row.site_id)).size;
  result.keywords += keywords.rows.length;
  for (const keyword of keywords.rows) {
    if (keyword.checked_today) continue;
    try {
      await checkKeyword(deps, connection, keyword);
      await countLookup(deps, organizationId);
      result.checked += 1;
    } catch (error) {
      result.failed += 1;
      await recordFailedCheck(deps, keyword, error);
      console.error(`Rank check failed for ${keyword.primary_hostname}: ${keyword.phrase}`, error);
    }
  }
  await deps.database.query("update dataforseo_connection set last_checked_at = $2, updated_at = $2 where organization_id = $1", [organizationId, deps.now]);
}

export async function checkRankings(deps: RankCheckDeps): Promise<RankCheckResult> {
  const connections = await deps.database.query<{ organization_id: string }>(
    "select organization_id from dataforseo_connection where $1::text is null or organization_id = $1 order by organization_id",
    [deps.organizationId ?? null],
  );
  const result: RankCheckResult = { sites: 0, keywords: 0, checked: 0, failed: 0 };
  for (const connection of connections.rows) await checkOrganization(deps, connection.organization_id, result);
  return result;
}
