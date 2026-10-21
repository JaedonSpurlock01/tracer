/**
 * -------------------------------------------------------------------------
 * @file   rank-check.ts
 * @brief  Checks every tracked Keyword's Google position once per day.
 *
 * @description
 *  For every Organization with a DataForSEO connection, for every Site
 *  that is not removed, has an open Site Link, and has a Service Area,
 *  looks up each live Keyword that has no rank day for today, finds the
 *  first organic result on the Site's primary hostname with or without
 *  www, stores the position, ranking URL, and top ten results into
 *  `keyword_rank_day`, counts the lookup on the connection, and stamps
 *  the connection's last check time.
 *
 * @remarks
 *  The unique index on Keyword and day plus the "no row for today" filter
 *  make a rerun idempotent: a Keyword is never queried twice in a day,
 *  and a Keyword added later in the day is picked up by the next run.
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

import type { Pool } from "pg";

import type { DataForSeoClient, DataForSeoSerpItem } from "@/data/dataforseo-client";
import { createDataForSeoConnection, type DataForSeoConnection } from "@/data/dataforseo-connection";

export interface RankCheckDeps {
  pool: Pool;
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
  checked_today: boolean;
};

function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function utcMonth(at: Date): string {
  return `${utcDay(at).slice(0, 7)}-01`;
}

function bareHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

export function siteRank(items: DataForSeoSerpItem[], primaryHostname: string): { position: number | null; rankingUrl: string | null } {
  const target = bareHostname(primaryHostname);
  const match = items.find((item) => bareHostname(item.domain) === target);
  return match ? { position: match.position, rankingUrl: match.url } : { position: null, rankingUrl: null };
}

async function checkKeyword(deps: RankCheckDeps, connection: DataForSeoConnection, keyword: KeywordRow): Promise<void> {
  const { items } = await connection.withDataForSeoCredential((credential) =>
    deps.dataforseo.serp(credential, { keyword: keyword.phrase, locationName: keyword.location_name, languageCode: "en", depth: 100 }),
  );
  const rank = siteRank(items, keyword.primary_hostname);
  await deps.pool.query(
    `insert into keyword_rank_day (id, site_keyword_id, day, position, ranking_url, top_results, checked_at)
     values ($1, $2, $3::date, $4, $5, $6::jsonb, $7)
     on conflict (site_keyword_id, day) do nothing`,
    [randomUUID(), keyword.id, utcDay(deps.now), rank.position, rank.rankingUrl, JSON.stringify(items.slice(0, rankCheckTopResults)), deps.now],
  );
}

async function countLookup(deps: RankCheckDeps, organizationId: string): Promise<void> {
  await deps.pool.query(
    `update dataforseo_connection
        set lookups_this_month = case when lookups_month = $2::date then lookups_this_month + 1 else 1 end,
            lookups_month = $2::date, updated_at = $3
      where organization_id = $1`,
    [organizationId, utcMonth(deps.now), deps.now],
  );
}

async function checkOrganization(deps: RankCheckDeps, organizationId: string, result: RankCheckResult): Promise<void> {
  const connection = createDataForSeoConnection({ pool: deps.pool, organizationId, dataforseo: deps.dataforseo, masterKey: deps.masterKey });
  const keywords = await deps.pool.query<KeywordRow>(
    `select k.id, k.phrase, s.id as site_id, s.primary_hostname,
            concat_ws(',', s.service_area_city, s.service_area_region, s.service_area_country) as location_name,
            exists (select 1 from keyword_rank_day r where r.site_keyword_id = k.id and r.day = $2::date) as checked_today
       from site_keyword k
       join site s on s.id = k.site_id
      where s.organization_id = $1 and s.removed_at is null and k.removed_at is null
        and s.service_area_city is not null and s.service_area_region is not null and s.service_area_country is not null
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
      console.error(`Rank check failed for ${keyword.primary_hostname}: ${keyword.phrase}`, error);
    }
  }
  await deps.pool.query("update dataforseo_connection set last_checked_at = $2, updated_at = $2 where organization_id = $1", [organizationId, deps.now]);
}

export async function checkRankings(deps: RankCheckDeps): Promise<RankCheckResult> {
  const connections = await deps.pool.query<{ organization_id: string }>(
    "select organization_id from dataforseo_connection where $1::text is null or organization_id = $1 order by organization_id",
    [deps.organizationId ?? null],
  );
  const result: RankCheckResult = { sites: 0, keywords: 0, checked: 0, failed: 0 };
  for (const connection of connections.rows) await checkOrganization(deps, connection.organization_id, result);
  return result;
}
