/**
 * -------------------------------------------------------------------------
 * @file   sites.test.ts
 * @brief  Verifies Site Links and Site reads through Workspace routes.
 *
 * @description
 *  Exercises the Operator Site picker, linking, replacing, and detaching a
 *  Site without any Cloudflare write, the one-open-link-per-Workspace and
 *  per-Site invariants, the Client Viewer redaction of hosting details,
 *  the traffic summary from stored metric days, and the Site Link ending
 *  when a Workspace is archived.
 *
 * @remarks
 *  The Cloudflare fake throws on every call, which proves no route touches
 *  the provider.
 *
 * @see
 *  data/sites.ts
 *  data/workspaces-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./test-pool";

import type { Database } from "@/data/database";
import type { Actor } from "@/data/authorization";
import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { upsertDiscoveredSites } from "@/data/cloudflare-connection";
import { createE2eCloudflareFake } from "@/data/e2e-cloudflare-fake";
import { createIntegrations } from "@/data/integrations";
import { migrateDatabase } from "@/data/migrate";
import { createSites } from "@/data/sites";
import { createTracerAuth } from "@/data/tracer-auth";
import type { TwilioClient } from "@/data/twilio-client";
import { createWorkspaces } from "@/data/workspaces";
import { createWorkspacesHandler } from "@/data/workspaces-handler";
import type { TransactionalEmailMessage } from "@/data/transactional-email";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let database: Database | undefined;
let organizationId = "";
let operatorId = "";
const viewerId = "viewer-user-id";
const messages: TransactionalEmailMessage[] = [];
const backgroundTasks: Promise<unknown>[] = [];
const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const siteIds: Record<string, string> = {};

const fakeTwilio: TwilioClient = {
  async fetchAccount() { throw new Error("not implemented"); },
  async listIncomingPhoneNumbers() { throw new Error("not implemented"); },
  async fetchIncomingPhoneNumber() { throw new Error("not implemented"); },
  async updateIncomingPhoneNumberVoice() { throw new Error("not implemented"); },
};

const auth = () => createTracerAuth({
  database: database!.drizzle,
  email: { async send(message) { messages.push(message); return { messageId: `email-${messages.length}` }; } },
  emailFrom: "auth@example.com",
  allowedRecipients: new Set(["operator@example.com", "viewer@example.com"]),
  backgroundTask: (promise) => backgroundTasks.push(promise),
  secret: "integration-only-secret",
  baseURL: "http://localhost:3000",
});

function handler() {
  return createWorkspacesHandler({
    auth: auth(),
    pool: pool!, database: database!,
    twilio: fakeTwilio,
    integrations: (orgId) => createIntegrations({ database: database!, organizationId: orgId, twilio: fakeTwilio, masterKey }),
    baseURL: "http://localhost:3000",
  });
}

async function signIn(email: string): Promise<string> {
  const before = messages.length;
  const taskCount = backgroundTasks.length;
  const instance = auth();
  const send = await instance.handler(new Request("http://localhost:3000/api/auth/email-otp/send-verification-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, type: "sign-in" }) }));
  expect(send.status).toBe(200);
  await Promise.all(backgroundTasks.splice(taskCount));
  const code = messages.slice(before).at(-1)?.text.match(/\d{6}/)?.[0];
  const verify = await instance.handler(new Request("http://localhost:3000/api/auth/sign-in/email-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, otp: code }) }));
  expect(verify.status).toBe(200);
  return (verify.headers.get("set-cookie") ?? "").split(";", 1)[0];
}

async function json(request: Request): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await handler()(request);
  return { response, body: await response.json() as Record<string, unknown> };
}

function get(cookie: string, route: string): Request {
  return new Request(`http://localhost:3000/api/workspaces/${route}`, { headers: { cookie } });
}

function post(cookie: string, route: string, body?: unknown): Request {
  return new Request(`http://localhost:3000/api/workspaces/${route}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

function operatorActor(): Actor {
  return { userId: operatorId, organizationId, name: "Example Operator", email: "operator@example.com", timezone: "America/Chicago", state: "Active", role: "Operator" };
}

async function openLinks(workspaceId: string): Promise<{ site_id: string; ended_at: Date | null }[]> {
  const result = await pool!.query<{ site_id: string; ended_at: Date | null }>("select site_id, ended_at from site_link where workspace_id = $1 order by started_at", [workspaceId]);
  return result.rows;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  database = createTestDatabase(container.getConnectionUri());
  pool = database.pool;
  await migrateDatabase(container.getConnectionUri());
  const bootstrapped = await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "Example Operator", timezone: "America/Chicago" });
  organizationId = bootstrapped.organizationId;
  operatorId = bootstrapped.userId;
  await pool.query(
    `insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at)
     values ($1, 'Client Viewer', 'viewer@example.com', false, 'Active', 'UTC', now(), now())`,
    [viewerId],
  );
  await pool.query("insert into member (id, organization_id, user_id, role, created_at) values ('viewer-membership-id', $1, $2, 'member', now())", [organizationId, viewerId]);
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, created_at, updated_at) values
       ('workspace-a', $1, 'Pocatello Paving', 'UTC', 'Active', now(), now()),
       ('workspace-b', $1, 'St George Paving', 'America/Denver', 'Setup Required', now(), now()),
       ('workspace-c', $1, 'Blackfoot Paving', 'America/Boise', 'Setup Required', now(), now())`,
    [organizationId],
  );
  await pool.query("insert into access_grant (id, organization_id, workspace_id, user_id, created_at) values ('grant-a', $1, 'workspace-a', $2, now())", [organizationId, viewerId]);
  await pool.query("insert into organization (id, name, slug, created_at) values ('other-organization-id', 'Other Org', 'other-org', now())");
  await pool.query(
    `insert into site (id, organization_id, script_name, primary_hostname, zone_id, first_seen_at, last_seen_at, created_at, updated_at)
     values ('other-site-id', 'other-organization-id', 'other-script', 'other.example', 'zone-other', now(), now(), now(), now())`,
  );
  const discovered = await createE2eCloudflareFake().listSites({ accountId: "0123456789abcdef0123456789abcdef", apiToken: "token" });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await upsertDiscoveredSites(client, organizationId, discovered, new Date("2026-10-19T12:00:00.000Z"));
    await client.query("commit");
  } finally {
    client.release();
  }
  const rows = await pool.query<{ id: string; script_name: string }>("select id, script_name from site where organization_id = $1", [organizationId]);
  for (const row of rows.rows) siteIds[row.script_name] = row.id;
  await pool.query(
    `insert into site_deployment (id, site_id, version_id, source, author_email, deployed_at)
     values ('deployment-1', $1, '9f8e7d6c-5b4a-4321-8765-4321fedcba98', 'wrangler', 'operator@example.com', '2026-10-11T23:12:59.000Z'),
            ('deployment-0', $1, '1a2b3c4d-0000-4000-8000-000000000000', 'dash', null, '2026-10-01T09:00:00.000Z')`,
    [siteIds["asphalt-paving-pocatello"]],
  );
  await pool.query(
    `insert into site_deployment (id, site_id, version_id, source, author_email, deployed_at)
     select 'sg-deployment-' || n, $1, 'sg-version-' || lpad(n::text, 2, '0'), 'wrangler', null, timestamptz '2026-09-01T00:00:00Z' + make_interval(days => n)
       from generate_series(1, 11) as n`,
    [siteIds["asphalt-paving-st-george"]],
  );
  await pool.query("update site set live_version_id = '9f8e7d6c-5b4a-4321-8765-4321fedcba98', last_deployed_at = '2026-10-11T23:12:59.000Z' where id = $1", [siteIds["asphalt-paving-pocatello"]]);
  await pool.query(
    `insert into site_check (id, site_id, checked_at, status_code, response_ms, ok, error) values
       ('check-0', $1, now() - interval '40 days', null, null, false, 'timeout'),
       ('check-1', $1, now() - interval '3 hours', 503, 900, false, null),
       ('check-2', $1, now() - interval '2 hours', 200, 180, true, null),
       ('check-3', $1, now() - interval '1 hour', 200, 210, true, null)`,
    [siteIds["asphalt-paving-pocatello"]],
  );
  await pool.query(
    `insert into site_preview (id, site_id, version_id, object_key, captured_at, byte_size) values ('preview-1', $1, '9f8e7d6c-5b4a-4321-8765-4321fedcba98', 'sites/x/preview-9f8e7d6c.jpg', '2026-10-19T12:05:00.000Z', 1024)`,
    [siteIds["asphalt-paving-pocatello"]],
  );
  await pool.query(
    `insert into site_metric_day (id, site_id, day, visits, page_views, requests, errors, top_paths, referrers, devices, lcp_ms, inp_ms, cls, synced_at) values
       ('m-1', $1, current_date, 10, 20, 40, 1, '[["/", 12], ["/services", 5], ["/contact", 3]]', '[["", 7], ["www.google.com", 3]]', '[["mobile", 7], ["desktop", 3]]', 1200, 90, 0.020, now()),
       ('m-2', $1, current_date - 1, 20, 40, 80, 0, '[["/", 25], ["/about", 9], ["/contact", 6]]', '[["", 14], ["www.google.com", 5], ["www.bing.com", 1]]', '[["mobile", 15], ["desktop", 5]]', 1400, 110, 0.040, now()),
       ('m-3', $1, current_date - 8, 100, 200, 400, 0, '[["/", 100]]', '[["", 100]]', '[["mobile", 100]]', 2000, 200, 0.100, now())`,
    [siteIds["asphalt-paving-pocatello"]],
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe.sequential("Sites", () => {
  it("lists the Organization Sites for the Operator picker with link state, search, and paging", async () => {
    const sites = createSites(pool!, operatorActor());
    const firstPage = await sites.listForPicker({});
    expect(firstPage).toMatchObject({ total: 6, page: 1, pageSize: 5 });
    expect(firstPage.sites).toHaveLength(5);
    expect(firstPage.sites.map((site) => site.primaryHostname)).not.toContain("other.example");
    const secondPage = await sites.listForPicker({ page: 2 });
    expect(secondPage.sites).toHaveLength(1);
    const searched = await sites.listForPicker({ search: "pocatello" });
    expect(searched.sites).toEqual([expect.objectContaining({ id: siteIds["asphalt-paving-pocatello"], primaryHostname: "pocatelloasphaltpaving.com", linkedWorkspace: null, visits30d: 130, health: "Unknown", lastDeployedAt: "2026-10-11T23:12:59.000Z" })]);
    const cookie = await signIn("operator@example.com");
    const listed = await json(get(cookie, "sites?search=solar&pageSize=1"));
    expect(listed.response.status).toBe(200);
    expect(listed.body).toMatchObject({ total: 2, page: 1, pageSize: 1 });
  });

  it("links a Site to a Workspace once and refuses a second open Site Link per Site or per Workspace", async () => {
    const cookie = await signIn("operator@example.com");
    const pocatello = siteIds["asphalt-paving-pocatello"];
    const missing = await json(post(cookie, "workspace-a/site/link", { siteId: "missing-site" }));
    expect(missing.response.status).toBe(404);
    const foreign = await json(post(cookie, "workspace-a/site/link", { siteId: "other-site-id" }));
    expect(foreign.response.status).toBe(404);
    const linked = await json(post(cookie, "workspace-a/site/link", { siteId: pocatello }));
    expect(linked.response.status).toBe(200);
    expect(linked.body.site).toMatchObject({
      id: pocatello,
      scriptName: "asphalt-paving-pocatello",
      primaryHostname: "pocatelloasphaltpaving.com",
      hostnames: [expect.objectContaining({ hostname: "pocatelloasphaltpaving.com" }), expect.objectContaining({ hostname: "www.pocatelloasphaltpaving.com" })],
      liveVersionId: "9f8e7d6c-5b4a-4321-8765-4321fedcba98",
      lastDeployment: { versionId: "9f8e7d6c-5b4a-4321-8765-4321fedcba98", source: "wrangler", authorEmail: "operator@example.com", deployedAt: "2026-10-11T23:12:59.000Z" },
      deployments: [
        { versionId: "9f8e7d6c-5b4a-4321-8765-4321fedcba98", source: "wrangler", authorEmail: "operator@example.com", deployedAt: "2026-10-11T23:12:59.000Z" },
        { versionId: "1a2b3c4d-0000-4000-8000-000000000000", source: "dash", authorEmail: null, deployedAt: "2026-10-01T09:00:00.000Z" },
      ],
      latestPreview: { versionId: "9f8e7d6c-5b4a-4321-8765-4321fedcba98", capturedAt: "2026-10-19T12:05:00.000Z" },
      latestCheck: { checkedAt: expect.any(String), ok: true, statusCode: 200, responseMs: 210 },
      uptime30d: { ratio: 0.6667, medianResponseMs: 210, checks: 3 },
      health: "Unknown",
      linkedAt: expect.any(String),
    });
    expect(JSON.stringify(linked.body)).not.toContain("sites/x/preview");
    const elsewhere = await json(post(cookie, "workspace-b/site/link", { siteId: pocatello }));
    expect(elsewhere.response.status).toBe(409);
    expect(elsewhere.body).toEqual({ error: "site_linked_elsewhere" });
    const already = await json(post(cookie, "workspace-a/site/link", { siteId: siteIds["asphalt-paving-st-george"] }));
    expect(already.response.status).toBe(409);
    expect(already.body).toEqual({ error: "workspace_already_linked" });
    const picker = await createSites(pool!, operatorActor()).listForPicker({ search: "pocatello" });
    expect(picker.sites[0].linkedWorkspace).toEqual({ id: "workspace-a", name: "Pocatello Paving" });
  });

  it("reads the linked Site with its summary for the requested range and redacts hosting details for a Client Viewer", async () => {
    const operator = await signIn("operator@example.com");
    const full = await json(get(operator, "workspace-a/site?range=7d"));
    expect(full.response.status).toBe(200);
    expect(full.body.site).toMatchObject({ scriptName: "asphalt-paving-pocatello", hostnames: [expect.anything(), expect.anything()] });
    expect(full.body.summary).toEqual({
      visits: 30,
      pageViews: 60,
      requests: 120,
      errors: 1,
      topPaths: [["/", 37], ["/about", 9], ["/contact", 9], ["/services", 5]],
      referrers: [["", 21], ["www.google.com", 8], ["www.bing.com", 1]],
      devices: [["mobile", 22], ["desktop", 8]],
      vitals: { lcpMs: 1333, inpMs: 103, cls: 0.033 },
      daily: expect.arrayContaining([expect.objectContaining({ visits: 10, pageViews: 20 }), expect.objectContaining({ visits: 20, pageViews: 40 })]),
    });
    expect((full.body.summary as { daily: unknown[] }).daily).toHaveLength(7);
    const none = await json(get(operator, "workspace-b/site"));
    expect(none.response.status).toBe(200);
    expect(none.body).toEqual({ site: null, summary: null });

    const viewer = await signIn("viewer@example.com");
    const redacted = await json(get(viewer, "workspace-a/site?range=7d"));
    expect(redacted.response.status).toBe(200);
    const site = redacted.body.site as Record<string, unknown>;
    expect(site).toMatchObject({
      primaryHostname: "pocatelloasphaltpaving.com",
      hostnames: [{ hostname: "pocatelloasphaltpaving.com" }],
      health: "Unknown",
      healthReason: null,
      uptime30d: { ratio: 0.6667, medianResponseMs: 210, checks: 3 },
      latestPreview: expect.objectContaining({ capturedAt: "2026-10-19T12:05:00.000Z" }),
    });
    expect(site).toHaveProperty("healthReason");
    expect(site).not.toHaveProperty("scriptName");
    expect(site).not.toHaveProperty("lastDeployment");
    expect(site).not.toHaveProperty("deployments");
    expect(site).not.toHaveProperty("liveVersionId");
    expect(JSON.stringify(redacted.body)).not.toContain("asphalt-paving-pocatello");
    expect(JSON.stringify(redacted.body)).not.toContain("9f8e7d6c");
    expect(JSON.stringify(redacted.body)).not.toContain("1a2b3c4d");
    const summary = redacted.body.summary as Record<string, unknown>;
    expect(summary).toMatchObject({ visits: 30, pageViews: 60 });
    expect(summary).not.toHaveProperty("requests");
    expect(summary).not.toHaveProperty("errors");
    const ungranted = await json(get(viewer, "workspace-b/site"));
    expect(ungranted.response.status).toBe(404);
    const forbidden = await json(post(viewer, "workspace-a/site/detach"));
    expect(forbidden.response.status).toBe(403);
    expect((await openLinks("workspace-a")).at(-1)?.ended_at).toBeNull();
  });

  it("replaces and detaches a Site by ending the open Site Link without a Cloudflare write", async () => {
    const cookie = await signIn("operator@example.com");
    const stGeorge = siteIds["asphalt-paving-st-george"];
    const replaced = await json(post(cookie, "workspace-a/site/replace", { siteId: stGeorge }));
    expect(replaced.response.status).toBe(200);
    expect(replaced.body.site).toMatchObject({
      id: stGeorge,
      lastDeployment: expect.objectContaining({ versionId: "sg-version-11" }),
      latestPreview: null,
      latestCheck: null,
      uptime30d: { ratio: null, medianResponseMs: null, checks: 0 },
    });
    const deployments = (replaced.body.site as { deployments: { versionId: string }[] }).deployments;
    expect(deployments).toHaveLength(10);
    expect(deployments.map((deployment) => deployment.versionId)).toEqual(Array.from({ length: 10 }, (_, index) => `sg-version-${String(11 - index).padStart(2, "0")}`));
    const afterReplace = await openLinks("workspace-a");
    expect(afterReplace.map((link) => [link.site_id, link.ended_at === null])).toEqual([[siteIds["asphalt-paving-pocatello"], false], [stGeorge, true]]);
    const relinked = await json(post(cookie, "workspace-b/site/link", { siteId: siteIds["asphalt-paving-pocatello"] }));
    expect(relinked.response.status).toBe(200);
    const detached = await json(post(cookie, "workspace-a/site/detach"));
    expect(detached.response.status).toBe(200);
    expect(detached.body).toEqual({ detached: true });
    expect((await openLinks("workspace-a")).every((link) => link.ended_at !== null)).toBe(true);
    const again = await json(post(cookie, "workspace-a/site/detach"));
    expect(again.response.status).toBe(404);
    expect((await json(get(cookie, "workspace-a/site"))).body).toEqual({ site: null, summary: null });
  });

  it("ends the open Site Link when the Workspace is archived", async () => {
    const cookie = await signIn("operator@example.com");
    const blackfoot = siteIds["asphalt-paving-blackfoot"];
    expect((await json(post(cookie, "workspace-c/site/link", { siteId: blackfoot }))).response.status).toBe(200);
    const archived = await json(post(cookie, "workspace-c/archive"));
    expect(archived.response.status).toBe(200);
    expect((await openLinks("workspace-c")).map((link) => link.ended_at !== null)).toEqual([true]);

    await createWorkspaces(database!, organizationId).restore("workspace-c");
    expect((await json(post(cookie, "workspace-c/site/link", { siteId: blackfoot }))).response.status).toBe(200);
    await createWorkspaces(database!, organizationId).archive("workspace-c");
    expect((await openLinks("workspace-c")).map((link) => link.ended_at !== null)).toEqual([true, true]);
    expect((await json(post(cookie, "workspace-b/site/link", { siteId: blackfoot }))).response.status).toBe(409);
    const picker = await createSites(pool!, operatorActor()).listForPicker({ search: "blackfoot" });
    expect(picker.sites[0].linkedWorkspace).toBeNull();
  });
});
