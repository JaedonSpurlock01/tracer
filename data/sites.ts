/**
 * -------------------------------------------------------------------------
 * @file   sites.ts
 * @brief  Reads and links Sites under Workspace authorization.
 *
 * @description
 *  Lists the Organization's Sites for the Operator picker, finds the Site
 *  linked to a Workspace with its hostnames, newest ten deployments,
 *  latest preview, latest uptime check, and 30-day uptime, starts,
 *  replaces, and ends Site Links, and summarizes stored traffic days over
 *  a dashboard range, and records the Site's Domain renewal (registrar,
 *  annual price, and renewal date) for the cost service. A Client Viewer
 *  response drops the Worker name, extra hostnames, deployments, Worker
 *  request and error counts, and the Domain renewal but keeps the health
 *  reason and the uptime.
 *
 * @remarks
 *  Linking never touches Cloudflare: a Site Link is a row whose open period
 *  is enforced by partial unique indexes on the Site and on the Workspace,
 *  so a race on either side fails on the index and is reported as a
 *  conflict. Metric days are Cloudflare's UTC calendar days; the range's
 *  "today" follows the Workspace reporting timezone like the Call
 *  analytics. Core Web Vitals over a range are the page-view-weighted mean
 *  of the stored daily p75 values.
 *
 * @see
 *  data/site-health.ts
 *  data/cloudflare-connection.ts
 *  data/workspace-authorization.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { addCalendarDays, analyticsWindow, calendarDateInTimeZone, type AnalyticsRange } from "@/data/analytics-range";
import { AuthorizationError, type Actor } from "@/data/authorization";
import { siteHostnamesJsonSql, type CloudflareSiteListEntry } from "@/data/cloudflare-connection";
import { type CountedDimension, topPathLimit } from "@/data/cloudflare-client";
import type { SiteHealth } from "@/data/site-health";
import { siteHealthFromRow, siteHealthInputJsonSql, type SiteHealthRow } from "@/data/site-health-query";
import { canManageWorkspaces, createReadableWorkspaces, readableWorkspaceSql } from "@/data/workspace-authorization";

export interface SiteHostnameRecord {
  hostname: string;
  zoneId: string;
  certificateId: string | null;
  enabled: boolean;
}

export interface SiteDeploymentRecord {
  versionId: string;
  source: string;
  authorEmail: string | null;
  deployedAt: string;
}

export interface SiteUptime {
  ratio: number | null;
  medianResponseMs: number | null;
  checks: number;
}

export interface SiteDomainRenewal {
  registrar: string | null;
  renewalCents: number | null;
  renewsOn: string | null;
}

export interface SiteRecord {
  id: string;
  scriptName: string;
  primaryHostname: string;
  hostnames: SiteHostnameRecord[];
  liveVersionId: string | null;
  lastDeployedAt: string | null;
  lastDeployment: SiteDeploymentRecord | null;
  deployments: SiteDeploymentRecord[];
  latestPreview: { objectKey: string; versionId: string | null; capturedAt: string } | null;
  latestCheck: { checkedAt: string; ok: boolean; statusCode: number | null; responseMs: number | null } | null;
  uptime30d: SiteUptime;
  health: SiteHealth;
  healthReason: string | null;
  lastSyncedAt: string | null;
  linkedAt: string;
  domain: SiteDomainRenewal;
}

export type SitePickerEntry = CloudflareSiteListEntry;

export interface SitePickerResult {
  sites: SitePickerEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SiteSummary {
  visits: number;
  pageViews: number;
  requests: number;
  errors: number;
  topPaths: CountedDimension[];
  referrers: CountedDimension[];
  devices: CountedDimension[];
  vitals: { lcpMs: number | null; inpMs: number | null; cls: number | null };
  daily: { day: string; visits: number; pageViews: number }[];
}

export type ClientViewerSiteRecord = Omit<SiteRecord, "scriptName" | "liveVersionId" | "lastDeployment" | "deployments" | "latestPreview" | "domain"> & { latestPreview: { versionId: string | null; capturedAt: string } | null };
export type ClientViewerSiteSummary = Omit<SiteSummary, "requests" | "errors">;

export type SitesErrorCode = "invalid_input" | "not_found" | "site_linked_elsewhere" | "workspace_already_linked";

export class SitesError extends Error {
  constructor(public readonly code: SitesErrorCode) {
    super(code);
    this.name = "SitesError";
  }
}

export interface Sites {
  listForPicker(query: { page?: number; pageSize?: number; search?: string }): Promise<SitePickerResult>;
  findLinked(workspaceId: string): Promise<SiteRecord | null>;
  link(workspaceId: string, siteId: string, actorUserId: string): Promise<SiteRecord>;
  replace(workspaceId: string, siteId: string, actorUserId: string): Promise<SiteRecord>;
  detach(workspaceId: string): Promise<void>;
  setDomainRenewal(workspaceId: string, input: { registrar: unknown; renewalCents: unknown; renewsOn: unknown }): Promise<SiteDomainRenewal>;
  summary(siteId: string, range: AnalyticsRange, timeZone: string): Promise<SiteSummary>;
}

type PickerRow = SiteHealthRow & {
  id: string;
  script_name: string;
  primary_hostname: string;
  hostnames: { hostname: string; certificateId: string | null; enabled: boolean }[];
  last_deployed_at: Date | null;
  live_version_id: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
  visits_30d: number;
  total: string;
};

type SiteRow = SiteHealthRow & {
  id: string;
  script_name: string;
  primary_hostname: string;
  hostnames: SiteHostnameRecord[];
  live_version_id: string | null;
  last_deployed_at: Date | null;
  linked_at: Date;
  deployment_version_id: string | null;
  deployment_source: string | null;
  deployment_author_email: string | null;
  deployment_deployed_at: Date | null;
  deployments: SiteDeploymentRecord[];
  uptime: { checks: number; okChecks: number; medianResponseMs: number | null };
  preview_object_key: string | null;
  preview_version_id: string | null;
  preview_captured_at: Date | null;
  check_checked_at: Date | null;
  check_ok: boolean | null;
  check_status_code: number | null;
  check_response_ms: number | null;
  domain_registrar: string | null;
  domain_renewal_cents: number | null;
  domain_renews_on: string | null;
};

type MetricRow = {
  day: string;
  visits: number;
  page_views: number;
  requests: number;
  errors: number;
  top_paths: CountedDimension[];
  referrers: CountedDimension[];
  devices: CountedDimension[];
  lcp_ms: number | null;
  inp_ms: number | null;
  cls: string | null;
};

const linkedSiteQuery = `
  select s.id, s.script_name, s.primary_hostname, s.live_version_id, s.last_deployed_at, l.started_at as linked_at,
         s.domain_registrar, s.domain_renewal_cents, s.domain_renews_on::text as domain_renews_on,
         coalesce((select json_agg(json_build_object('hostname', h.hostname, 'zoneId', h.zone_id, 'certificateId', h.certificate_id, 'enabled', h.enabled)
                                   order by (h.hostname like 'www.%'), length(h.hostname), h.hostname)
                     from site_hostname h where h.site_id = s.id), '[]'::json) as hostnames,
         d.version_id as deployment_version_id, d.source as deployment_source, d.author_email as deployment_author_email, d.deployed_at as deployment_deployed_at,
         coalesce((select json_agg(json_build_object('versionId', r.version_id, 'source', r.source, 'authorEmail', r.author_email,
                                                     'deployedAt', to_char(r.deployed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                                   order by r.deployed_at desc)
                     from (select version_id, source, author_email, deployed_at from site_deployment where site_id = s.id order by deployed_at desc limit 10) r), '[]'::json) as deployments,
         (select json_build_object('checks', count(*), 'okChecks', count(*) filter (where ok), 'medianResponseMs', percentile_cont(0.5) within group (order by response_ms))
            from site_check where site_id = s.id and checked_at >= now() - interval '30 days') as uptime,
         p.object_key as preview_object_key, p.version_id as preview_version_id, p.captured_at as preview_captured_at,
         k.checked_at as check_checked_at, k.ok as check_ok, k.status_code as check_status_code, k.response_ms as check_response_ms,
         c.last_synced_at, ${siteHealthInputJsonSql("s")} as health_input
    from site_link l
    join site s on s.id = l.site_id
    left join lateral (select version_id, source, author_email, deployed_at from site_deployment where site_id = s.id order by deployed_at desc limit 1) d on true
    left join lateral (select object_key, version_id, captured_at from site_preview where site_id = s.id order by captured_at desc limit 1) p on true
    left join lateral (select checked_at, ok, status_code, response_ms from site_check where site_id = s.id order by checked_at desc limit 1) k on true
    left join cloudflare_connection c on c.organization_id = s.organization_id
   where l.organization_id = $1 and l.workspace_id = $2 and l.ended_at is null
`;

function toSiteRecord(row: SiteRow): SiteRecord {
  const health = siteHealthFromRow(row);
  return {
    id: row.id,
    scriptName: row.script_name,
    primaryHostname: row.primary_hostname,
    hostnames: row.hostnames,
    liveVersionId: row.live_version_id,
    lastDeployedAt: row.last_deployed_at?.toISOString() ?? null,
    lastDeployment: row.deployment_version_id && row.deployment_deployed_at
      ? { versionId: row.deployment_version_id, source: row.deployment_source ?? "unknown", authorEmail: row.deployment_author_email, deployedAt: row.deployment_deployed_at.toISOString() }
      : null,
    deployments: row.deployments,
    latestPreview: row.preview_object_key && row.preview_captured_at ? { objectKey: row.preview_object_key, versionId: row.preview_version_id, capturedAt: row.preview_captured_at.toISOString() } : null,
    latestCheck: row.check_checked_at && row.check_ok !== null ? { checkedAt: row.check_checked_at.toISOString(), ok: row.check_ok, statusCode: row.check_status_code, responseMs: row.check_response_ms } : null,
    uptime30d: {
      ratio: row.uptime.checks > 0 ? Math.round((row.uptime.okChecks / row.uptime.checks) * 10_000) / 10_000 : null,
      medianResponseMs: row.uptime.medianResponseMs === null ? null : Math.round(row.uptime.medianResponseMs),
      checks: row.uptime.checks,
    },
    health: health.health,
    healthReason: health.reason,
    lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
    linkedAt: row.linked_at.toISOString(),
    domain: { registrar: row.domain_registrar, renewalCents: row.domain_renewal_cents, renewsOn: row.domain_renews_on },
  };
}

const registrarMaxLength = 80;

function parseDomainRenewal(input: { registrar: unknown; renewalCents: unknown; renewsOn: unknown }): SiteDomainRenewal {
  const registrar = input.registrar === null || input.registrar === undefined ? null : input.registrar;
  if (registrar !== null && typeof registrar !== "string") throw new SitesError("invalid_input");
  const trimmed = registrar?.trim() ?? "";
  if (trimmed.length > registrarMaxLength) throw new SitesError("invalid_input");
  const renewalCents = input.renewalCents === null || input.renewalCents === undefined ? null : input.renewalCents;
  if (renewalCents !== null && (typeof renewalCents !== "number" || !Number.isInteger(renewalCents) || renewalCents < 0)) throw new SitesError("invalid_input");
  const renewsOn = input.renewsOn === null || input.renewsOn === undefined || input.renewsOn === "" ? null : input.renewsOn;
  if (renewsOn !== null) {
    if (typeof renewsOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(renewsOn)) throw new SitesError("invalid_input");
    const date = new Date(`${renewsOn}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== renewsOn) throw new SitesError("invalid_input");
  }
  return { registrar: trimmed || null, renewalCents, renewsOn };
}

export function siteResponseForActor(actor: Actor, site: SiteRecord): ClientViewerSiteRecord | (Omit<SiteRecord, "latestPreview"> & { latestPreview: { versionId: string | null; capturedAt: string } | null }) {
  const latestPreview = site.latestPreview ? { versionId: site.latestPreview.versionId, capturedAt: site.latestPreview.capturedAt } : null;
  if (canManageWorkspaces(actor)) return { ...site, latestPreview };
  return {
    id: site.id,
    primaryHostname: site.primaryHostname,
    hostnames: site.hostnames.filter((hostname) => hostname.hostname === site.primaryHostname),
    lastDeployedAt: site.lastDeployedAt,
    latestPreview: latestPreview ? { versionId: null, capturedAt: latestPreview.capturedAt } : null,
    latestCheck: site.latestCheck,
    uptime30d: site.uptime30d,
    health: site.health,
    healthReason: site.healthReason,
    lastSyncedAt: site.lastSyncedAt,
    linkedAt: site.linkedAt,
  };
}

export function summaryResponseForActor(actor: Actor, summary: SiteSummary): SiteSummary | ClientViewerSiteSummary {
  if (canManageWorkspaces(actor)) return summary;
  return { visits: summary.visits, pageViews: summary.pageViews, topPaths: summary.topPaths, referrers: summary.referrers, devices: summary.devices, vitals: summary.vitals, daily: summary.daily };
}

function mergeCounted(rows: CountedDimension[][], limit?: number): CountedDimension[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    for (const [key, count] of row) totals.set(key, (totals.get(key) ?? 0) + count);
  }
  const merged = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return limit === undefined ? merged : merged.slice(0, limit);
}

function weightedVital(rows: MetricRow[], value: (row: MetricRow) => number | null, decimals: number): number | null {
  let weight = 0;
  let total = 0;
  for (const row of rows) {
    const sample = value(row);
    if (sample === null) continue;
    const pageViews = Math.max(row.page_views, 1);
    weight += pageViews;
    total += sample * pageViews;
  }
  if (weight === 0) return null;
  const factor = 10 ** decimals;
  return Math.round((total / weight) * factor) / factor;
}

async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export function createSites(pool: Pool, actor: Actor): Sites {
  const organizationId = actor.organizationId;
  const workspaces = createReadableWorkspaces(pool, actor);
  const lock = `tracer:sites:${organizationId}`;

  function requireOperator(): void {
    if (!canManageWorkspaces(actor)) throw new AuthorizationError(403);
  }

  async function selectLinked(client: Pool | PoolClient, workspaceId: string): Promise<SiteRecord | null> {
    const result = await client.query<SiteRow>(linkedSiteQuery, [organizationId, workspaceId]);
    return result.rows[0] ? toSiteRecord(result.rows[0]) : null;
  }

  async function startLink(client: PoolClient, workspaceId: string, siteId: string, actorUserId: string, now: Date): Promise<void> {
    const site = await client.query<{ id: string; linked_workspace_id: string | null }>(
      `select s.id, (select l.workspace_id from site_link l where l.site_id = s.id and l.ended_at is null) as linked_workspace_id
         from site s where s.organization_id = $1 and s.id = $2 and s.removed_at is null for update`,
      [organizationId, siteId],
    );
    if (!site.rows[0]) throw new SitesError("not_found");
    if (site.rows[0].linked_workspace_id && site.rows[0].linked_workspace_id !== workspaceId) throw new SitesError("site_linked_elsewhere");
    const open = await client.query("select 1 from site_link where organization_id = $1 and workspace_id = $2 and ended_at is null", [organizationId, workspaceId]);
    if (open.rowCount) throw new SitesError("workspace_already_linked");
    await client.query(
      "insert into site_link (id, organization_id, site_id, workspace_id, started_at, started_by_user_id) values ($1, $2, $3, $4, $5, $6)",
      [randomUUID(), organizationId, siteId, workspaceId, now, actorUserId],
    );
  }

  async function endLink(client: PoolClient, workspaceId: string, now: Date): Promise<boolean> {
    const ended = await client.query("update site_link set ended_at = $3 where organization_id = $1 and workspace_id = $2 and ended_at is null", [organizationId, workspaceId, now]);
    return Boolean(ended.rowCount);
  }

  async function requireWorkspace(client: PoolClient, workspaceId: string): Promise<void> {
    const workspace = await client.query("select 1 from workspace where organization_id = $1 and id = $2 for update", [organizationId, workspaceId]);
    if (!workspace.rowCount) throw new SitesError("not_found");
  }

  return {
    async listForPicker(query) {
      requireOperator();
      const page = Number.isInteger(query.page) && (query.page ?? 0) > 0 ? query.page! : 1;
      const pageSize = Number.isInteger(query.pageSize) && (query.pageSize ?? 0) > 0 ? Math.min(query.pageSize!, 50) : 5;
      const search = query.search?.trim() ?? "";
      const values: unknown[] = [organizationId];
      let where = "s.organization_id = $1 and s.removed_at is null";
      if (search) {
        values.push(`%${search}%`);
        where += ` and (s.primary_hostname ilike $${values.length} or s.script_name ilike $${values.length})`;
      }
      values.push((page - 1) * pageSize, pageSize);
      const result = await pool.query<PickerRow>(
        `select s.id, s.script_name, s.primary_hostname, s.last_deployed_at, s.live_version_id,
                ${siteHostnamesJsonSql("s")} as hostnames,
                w.id as workspace_id, w.name as workspace_name,
                coalesce((select sum(m.visits) from site_metric_day m where m.site_id = s.id and m.day >= current_date - 29), 0)::int as visits_30d,
                c.last_synced_at, ${siteHealthInputJsonSql("s")} as health_input, count(*) over ()::text as total
           from site s
           left join site_link l on l.site_id = s.id and l.ended_at is null
           left join workspace w on w.id = l.workspace_id
           left join cloudflare_connection c on c.organization_id = s.organization_id
          where ${where}
          order by s.primary_hostname, s.id
         offset $${values.length - 1} limit $${values.length}`,
        values,
      );
      return {
        sites: result.rows.map((row) => {
          const health = siteHealthFromRow(row);
          return {
            id: row.id,
            scriptName: row.script_name,
            primaryHostname: row.primary_hostname,
            hostnames: row.hostnames,
            lastDeployedAt: row.last_deployed_at?.toISOString() ?? null,
            liveVersionId: row.live_version_id,
            linkedWorkspace: row.workspace_id && row.workspace_name ? { id: row.workspace_id, name: row.workspace_name } : null,
            visits30d: Number(row.visits_30d),
            health: health.health,
            healthReason: health.reason,
          };
        }),
        total: Number(result.rows[0]?.total ?? 0),
        page,
        pageSize,
      };
    },

    async findLinked(workspaceId) {
      const workspace = await workspaces.find(workspaceId);
      if (!workspace) return null;
      return selectLinked(pool, workspace.id);
    },

    async link(workspaceId, siteId, actorUserId) {
      requireOperator();
      return withTransaction(pool, async (client) => {
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [lock]);
        await requireWorkspace(client, workspaceId);
        await startLink(client, workspaceId, siteId, actorUserId, new Date());
        const linked = await selectLinked(client, workspaceId);
        if (!linked) throw new SitesError("not_found");
        return linked;
      });
    },

    async replace(workspaceId, siteId, actorUserId) {
      requireOperator();
      return withTransaction(pool, async (client) => {
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [lock]);
        await requireWorkspace(client, workspaceId);
        const current = await selectLinked(client, workspaceId);
        if (current?.id === siteId) return current;
        const now = new Date();
        const target = await client.query<{ linked_workspace_id: string | null }>(
          "select (select l.workspace_id from site_link l where l.site_id = s.id and l.ended_at is null) as linked_workspace_id from site s where s.organization_id = $1 and s.id = $2 and s.removed_at is null",
          [organizationId, siteId],
        );
        if (!target.rows[0]) throw new SitesError("not_found");
        if (target.rows[0].linked_workspace_id) throw new SitesError("site_linked_elsewhere");
        await endLink(client, workspaceId, now);
        await startLink(client, workspaceId, siteId, actorUserId, now);
        const linked = await selectLinked(client, workspaceId);
        if (!linked) throw new SitesError("not_found");
        return linked;
      });
    },

    async detach(workspaceId) {
      requireOperator();
      await withTransaction(pool, async (client) => {
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [lock]);
        await requireWorkspace(client, workspaceId);
        if (!(await endLink(client, workspaceId, new Date()))) throw new SitesError("not_found");
      });
    },

    async setDomainRenewal(workspaceId, input) {
      requireOperator();
      const domain = parseDomainRenewal(input);
      const updated = await pool.query<{ domain_registrar: string | null; domain_renewal_cents: number | null; domain_renews_on: string | null }>(
        `update site s set domain_registrar = $3, domain_renewal_cents = $4, domain_renews_on = $5::date, updated_at = $6
          from site_link l
         where l.site_id = s.id and l.organization_id = $1 and l.workspace_id = $2 and l.ended_at is null and s.organization_id = $1
         returning s.domain_registrar, s.domain_renewal_cents, s.domain_renews_on::text as domain_renews_on`,
        [organizationId, workspaceId, domain.registrar, domain.renewalCents, domain.renewsOn, new Date()],
      );
      if (!updated.rows[0]) throw new SitesError("not_found");
      return { registrar: updated.rows[0].domain_registrar, renewalCents: updated.rows[0].domain_renewal_cents, renewsOn: updated.rows[0].domain_renews_on };
    },

    async summary(siteId, range, timeZone) {
      const scope: unknown[] = [siteId];
      const readable = canManageWorkspaces(actor)
        ? (scope.push(organizationId), `s.organization_id = $${scope.length}`)
        : `exists (select 1 from site_link l join workspace w on w.id = l.workspace_id where l.site_id = s.id and l.ended_at is null and ${readableWorkspaceSql(actor, scope)})`;
      const site = await pool.query<{ first_day: string | null }>(
        `select (select min(m.day)::text from site_metric_day m where m.site_id = s.id) as first_day from site s where s.id = $1 and ${readable}`,
        scope,
      );
      if (!site.rows[0]) throw new SitesError("not_found");
      const today = calendarDateInTimeZone(new Date(), timeZone);
      const window = analyticsWindow(range, today) ?? { from: site.rows[0].first_day && site.rows[0].first_day < today ? site.rows[0].first_day : today, to: today };
      const metrics = await pool.query<MetricRow>(
        `select day::text as day, visits, page_views, requests, errors, top_paths, referrers, devices, lcp_ms, inp_ms, cls::text as cls
           from site_metric_day where site_id = $1 and day >= $2::date and day <= $3::date order by day`,
        [siteId, window.from, window.to],
      );
      const rows = metrics.rows;
      const byDay = new Map(rows.map((row) => [row.day, row]));
      const daily: SiteSummary["daily"] = [];
      for (let day = window.from; day <= window.to; day = addCalendarDays(day, 1)) {
        const row = byDay.get(day);
        daily.push({ day, visits: row?.visits ?? 0, pageViews: row?.page_views ?? 0 });
      }
      return {
        visits: rows.reduce((total, row) => total + row.visits, 0),
        pageViews: rows.reduce((total, row) => total + row.page_views, 0),
        requests: rows.reduce((total, row) => total + row.requests, 0),
        errors: rows.reduce((total, row) => total + row.errors, 0),
        topPaths: mergeCounted(rows.map((row) => row.top_paths), topPathLimit),
        referrers: mergeCounted(rows.map((row) => row.referrers), topPathLimit),
        devices: mergeCounted(rows.map((row) => row.devices)),
        vitals: {
          lcpMs: weightedVital(rows, (row) => row.lcp_ms, 0),
          inpMs: weightedVital(rows, (row) => row.inp_ms, 0),
          cls: weightedVital(rows, (row) => (row.cls === null ? null : Number(row.cls)), 3),
        },
        daily,
      };
    },
  };
}
