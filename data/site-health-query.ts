/**
 * -------------------------------------------------------------------------
 * @file   site-health-query.ts
 * @brief  Reads the Site Health inputs from the stored sync rows.
 *
 * @description
 *  Builds the SQL fragment that gathers, per Site, the two newest uptime
 *  checks, the hostnames that still belong to it, Worker requests and
 *  errors over the last two UTC days, visits over the last two days, and
 *  visits over the seven days before them, as one JSON column, and turns
 *  that column into the health description. It also derives the health of
 *  the Site linked to each Workspace for the Workspaces grid.
 *
 * @remarks
 *  Each input is a bounded scalar subquery over an indexed column, so a
 *  Site read adds four index lookups rather than a join over every metric
 *  row. Days are Cloudflare's UTC calendar days, so a 24-hour or 48-hour
 *  window is approximated by today and yesterday in UTC. Disabled hostname
 *  rows are left out because discovery disables a hostname that left
 *  Cloudflare rather than deleting it.
 *
 * @see
 *  data/site-health.ts
 *  data/sites.ts
 *  data/cloudflare-connection.ts
 *  data/analytics.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import { describeSiteHealth, type SiteHealth, type SiteHealthDescription, type SiteHealthInput } from "@/data/site-health";

export type SiteHealthInputJson = Omit<SiteHealthInput, "lastSyncedAt">;

export interface SiteHealthRow {
  last_synced_at: Date | null;
  health_input: SiteHealthInputJson;
}

export const siteHealthInputJsonSql = (siteAlias: string) => `
  json_build_object(
    'checks', coalesce((select json_agg(json_build_object('checkedAt', k.checked_at, 'ok', k.ok) order by k.checked_at desc)
                          from (select checked_at, ok from site_check where site_id = ${siteAlias}.id order by checked_at desc limit 2) k), '[]'::json),
    'hostnames', coalesce((select json_agg(json_build_object('enabled', h.enabled, 'certificateId', h.certificate_id))
                             from site_hostname h where h.site_id = ${siteAlias}.id and h.enabled), '[]'::json),
    'requests24h', coalesce((select sum(m.requests) from site_metric_day m where m.site_id = ${siteAlias}.id and m.day >= current_date - 1), 0),
    'errors24h', coalesce((select sum(m.errors) from site_metric_day m where m.site_id = ${siteAlias}.id and m.day >= current_date - 1), 0),
    'visitsLast48h', coalesce((select sum(m.visits) from site_metric_day m where m.site_id = ${siteAlias}.id and m.day >= current_date - 1), 0),
    'visitsPrior7d', coalesce((select sum(m.visits) from site_metric_day m where m.site_id = ${siteAlias}.id and m.day >= current_date - 8 and m.day < current_date - 1), 0)
  )`;

export function siteHealthFromRow(row: SiteHealthRow): SiteHealthDescription {
  return describeSiteHealth({
    lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
    checks: row.health_input.checks,
    hostnames: row.health_input.hostnames,
    requests24h: Number(row.health_input.requests24h),
    errors24h: Number(row.health_input.errors24h),
    visitsLast48h: Number(row.health_input.visitsLast48h),
    visitsPrior7d: Number(row.health_input.visitsPrior7d),
  });
}

export async function siteHealthForWorkspaces(pool: Pool, organizationId: string, workspaceIds: string[]): Promise<Record<string, SiteHealth>> {
  if (workspaceIds.length === 0) return {};
  const result = await pool.query<SiteHealthRow & { workspace_id: string }>(
    `select l.workspace_id, c.last_synced_at, ${siteHealthInputJsonSql("s")} as health_input
       from site_link l
       join site s on s.id = l.site_id
       left join cloudflare_connection c on c.organization_id = s.organization_id
      where l.organization_id = $1 and l.ended_at is null and l.workspace_id = any($2::text[])`,
    [organizationId, workspaceIds],
  );
  return Object.fromEntries(result.rows.map((row) => [row.workspace_id, siteHealthFromRow(row).health]));
}
