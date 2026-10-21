/**
 * -------------------------------------------------------------------------
 * @file   site-sync.ts
 * @brief  Syncs every connected Site's deployments, traffic, and uptime.
 *
 * @description
 *  For every Organization with a Cloudflare connection, discovers Sites,
 *  then for each Site that is not removed records its ten newest Worker
 *  deployments and the live version, upserts per-day traffic for today
 *  and yesterday in UTC (or the last 30 days when the Site has no metric
 *  day yet), fetches the apex URL for an uptime check, captures a preview
 *  when the live deployment changed or the newest preview is older than a
 *  day, and finally stamps the connection's last sync time.
 *
 * @remarks
 *  Every write is an upsert keyed by Site and day or version, so a rerun
 *  within the hour changes nothing but the synced time and adds one more
 *  check. One Site's failure is counted and never stops the others, and a
 *  discovery failure still syncs the Sites already stored. Provider errors
 *  go through the connection's credential wrapper so the Integrations page
 *  shows the failure. The uptime check reads headers only, aborts after 10
 *  seconds, and records an unreachable host as a failed check with the
 *  error message rather than a thrown error. The preview runs inside the
 *  sync rather than as its own task because a capture is one request.
 *
 * @see
 *  trigger/site-sync.ts
 *  data/site-preview.ts
 *  data/cloudflare-connection.ts
 *  data/cloudflare-client.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { addCalendarDays } from "@/data/analytics-range";
import type { CloudflareClient, CloudflareCredential, CloudflareDailyTraffic } from "@/data/cloudflare-client";
import { createCloudflareConnection, type CloudflareConnection } from "@/data/cloudflare-connection";
import { captureSitePreview, previewNeedsRefresh, type SitePreviewObjects } from "@/data/site-preview";

export interface SiteSyncDeps {
  pool: Pool;
  cloudflare: CloudflareClient;
  objects?: SitePreviewObjects;
  masterKey: string;
  fetch?: typeof fetch;
  now: Date;
  organizationId?: string;
}

export interface SiteSyncResult {
  sites: number;
  synced: number;
  failed: number;
}

export const siteSyncDeploymentLimit = 10;
export const siteSyncBackfillDays = 30;
export const siteCheckTimeoutMs = 10_000;

type SyncSiteRow = {
  id: string;
  script_name: string;
  primary_hostname: string;
  rum_site_tag: string | null;
  has_metrics: boolean;
};

function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

async function recordDeployments(pool: Pool, cloudflare: CloudflareClient, credential: CloudflareCredential, site: SyncSiteRow, now: Date): Promise<void> {
  const deployments = await cloudflare.listDeployments(credential, site.script_name, siteSyncDeploymentLimit);
  for (const deployment of deployments) {
    await pool.query(
      `insert into site_deployment (id, site_id, version_id, source, author_email, deployed_at) values ($1, $2, $3, $4, $5, $6)
       on conflict (site_id, version_id) do update set source = excluded.source, author_email = excluded.author_email, deployed_at = excluded.deployed_at`,
      [randomUUID(), site.id, deployment.versionId, deployment.source, deployment.authorEmail, deployment.deployedAt],
    );
  }
  const newest = deployments[0];
  if (newest) {
    await pool.query("update site set live_version_id = $2, last_deployed_at = $3, updated_at = $4 where id = $1", [site.id, newest.versionId, newest.deployedAt, now]);
  }
}

async function upsertMetricDay(pool: Pool, siteId: string, day: CloudflareDailyTraffic, now: Date): Promise<void> {
  await pool.query(
    `insert into site_metric_day (id, site_id, day, visits, page_views, requests, errors, top_paths, referrers, devices, lcp_ms, inp_ms, cls, synced_at)
     values ($1, $2, $3::date, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13, $14)
     on conflict (site_id, day) do update set
       visits = excluded.visits, page_views = excluded.page_views, requests = excluded.requests, errors = excluded.errors,
       top_paths = excluded.top_paths, referrers = excluded.referrers, devices = excluded.devices,
       lcp_ms = excluded.lcp_ms, inp_ms = excluded.inp_ms, cls = excluded.cls, synced_at = excluded.synced_at`,
    [
      randomUUID(), siteId, day.day, day.visits, day.pageViews, day.requests, day.errors,
      JSON.stringify(day.topPaths), JSON.stringify(day.referrers), JSON.stringify(day.devices),
      day.vitals.lcpMs, day.vitals.inpMs, day.vitals.cls, now,
    ],
  );
}

async function recordTraffic(pool: Pool, cloudflare: CloudflareClient, credential: CloudflareCredential, site: SyncSiteRow, now: Date): Promise<void> {
  const today = utcDay(now);
  const fromDate = addCalendarDays(today, site.has_metrics ? -1 : -(siteSyncBackfillDays - 1));
  const days = await cloudflare.fetchDailyTraffic(credential, { siteTag: site.rum_site_tag ?? "", scriptName: site.script_name, fromDate, toDate: today });
  for (const day of days) await upsertMetricDay(pool, site.id, day, now);
}

async function recordCheck(pool: Pool, request: typeof fetch, site: SyncSiteRow, now: Date): Promise<void> {
  const started = Date.now();
  let statusCode: number | null = null;
  let responseMs: number | null = null;
  let error: string | null = null;
  try {
    const response = await request(`https://${site.primary_hostname}/`, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(siteCheckTimeoutMs) });
    responseMs = Date.now() - started;
    statusCode = response.status;
    await response.body?.cancel();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Request failed";
  }
  await pool.query(
    "insert into site_check (id, site_id, checked_at, status_code, response_ms, ok, error) values ($1, $2, $3, $4, $5, $6, $7)",
    [randomUUID(), site.id, now, statusCode, responseMs, statusCode !== null && statusCode < 400, error],
  );
}

async function refreshPreview(deps: SiteSyncDeps, siteId: string): Promise<void> {
  if (!deps.objects) return;
  const row = (await deps.pool.query<{ live_version_id: string | null; preview_version_id: string | null; preview_captured_at: Date | null }>(
    `select s.live_version_id, p.version_id as preview_version_id, p.captured_at as preview_captured_at
       from site s
       left join lateral (select version_id, captured_at from site_preview where site_id = s.id order by captured_at desc limit 1) p on true
      where s.id = $1`,
    [siteId],
  )).rows[0];
  if (!row) return;
  const latestPreview = row.preview_captured_at ? { versionId: row.preview_version_id, capturedAt: row.preview_captured_at.toISOString() } : null;
  if (!previewNeedsRefresh({ latestPreview, liveVersionId: row.live_version_id, now: deps.now })) return;
  await captureSitePreview({ pool: deps.pool, cloudflare: deps.cloudflare, objects: deps.objects, masterKey: deps.masterKey, siteId, now: deps.now });
}

async function syncSite(deps: SiteSyncDeps, connection: CloudflareConnection, site: SyncSiteRow): Promise<void> {
  await connection.withCloudflareCredential(async (credential) => {
    await recordDeployments(deps.pool, deps.cloudflare, credential, site, deps.now);
    await recordTraffic(deps.pool, deps.cloudflare, credential, site, deps.now);
  });
  await recordCheck(deps.pool, deps.fetch ?? globalThis.fetch, site, deps.now);
  await refreshPreview(deps, site.id);
}

async function syncOrganization(deps: SiteSyncDeps, organizationId: string, result: SiteSyncResult): Promise<void> {
  const connection = createCloudflareConnection({ pool: deps.pool, organizationId, cloudflare: deps.cloudflare, masterKey: deps.masterKey });
  try {
    await connection.syncSites();
  } catch (error) {
    console.error(`Site discovery failed for Organization ${organizationId}`, error);
  }
  const sites = await deps.pool.query<SyncSiteRow>(
    `select s.id, s.script_name, s.primary_hostname, s.rum_site_tag, exists (select 1 from site_metric_day m where m.site_id = s.id) as has_metrics
       from site s where s.organization_id = $1 and s.removed_at is null order by s.primary_hostname, s.id`,
    [organizationId],
  );
  for (const site of sites.rows) {
    result.sites += 1;
    try {
      await syncSite(deps, connection, site);
      result.synced += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`Site sync failed for ${site.primary_hostname}`, error);
    }
  }
  await deps.pool.query("update cloudflare_connection set last_synced_at = $2, updated_at = $2 where organization_id = $1", [organizationId, deps.now]);
}

export async function syncSites(deps: SiteSyncDeps): Promise<SiteSyncResult> {
  const connections = await deps.pool.query<{ organization_id: string }>(
    `select organization_id from cloudflare_connection where $1::text is null or organization_id = $1 order by organization_id`,
    [deps.organizationId ?? null],
  );
  const result: SiteSyncResult = { sites: 0, synced: 0, failed: 0 };
  for (const connection of connections.rows) await syncOrganization(deps, connection.organization_id, result);
  return result;
}
