/**
 * -------------------------------------------------------------------------
 * @file   cloudflare-connection.test.ts
 * @brief  Verifies the Organization Cloudflare connection through routes.
 *
 * @description
 *  Exercises Cloudflare credential security, Site discovery on connect and
 *  sync, provider health, the Sites list with link state and 30-day
 *  visits, disconnect protection while a Site Link is open, and
 *  Organization isolation.
 *
 * @remarks
 *  The suite uses one PostgreSQL container, real Better Auth sessions, and a
 *  deterministic in-memory Cloudflare provider boundary.
 *
 * @see
 *  data/integrations-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./test-database";

import type { OpenedDatabase } from "@/data/database";
import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { CloudflareClientError, type CloudflareClient, type CloudflareSite } from "@/data/cloudflare-client";
import { createE2eCloudflareFake } from "@/data/e2e-cloudflare-fake";
import { createIntegrationsHandler } from "@/data/integrations-handler";
import { migrateDatabase } from "@/data/migrate";
import { createTracerAuth } from "@/data/tracer-auth";
import type { TwilioClient } from "@/data/twilio-client";
import type { TransactionalEmailMessage } from "@/data/transactional-email";

const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const accountId = "0123456789abcdef0123456789abcdef";
const firstToken = "first-synthetic-cloudflare-token";
const secondToken = "second-synthetic-cloudflare-token";

let container: StartedPostgreSqlContainer | undefined;
let database: OpenedDatabase | undefined;
let organizationId = "";
let operatorId = "";
const messages: TransactionalEmailMessage[] = [];
const backgroundTasks: Promise<unknown>[] = [];
const acceptedTokens = new Set([firstToken, secondToken]);
const fakeSites = createE2eCloudflareFake();
let sites: CloudflareSite[] = [];
let unavailable = false;
const verifiedTokens: string[] = [];

const fakeTwilio: TwilioClient = {
  async fetchAccount() { throw new Error("not implemented"); },
  async listIncomingPhoneNumbers() { throw new Error("not implemented"); },
  async fetchIncomingPhoneNumber() { throw new Error("not implemented"); },
  async updateIncomingPhoneNumberVoice() { throw new Error("not implemented"); },
};

function authorize(token: string): void {
  if (unavailable) throw new CloudflareClientError("provider_unavailable", null);
  if (!acceptedTokens.has(token)) throw new CloudflareClientError("authentication_failed", 401);
}

const fakeCloudflare: CloudflareClient = {
  async verifyToken(credential) {
    verifiedTokens.push(credential.apiToken);
    authorize(credential.apiToken);
    return { status: "active" };
  },
  async listSites(credential) {
    authorize(credential.apiToken);
    return sites;
  },
  async listDeployments() { throw new Error("not implemented"); },
  async fetchDailyTraffic() { throw new Error("not implemented"); },
  async captureScreenshot() { throw new Error("not implemented"); },
};


const auth = () => createTracerAuth({
  database: database!.drizzle,
  email: { async send(message) { messages.push(message); return { messageId: `email-${messages.length}` }; } },
  emailFrom: "auth@example.com",
  allowedRecipients: new Set(["operator@example.com"]),
  backgroundTask: (promise) => backgroundTasks.push(promise),
  secret: "integration-only-secret",
  baseURL: "http://localhost:3000",
});

function handler(overrides: { masterKey?: string } = {}) {
  return createIntegrationsHandler({
    auth: auth(),
    database: database!,
    twilio: fakeTwilio,
    cloudflare: fakeCloudflare,
    masterKey: overrides.masterKey ?? masterKey,
    configuration: { twilioMasterKey: true, hyperdrive: true, email: true, emailFrom: "auth@example.com", emailAllowlistCount: 1, r2: false, r2Bucket: null, openai: false, triggerdev: false },
    email: { async send(message) { messages.push(message); return { messageId: `email-${messages.length}` }; } },
    emailFrom: "auth@example.com",
    allowedRecipients: new Set(["operator@example.com"]),
  });
}

async function signIn(email: string): Promise<string> {
  const currentMessages = messages.length;
  const currentTasks = backgroundTasks.length;
  const instance = auth();
  const send = await instance.handler(new Request("http://localhost:3000/api/auth/email-otp/send-verification-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, type: "sign-in" }) }));
  expect(send.status).toBe(200);
  await Promise.all(backgroundTasks.splice(currentTasks));
  const code = messages.slice(currentMessages).at(-1)?.text.match(/\d{6}/)?.[0];
  const verify = await instance.handler(new Request("http://localhost:3000/api/auth/sign-in/email-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, otp: code }) }));
  expect(verify.status).toBe(200);
  return (verify.headers.get("set-cookie") ?? "").split(";", 1)[0];
}

async function json(request: Request, routeHandler = handler()): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await routeHandler(request);
  return { response, body: await response.json() as Record<string, unknown> };
}

function post(cookie: string, route: string, body?: unknown): Request {
  return new Request(`http://localhost:3000/api/integrations/${route}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  database = createTestDatabase(container.getConnectionUri());
  await migrateDatabase(container.getConnectionUri());
  const bootstrapped = await bootstrapInitialOperator(database, { email: "operator@example.com", name: "Example Operator", timezone: "America/Chicago" });
  organizationId = bootstrapped.organizationId;
  operatorId = bootstrapped.userId;
  sites = await fakeSites.listSites({ accountId, apiToken: firstToken });
  await database.query("insert into organization (id, name, slug, created_at) values ('other-organization-id', 'Other Org', 'other-org', now())");
  await database.query(
    `insert into site (id, organization_id, script_name, primary_hostname, zone_id, first_seen_at, last_seen_at, created_at, updated_at)
     values ('other-site-id', 'other-organization-id', 'other-script', 'other.example', 'zone-other', now(), now(), now(), now())`,
  );
}, 120_000);

afterAll(async () => {
  await database?.close();
  await container?.stop();
});

describe.sequential("Organization Cloudflare connection", () => {
  it("rejects malformed and provider-rejected credentials without storing them", async () => {
    const cookie = await signIn("operator@example.com");
    const malformed = await json(post(cookie, "cloudflare/connect", { accountId: "not-an-account", apiToken: firstToken }));
    expect(malformed.response.status).toBe(400);
    const rejected = await json(post(cookie, "cloudflare/connect", { accountId, apiToken: "rejected-token" }));
    expect(rejected.response.status).toBe(422);
    await expect(database!.query("select count(*) from cloudflare_connection where organization_id = $1", [organizationId])).resolves.toMatchObject({ rows: [{ count: "0" }] });
    expect((await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }))).body.cloudflare).toBeNull();
  });

  it("connects, encrypts the token, never returns it, and discovers the Sites with a custom domain", async () => {
    const cookie = await signIn("operator@example.com");
    const connected = await json(post(cookie, "cloudflare/connect", { accountId, apiToken: firstToken }));
    expect(connected.response.status).toBe(201);
    expect(connected.body.connection).toMatchObject({ accountId, connectedBy: { id: operatorId, name: "Example Operator" }, siteCount: 6, lastVerifiedAt: expect.any(String), lastSyncedAt: expect.any(String) });
    expect(JSON.stringify(connected.body)).not.toContain(firstToken);
    expect(JSON.stringify(connected.body)).not.toContain("iphertext");
    const stored = await database!.query<{ api_token_ciphertext: string }>("select api_token_ciphertext from cloudflare_connection where organization_id = $1", [organizationId]);
    expect(stored.rows[0]?.api_token_ciphertext).toMatch(/^v1:/);
    expect(stored.rows[0]?.api_token_ciphertext).not.toContain(firstToken);
    const discovered = await database!.query<{ script_name: string; primary_hostname: string; hostnames: string }>(
      `select s.script_name, s.primary_hostname, count(h.id)::text as hostnames
         from site s left join site_hostname h on h.site_id = s.id
        where s.organization_id = $1 group by s.id order by s.script_name`,
      [organizationId],
    );
    expect(discovered.rows).toEqual([
      { script_name: "asphalt-paving-blackfoot", primary_hostname: "asphaltpavingblackfoot.com", hostnames: "2" },
      { script_name: "asphalt-paving-pocatello", primary_hostname: "pocatelloasphaltpaving.com", hostnames: "2" },
      { script_name: "asphalt-paving-st-george", primary_hostname: "asphaltpavingstgeorge.com", hostnames: "2" },
      { script_name: "dumpster-rental-haines-city", primary_hostname: "dumpsterrentalhainescity.com", hostnames: "2" },
      { script_name: "idaho-falls-solar-installation", primary_hostname: "idahofallssolarinstallation.com", hostnames: "1" },
      { script_name: "solar-panel-sites", primary_hostname: "carsoncitysolarinstallation.com", hostnames: "1" },
    ]);
    const duplicate = await json(post(cookie, "cloudflare/connect", { accountId, apiToken: firstToken }));
    expect(duplicate.response.status).toBe(409);
  });

  it("reports the Cloudflare connection in provider health and the overview", async () => {
    const cookie = await signIn("operator@example.com");
    const overview = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    expect(overview.body.cloudflare).toMatchObject({ accountId, siteCount: 6 });
    expect(JSON.stringify(overview.body)).not.toContain(firstToken);
    const providers = overview.body.providers as Array<{ id: string; state: string; identifier: string | null }>;
    expect(providers.map((provider) => provider.id)).toEqual(["twilio", "cloudflare", "dataforseo", "hyperdrive", "email", "r2", "openai", "triggerdev"]);
    expect(providers[1]).toMatchObject({ state: "connected", identifier: accountId });
  });

  it("lists the Organization Sites with hostnames, link state, 30-day visits, and health", async () => {
    const cookie = await signIn("operator@example.com");
    const pocatello = await database!.query<{ id: string }>("select id from site where organization_id = $1 and script_name = 'asphalt-paving-pocatello'", [organizationId]);
    const siteId = pocatello.rows[0].id;
    await database!.query(
      `insert into site_metric_day (id, site_id, day, visits, page_views, requests, errors, synced_at) values
         ('metric-today', $1, current_date, 10, 20, 40, 0, now()),
         ('metric-29', $1, current_date - 29, 5, 10, 20, 0, now()),
         ('metric-30', $1, current_date - 30, 100, 200, 400, 0, now())`,
      [siteId],
    );
    await database!.query(
      `insert into workspace (id, organization_id, name, reporting_timezone, state, created_at, updated_at)
       values ('linked-workspace-id', $1, 'Pocatello Paving', 'America/Boise', 'Setup Required', now(), now())`,
      [organizationId],
    );
    await database!.query(
      `insert into site_link (id, organization_id, site_id, workspace_id, started_at, started_by_user_id) values ('link-1', $1, $2, 'linked-workspace-id', now(), $3)`,
      [organizationId, siteId, operatorId],
    );
    const listed = await json(new Request("http://localhost:3000/api/integrations/cloudflare/sites", { headers: { cookie } }));
    expect(listed.response.status).toBe(200);
    const rows = listed.body.sites as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.primaryHostname)).not.toContain("other.example");
    expect(rows.find((row) => row.id === siteId)).toEqual({
      id: siteId,
      scriptName: "asphalt-paving-pocatello",
      primaryHostname: "pocatelloasphaltpaving.com",
      hostnames: [
        { hostname: "pocatelloasphaltpaving.com", certificateId: expect.any(String), enabled: true },
        { hostname: "www.pocatelloasphaltpaving.com", certificateId: expect.any(String), enabled: true },
      ],
      lastDeployedAt: null,
      liveVersionId: null,
      linkedWorkspace: { id: "linked-workspace-id", name: "Pocatello Paving" },
      visits30d: 15,
      health: "Unknown",
      healthReason: null,
    });
    expect(rows.find((row) => row.scriptName === "solar-panel-sites")).toMatchObject({ linkedWorkspace: null, visits30d: 0 });
  });

  it("records test failures without discarding the last success and clears them on recovery", async () => {
    const cookie = await signIn("operator@example.com");
    const before = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    unavailable = true;
    const failed = await json(post(cookie, "cloudflare/test"));
    expect(failed.response.status).toBe(502);
    const degraded = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    expect(degraded.body.cloudflare).toMatchObject({ lastVerifiedAt: (before.body.cloudflare as { lastVerifiedAt: string }).lastVerifiedAt, lastFailureDetail: expect.any(String) });
    expect((degraded.body.providers as Array<{ id: string; state: string }>).find((provider) => provider.id === "cloudflare")?.state).toBe("degraded");
    unavailable = false;
    const restored = await json(post(cookie, "cloudflare/test"));
    expect(restored.response.status).toBe(200);
    expect(restored.body.connection).toMatchObject({ lastFailureAt: null });
  });

  it("verifies the replacement token before rotating it", async () => {
    const cookie = await signIn("operator@example.com");
    const rejected = await json(post(cookie, "cloudflare/rotate", { apiToken: "rejected-token" }));
    expect(rejected.response.status).toBe(422);
    const before = await database!.query<{ api_token_ciphertext: string }>("select api_token_ciphertext from cloudflare_connection where organization_id = $1", [organizationId]);
    const rotated = await json(post(cookie, "cloudflare/rotate", { apiToken: secondToken }));
    expect(rotated.response.status).toBe(200);
    const after = await database!.query<{ api_token_ciphertext: string }>("select api_token_ciphertext from cloudflare_connection where organization_id = $1", [organizationId]);
    expect(after.rows[0].api_token_ciphertext).not.toBe(before.rows[0].api_token_ciphertext);
    verifiedTokens.length = 0;
    await json(post(cookie, "cloudflare/test"));
    expect(verifiedTokens).toEqual([secondToken]);
  });

  it("reports Needs re-entry under a different master key, records it when a sync is attempted, and recovers on rotation", async () => {
    const cookie = await signIn("operator@example.com");
    const rotatedKey = "ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=";
    const underRotatedKey = handler({ masterKey: rotatedKey });
    const health = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }), underRotatedKey);
    expect(health.body.cloudflare).toMatchObject({ credentialState: "unreadable" });
    expect((health.body.providers as Array<{ id: string; state: string }>).find((provider) => provider.id === "cloudflare")?.state).toBe("needs_reentry");
    const synced = await json(post(cookie, "cloudflare/sync"), underRotatedKey);
    expect(synced.response.status).toBe(409);
    expect(synced.body).toMatchObject({ error: "credential_unreadable" });
    const recorded = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }), underRotatedKey);
    expect(recorded.body.cloudflare).toMatchObject({ lastFailureDetail: expect.stringContaining("different master key") });
    const rotated = await json(post(cookie, "cloudflare/rotate", { apiToken: secondToken }), underRotatedKey);
    expect(rotated.response.status).toBe(200);
    expect(rotated.body.connection).toMatchObject({ credentialState: "readable", lastFailureAt: null });
    expect((await json(post(cookie, "cloudflare/rotate", { apiToken: secondToken }))).body.connection).toMatchObject({ credentialState: "readable" });
  });

  it("syncs Sites, marking a Worker that lost its domains removed and restoring it when they return", async () => {
    const cookie = await signIn("operator@example.com");
    const all = sites;
    sites = all.filter((site) => site.scriptName !== "solar-panel-sites");
    const synced = await json(post(cookie, "cloudflare/sync"));
    expect(synced.response.status).toBe(200);
    expect(synced.body).toMatchObject({ siteCount: 5, syncedAt: expect.any(String) });
    const removed = await database!.query<{ removed_at: Date | null }>("select removed_at from site where organization_id = $1 and script_name = 'solar-panel-sites'", [organizationId]);
    expect(removed.rows[0].removed_at).not.toBeNull();
    const listed = await json(new Request("http://localhost:3000/api/integrations/cloudflare/sites", { headers: { cookie } }));
    expect((listed.body.sites as Array<{ scriptName: string }>).map((site) => site.scriptName)).not.toContain("solar-panel-sites");
    sites = all;
    await json(post(cookie, "cloudflare/sync"));
    const restored = await database!.query<{ removed_at: Date | null; count: string }>("select removed_at, (select count(*) from site where organization_id = $1)::text as count from site where organization_id = $1 and script_name = 'solar-panel-sites'", [organizationId]);
    expect(restored.rows[0]).toEqual({ removed_at: null, count: "6" });
    const overview = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    expect(overview.body.cloudflare).toMatchObject({ lastSyncedAt: synced.body.syncedAt === undefined ? expect.any(String) : expect.any(String), siteCount: 6 });
  });

  it("blocks disconnect while a Site Link is open and removes the credential afterwards", async () => {
    const cookie = await signIn("operator@example.com");
    const blocked = await json(post(cookie, "cloudflare/disconnect"));
    expect(blocked.response.status).toBe(409);
    expect(blocked.body).toEqual({ error: "active_site_links", activeSiteLinkCount: 1 });
    await database!.query("update site_link set ended_at = now() where id = 'link-1'");
    const disconnected = await json(post(cookie, "cloudflare/disconnect"));
    expect(disconnected.response.status).toBe(200);
    await expect(database!.query("select count(*) from cloudflare_connection where organization_id = $1", [organizationId])).resolves.toMatchObject({ rows: [{ count: "0" }] });
    await expect(database!.query("select count(*) from site where organization_id = $1", [organizationId])).resolves.toMatchObject({ rows: [{ count: "6" }] });
    const overview = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    expect(overview.body.cloudflare).toBeNull();
    const test = await json(post(cookie, "cloudflare/test"));
    expect(test.response.status).toBe(404);
  });
});
