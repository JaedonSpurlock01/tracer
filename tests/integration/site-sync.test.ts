/**
 * -------------------------------------------------------------------------
 * @file   site-sync.test.ts
 * @brief  Verifies the hourly Site sync and the derived Site Health.
 *
 * @description
 *  Runs the sync as the runtime role against a fake Cloudflare client, a
 *  fake uptime fetch, and an in-memory object store: the first sight of a
 *  Site backfills 30 metric days, records deployments, an uptime check,
 *  and a preview; a later sync is idempotent per Site and day, captures a
 *  new preview only on a new live deployment or after a day, keeps the
 *  newest three preview objects, and one failing Site never stops the
 *  others. Site Health then follows the stored rows through the linked
 *  Site read, the picker, the Cloudflare Sites list, and the Workspace
 *  list stats.
 *
 * @see
 *  data/site-sync.ts
 *  data/site-preview.ts
 *  data/site-health-query.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAnalytics } from "@/data/analytics";
import type { Actor } from "@/data/authorization";
import { CloudflareClientError, type CloudflareClient, type CloudflareDailyTraffic, type CloudflareDeployment, type CloudflareSite } from "@/data/cloudflare-client";
import { createCloudflareConnection } from "@/data/cloudflare-connection";
import { encryptSecret } from "@/data/credential-encryption";
import { migrateDatabase } from "@/data/migrate";
import { provisionRuntimeRole, runtimeRole } from "@/data/runtime-role";
import type { SitePreviewObjects } from "@/data/site-preview";
import { syncSites } from "@/data/site-sync";
import { createSites } from "@/data/sites";

const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const fleetAccount = "0123456789abcdef0123456789abcdef";
const soloAccount = "fedcba9876543210fedcba9876543210";
const fleetToken = "fleet-synthetic-cloudflare-token";
const soloToken = "solo-synthetic-cloudflare-token";

let container: StartedPostgreSqlContainer | undefined;
let owner: Pool | undefined;
let runtime: Pool | undefined;

function site(scriptName: string, apex: string, siteTag: string): CloudflareSite {
  return {
    scriptName,
    primaryHostname: apex,
    zoneId: `zone-${scriptName}`,
    rumSiteTag: siteTag,
    hostnames: [
      { hostname: apex, zoneId: `zone-${scriptName}`, certificateId: `cert-${scriptName}`, enabled: true },
      { hostname: `www.${apex}`, zoneId: `zone-${scriptName}`, certificateId: `cert-${scriptName}-www`, enabled: true },
    ],
  };
}

const accounts: Record<string, { token: string; sites: CloudflareSite[] }> = {
  [fleetAccount]: { token: fleetToken, sites: [site("paving", "pocatelloasphaltpaving.com", "tag-paving"), site("roofing", "pocatelloroofing.com", "tag-roofing")] },
  [soloAccount]: { token: soloToken, sites: [site("solar", "carsoncitysolar.com", "tag-solar")] },
};

const deployments: Record<string, CloudflareDeployment[]> = {
  paving: [
    { versionId: "paving-v2", source: "wrangler", authorEmail: "operator@example.com", deployedAt: "2026-10-18T10:00:00.000Z" },
    { versionId: "paving-v1", source: "dash", authorEmail: null, deployedAt: "2026-10-11T23:12:59.000Z" },
  ],
  roofing: [{ versionId: "roofing-v1", source: "wrangler", authorEmail: "operator@example.com", deployedAt: "2026-10-12T08:00:00.000Z" }],
  solar: [{ versionId: "solar-v1", source: "wrangler", authorEmail: null, deployedAt: "2026-10-13T08:00:00.000Z" }],
};

const trafficQueries: { siteTag: string; fromDate: string; toDate: string }[] = [];
const failingTraffic = new Set<string>();
let screenshots = 0;

function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000));
}

function trafficRows(siteTag: string, fromDate: string, toDate: string): CloudflareDailyTraffic[] {
  const rows: CloudflareDailyTraffic[] = [];
  for (let day = fromDate; day <= toDate; day = addDays(day, 1)) {
    rows.push({ day, visits: 12, pageViews: 30, requests: 100, errors: 1, topPaths: [["/", 20], ["/services", 10]], referrers: [["", 8], ["www.google.com", 4]], devices: [["mobile", 9], ["desktop", 3]], vitals: { lcpMs: 1200, inpMs: 80, cls: 0.02 } });
  }
  return rows;
}

const cloudflare: CloudflareClient = {
  async verifyToken() { return { status: "active" }; },
  async listSites(credential) {
    const account = accounts[credential.accountId];
    if (!account || account.token !== credential.apiToken) throw new CloudflareClientError("authentication_failed", 401);
    return account.sites;
  },
  async listDeployments(_credential, scriptName, limit) {
    return (deployments[scriptName] ?? []).slice(0, limit);
  },
  async fetchDailyTraffic(_credential, query) {
    trafficQueries.push({ siteTag: query.siteTag, fromDate: query.fromDate, toDate: query.toDate });
    if (failingTraffic.has(query.scriptName)) throw new CloudflareClientError("provider_unavailable", 503);
    return trafficRows(query.siteTag, query.fromDate, query.toDate);
  },
  async captureScreenshot(_credential, url) {
    screenshots += 1;
    return new TextEncoder().encode(`jpeg:${url}:${screenshots}`);
  },
};

const checked: string[] = [];
const checkStatus = new Map<string, number | "unreachable">();
const uptimeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  checked.push(url);
  expect(init?.method).toBe("GET");
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  const hostname = new URL(url).hostname;
  const status = checkStatus.get(hostname) ?? 200;
  if (status === "unreachable") throw new TypeError("fetch failed: getaddrinfo ENOTFOUND");
  return new Response("<html></html>", { status });
};

const stored = new Map<string, Uint8Array>();
const deleted: string[] = [];
const objects: SitePreviewObjects = {
  async put(key, body, contentType) {
    expect(contentType).toBe("image/jpeg");
    stored.set(key, body);
  },
  async delete(key) {
    deleted.push(key);
    stored.delete(key);
  },
};

const siteIds: Record<string, string> = {};

function operator(): Actor {
  return { userId: "fleet-operator", organizationId: "fleet", name: "Fleet Operator", email: "fleet-operator@example.com", timezone: "America/Chicago", state: "Active", role: "Operator" };
}

async function sync(now: Date, organizationId?: string) {
  return syncSites({ pool: runtime!, cloudflare, objects, masterKey, fetch: uptimeFetch, now, organizationId });
}

async function count(table: string, siteId: string): Promise<number> {
  return Number((await owner!.query<{ count: string }>(`select count(*) from ${table} where site_id = $1`, [siteId])).rows[0].count);
}

async function metricDays(siteId: string): Promise<string[]> {
  return (await owner!.query<{ day: string }>("select day::text as day from site_metric_day where site_id = $1 order by day", [siteId])).rows.map((row) => row.day);
}

function expectedDays(runs: Date[]): string[] {
  const days = new Set<string>();
  const first = utcDay(runs[0]);
  for (let day = addDays(first, -29); day <= first; day = addDays(day, 1)) days.add(day);
  for (const run of runs.slice(1)) {
    days.add(addDays(utcDay(run), -1));
    days.add(utcDay(run));
  }
  return [...days].sort();
}

const firstRun = new Date();
const secondRun = new Date(firstRun.getTime() + 60 * 60 * 1000);
const thirdRun = new Date(firstRun.getTime() + 2 * 60 * 60 * 1000);

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  await migrateDatabase(container.getConnectionUri());
  owner = new Pool({ connectionString: container.getConnectionUri() });
  const password = "C".repeat(64);
  await provisionRuntimeRole(owner, password);
  const runtimeUrl = new URL(container.getConnectionUri());
  runtimeUrl.username = runtimeRole;
  runtimeUrl.password = password;
  runtime = new Pool({ connectionString: runtimeUrl.toString() });
  await owner.query("insert into organization (id, name, slug, created_at) values ('fleet', 'fleet', 'fleet', now()), ('solo', 'solo', 'solo', now())");
  await owner.query(`insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at) values ('fleet-operator', 'Fleet Operator', 'fleet-operator@example.com', true, 'Active', 'America/Chicago', now(), now())`);
  await owner.query("insert into member (id, organization_id, user_id, role, created_at) values ('fleet-operator-membership', 'fleet', 'fleet-operator', 'owner', now())");
  await owner.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, created_at, updated_at)
     values ('north', 'fleet', 'North Paving', 'America/Chicago', 'Active', now(), now()), ('south', 'fleet', 'South Paving', 'America/Chicago', 'Setup Required', now(), now())`,
  );
  for (const [accountId, organizationId] of [[fleetAccount, "fleet"], [soloAccount, "solo"]] as const) {
    await owner.query(
      `insert into cloudflare_connection (id, organization_id, account_id, api_token_ciphertext, connected_by_user_id, connected_at, last_verified_at, created_at, updated_at)
       values ($1, $2, $3, $4, 'fleet-operator', now(), now(), now(), now())`,
      [`${organizationId}-connection`, organizationId, accountId, await encryptSecret(masterKey, accounts[accountId].token)],
    );
  }
}, 120_000);

afterAll(async () => {
  await runtime?.end();
  await owner?.end();
  await container?.stop();
});

describe.sequential("Site sync", () => {
  it("discovers Sites and backfills 30 days, deployments, an uptime check, and a preview on first sight", async () => {
    expect(await sync(firstRun)).toEqual({ sites: 3, synced: 3, failed: 0 });
    const rows = await owner!.query<{ id: string; script_name: string; live_version_id: string | null; last_deployed_at: Date | null }>("select id, script_name, live_version_id, last_deployed_at from site order by script_name");
    for (const row of rows.rows) siteIds[row.script_name] = row.id;
    expect(rows.rows.map((row) => [row.script_name, row.live_version_id, row.last_deployed_at?.toISOString()])).toEqual([
      ["paving", "paving-v2", "2026-10-18T10:00:00.000Z"],
      ["roofing", "roofing-v1", "2026-10-12T08:00:00.000Z"],
      ["solar", "solar-v1", "2026-10-13T08:00:00.000Z"],
    ]);
    expect(await count("site_deployment", siteIds.paving)).toBe(2);
    expect(await metricDays(siteIds.paving)).toEqual(expectedDays([firstRun]));
    expect(trafficQueries).toContainEqual({ siteTag: "tag-paving", fromDate: addDays(utcDay(firstRun), -29), toDate: utcDay(firstRun) });
    const metric = (await owner!.query("select visits, page_views, requests, errors, top_paths, referrers, devices, lcp_ms, inp_ms, cls::text as cls, synced_at from site_metric_day where site_id = $1 and day = $2::date", [siteIds.paving, utcDay(firstRun)])).rows[0];
    expect(metric).toMatchObject({ visits: 12, page_views: 30, requests: 100, errors: 1, top_paths: [["/", 20], ["/services", 10]], referrers: [["", 8], ["www.google.com", 4]], devices: [["mobile", 9], ["desktop", 3]], lcp_ms: 1200, inp_ms: 80, cls: "0.020", synced_at: firstRun });
    expect(checked).toEqual(expect.arrayContaining(["https://pocatelloasphaltpaving.com/", "https://pocatelloroofing.com/", "https://carsoncitysolar.com/"]));
    const check = (await owner!.query("select checked_at, status_code, response_ms, ok, error from site_check where site_id = $1", [siteIds.paving])).rows;
    expect(check).toEqual([{ checked_at: firstRun, status_code: 200, response_ms: expect.any(Number), ok: true, error: null }]);
    const previews = (await owner!.query<{ version_id: string; object_key: string; captured_at: Date; byte_size: number }>("select version_id, object_key, captured_at, byte_size from site_preview where site_id = $1", [siteIds.paving])).rows;
    expect(previews).toEqual([{ version_id: "paving-v2", object_key: `sites/${siteIds.paving}/preview-paving-v2-${firstRun.getTime()}.jpg`, captured_at: firstRun, byte_size: expect.any(Number) }]);
    expect(stored.get(previews[0].object_key)).toEqual(new TextEncoder().encode("jpeg:https://pocatelloasphaltpaving.com/:1"));
    expect(screenshots).toBe(3);
    const connections = (await owner!.query<{ organization_id: string; last_synced_at: Date | null }>("select organization_id, last_synced_at from cloudflare_connection order by organization_id")).rows;
    expect(connections).toEqual([{ organization_id: "fleet", last_synced_at: firstRun }, { organization_id: "solo", last_synced_at: firstRun }]);
  });

  it("is idempotent per Site and day and captures a preview again only for a new live deployment", async () => {
    trafficQueries.length = 0;
    expect(await sync(secondRun)).toEqual({ sites: 3, synced: 3, failed: 0 });
    expect(trafficQueries).toContainEqual({ siteTag: "tag-paving", fromDate: addDays(utcDay(secondRun), -1), toDate: utcDay(secondRun) });
    expect(await metricDays(siteIds.paving)).toEqual(expectedDays([firstRun, secondRun]));
    expect((await owner!.query("select synced_at from site_metric_day where site_id = $1 and day = $2::date", [siteIds.paving, utcDay(secondRun)])).rows[0].synced_at).toEqual(secondRun);
    expect(await count("site_deployment", siteIds.paving)).toBe(2);
    expect(await count("site_check", siteIds.paving)).toBe(2);
    expect(await count("site_preview", siteIds.paving)).toBe(1);
    expect(screenshots).toBe(3);

    deployments.paving.unshift({ versionId: "paving-v3", source: "wrangler", authorEmail: "operator@example.com", deployedAt: "2026-10-19T10:00:00.000Z" });
    expect(await sync(thirdRun)).toEqual({ sites: 3, synced: 3, failed: 0 });
    expect((await owner!.query("select live_version_id from site where id = $1", [siteIds.paving])).rows[0].live_version_id).toBe("paving-v3");
    expect(await count("site_deployment", siteIds.paving)).toBe(3);
    const previews = (await owner!.query<{ version_id: string }>("select version_id from site_preview where site_id = $1 order by captured_at", [siteIds.paving])).rows;
    expect(previews.map((row) => row.version_id)).toEqual(["paving-v2", "paving-v3"]);
    expect(screenshots).toBe(4);
  });

  it("refreshes a preview older than a day and keeps only the newest three preview objects", async () => {
    await owner!.query("update site_preview set captured_at = captured_at - interval '25 hours' where site_id = $1", [siteIds.paving]);
    const fourthRun = new Date(thirdRun.getTime() + 60 * 60 * 1000);
    expect(await sync(fourthRun, "fleet")).toEqual({ sites: 2, synced: 2, failed: 0 });
    expect(await count("site_preview", siteIds.paving)).toBe(3);
    expect(deleted).toEqual([]);
    await owner!.query("update site_preview set captured_at = captured_at - interval '25 hours' where site_id = $1", [siteIds.paving]);
    const fifthRun = new Date(fourthRun.getTime() + 60 * 60 * 1000);
    expect(await sync(fifthRun, "fleet")).toEqual({ sites: 2, synced: 2, failed: 0 });
    const previews = (await owner!.query<{ object_key: string }>("select object_key from site_preview where site_id = $1 order by captured_at", [siteIds.paving])).rows;
    expect(previews).toHaveLength(4);
    expect(deleted).toEqual([previews[0].object_key]);
    expect([...stored.keys()].filter((key) => key.startsWith(`sites/${siteIds.paving}/`))).toEqual(previews.slice(1).map((row) => row.object_key));
    expect(await sync(new Date(fifthRun.getTime() + 10 * 60 * 1000), "fleet")).toEqual({ sites: 2, synced: 2, failed: 0 });
    expect(await count("site_preview", siteIds.paving)).toBe(4);
  });

  it("records failed checks and keeps syncing the other Sites when one fails", async () => {
    failingTraffic.add("paving");
    checkStatus.set("pocatelloroofing.com", 503);
    checkStatus.set("carsoncitysolar.com", "unreachable");
    const run = new Date(thirdRun.getTime() + 3 * 60 * 60 * 1000);
    const before = await count("site_check", siteIds.paving);
    expect(await sync(run)).toEqual({ sites: 3, synced: 2, failed: 1 });
    expect(await count("site_check", siteIds.paving)).toBe(before);
    const roofing = (await owner!.query("select status_code, ok, error from site_check where site_id = $1 order by checked_at desc limit 1", [siteIds.roofing])).rows[0];
    expect(roofing).toEqual({ status_code: 503, ok: false, error: null });
    const solar = (await owner!.query("select status_code, response_ms, ok, error from site_check where site_id = $1 order by checked_at desc limit 1", [siteIds.solar])).rows[0];
    expect(solar).toEqual({ status_code: null, response_ms: null, ok: false, error: "fetch failed: getaddrinfo ENOTFOUND" });
    const connection = (await owner!.query("select last_failure_detail, last_synced_at from cloudflare_connection where organization_id = 'fleet'")).rows[0];
    expect(connection).toEqual({ last_failure_detail: "Cloudflare request failed (HTTP 503)", last_synced_at: run });
    failingTraffic.clear();
    checkStatus.clear();
  });

  it("derives Site Health from the stored rows on every Site read and the Workspace list stats", async () => {
    await owner!.query("insert into site_link (id, organization_id, site_id, workspace_id, started_at, started_by_user_id) values ('north-link', 'fleet', $1, 'north', now(), 'fleet-operator')", [siteIds.paving]);
    await owner!.query("insert into site_link (id, organization_id, site_id, workspace_id, started_at, started_by_user_id) values ('south-link', 'fleet', $1, 'south', now(), 'fleet-operator')", [siteIds.roofing]);
    const sites = createSites(runtime!, operator());
    const analytics = createAnalytics(runtime!, operator());
    expect(await sites.findLinked("north")).toMatchObject({ id: siteIds.paving, health: "Healthy", healthReason: null });
    expect(await sites.findLinked("south")).toMatchObject({ id: siteIds.roofing, health: "Healthy", healthReason: null });

    checkStatus.set("pocatelloroofing.com", 500);
    await sync(new Date(thirdRun.getTime() + 4 * 60 * 60 * 1000), "fleet");
    expect(await sites.findLinked("south")).toMatchObject({ health: "Down", healthReason: "Two consecutive checks failed" });
    checkStatus.clear();

    await owner!.query("update site_hostname set certificate_id = null where site_id = $1 and hostname like 'www.%'", [siteIds.paving]);
    expect(await sites.findLinked("north")).toMatchObject({ health: "Warning", healthReason: "A hostname has no active certificate" });
    await owner!.query("update site_hostname set certificate_id = 'cert-paving-www', enabled = false where site_id = $1 and hostname like 'www.%'", [siteIds.paving]);
    expect(await sites.findLinked("north")).toMatchObject({ health: "Healthy", healthReason: null });

    await owner!.query("update site_metric_day set errors = 20 where site_id = $1 and day >= current_date - 1", [siteIds.paving]);
    expect(await sites.findLinked("north")).toMatchObject({ health: "Warning", healthReason: "Worker errors above 5% in the last 24 hours" });
    await owner!.query("update site_metric_day set errors = 1, visits = 0 where site_id = $1 and day >= current_date - 1", [siteIds.paving]);
    expect(await sites.findLinked("north")).toMatchObject({ health: "Warning", healthReason: "No visits for 48 hours" });

    const picker = await sites.listForPicker({ search: "paving" });
    expect(picker.sites).toEqual([expect.objectContaining({ id: siteIds.paving, health: "Warning", healthReason: "No visits for 48 hours" })]);
    const listed = await createCloudflareConnection({ pool: runtime!, organizationId: "fleet", cloudflare, masterKey }).listCloudflareSites();
    expect(listed.map((entry) => [entry.scriptName, entry.health, entry.healthReason])).toEqual([["paving", "Warning", "No visits for 48 hours"], ["roofing", "Down", "Two consecutive checks failed"]]);
    const stats = await analytics.workspaceListStats(["north", "south"]);
    expect(stats.north.siteHealth).toBe("Warning");
    expect(stats.south.siteHealth).toBe("Down");

    await owner!.query("update site_link set ended_at = now() where id = 'south-link'");
    expect((await analytics.workspaceListStats(["south"])).south.siteHealth).toBeNull();
  });
});
