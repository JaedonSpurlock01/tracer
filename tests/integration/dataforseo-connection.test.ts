/**
 * -------------------------------------------------------------------------
 * @file   dataforseo-connection.test.ts
 * @brief  Verifies the Organization DataForSEO connection through routes.
 *
 * @description
 *  Exercises DataForSEO credential security, provider health, Keywords
 *  tracked and lookups this month on the connection record, test failures
 *  and recovery, rotation, and disconnect.
 *
 * @remarks
 *  The suite uses one PostgreSQL container, real Better Auth sessions, and a
 *  deterministic in-memory DataForSEO provider boundary.
 *
 * @see
 *  data/integrations-handler.ts
 *  data/dataforseo-connection.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import type { CloudflareClient } from "@/data/cloudflare-client";
import { DataForSeoClientError, type DataForSeoClient } from "@/data/dataforseo-client";
import { createIntegrationsHandler } from "@/data/integrations-handler";
import { migrateDatabase } from "@/data/migrate";
import { schema } from "@/data/schema";
import { createTracerAuth } from "@/data/tracer-auth";
import type { TwilioClient } from "@/data/twilio-client";
import type { TransactionalEmailMessage } from "@/data/transactional-email";

const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const login = "operator@example.com";
const firstPassword = "first-synthetic-dataforseo-password";
const secondPassword = "second-synthetic-dataforseo-password";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let organizationId = "";
let operatorId = "";
const messages: TransactionalEmailMessage[] = [];
const backgroundTasks: Promise<unknown>[] = [];
const acceptedPasswords = new Set([firstPassword, secondPassword]);
let unavailable = false;
const verifiedPasswords: string[] = [];

const fakeTwilio: TwilioClient = {
  async fetchAccount() { throw new Error("not implemented"); },
  async listIncomingPhoneNumbers() { throw new Error("not implemented"); },
  async fetchIncomingPhoneNumber() { throw new Error("not implemented"); },
  async updateIncomingPhoneNumberVoice() { throw new Error("not implemented"); },
};

const fakeCloudflare: CloudflareClient = {
  async verifyToken() { throw new Error("not implemented"); },
  async listSites() { throw new Error("not implemented"); },
  async listDeployments() { throw new Error("not implemented"); },
  async fetchDailyTraffic() { throw new Error("not implemented"); },
  async captureScreenshot() { throw new Error("not implemented"); },
};

const fakeDataForSeo: DataForSeoClient = {
  async verify(credential) {
    verifiedPasswords.push(credential.password);
    if (unavailable) throw new DataForSeoClientError("provider_unavailable", 503);
    if (credential.login !== login || !acceptedPasswords.has(credential.password)) throw new DataForSeoClientError("authentication_failed", 401);
    return { login: credential.login };
  },
  async serp() { throw new Error("not implemented"); },
  async listLocations() { throw new Error("not implemented"); },
};

const database = () => drizzle(pool!, { schema });

const auth = () => createTracerAuth({
  database: database(),
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
    database: database(),
    pool: pool!,
    twilio: fakeTwilio,
    cloudflare: fakeCloudflare,
    dataforseo: fakeDataForSeo,
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

function overview(cookie: string): Request {
  return new Request("http://localhost:3000/api/integrations", { headers: { cookie } });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrateDatabase(container.getConnectionUri());
  const bootstrapped = await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "Example Operator", timezone: "America/Chicago" });
  organizationId = bootstrapped.organizationId;
  operatorId = bootstrapped.userId;
  await pool.query(
    `insert into site (id, organization_id, script_name, primary_hostname, zone_id, first_seen_at, last_seen_at, created_at, updated_at)
     values ('site-pocatello', $1, 'asphalt-paving-pocatello', 'pocatelloasphaltpaving.com', 'zone-1', now(), now(), now(), now())`,
    [organizationId],
  );
  await pool.query(
    `insert into site_keyword (id, site_id, phrase, weight, created_at, updated_at, removed_at) values
       ('keyword-1', 'site-pocatello', 'asphalt paving pocatello', 5, now(), now(), null),
       ('keyword-2', 'site-pocatello', 'driveway paving pocatello', 1, now(), now(), null),
       ('keyword-removed', 'site-pocatello', 'old phrase', 1, now(), now(), now())`,
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe.sequential("Organization DataForSEO connection", () => {
  it("rejects malformed and provider-rejected credentials without storing them", async () => {
    const cookie = await signIn("operator@example.com");
    const malformed = await json(post(cookie, "dataforseo/connect", { login: "   ", password: firstPassword }));
    expect(malformed.response.status).toBe(400);
    const rejected = await json(post(cookie, "dataforseo/connect", { login, password: "rejected-password" }));
    expect(rejected.response.status).toBe(422);
    await expect(pool!.query("select count(*) from dataforseo_connection where organization_id = $1", [organizationId])).resolves.toMatchObject({ rows: [{ count: "0" }] });
    expect((await json(overview(cookie))).body.dataforseo).toBeNull();
  });

  it("connects, encrypts the password, never returns it, and counts the live Keywords", async () => {
    const cookie = await signIn("operator@example.com");
    const connected = await json(post(cookie, "dataforseo/connect", { login, password: firstPassword }));
    expect(connected.response.status).toBe(201);
    expect(connected.body.connection).toEqual({
      credentialState: "readable",
      login,
      connectedAt: expect.any(String),
      connectedBy: { id: operatorId, name: "Example Operator" },
      lastVerifiedAt: expect.any(String),
      lastFailureAt: null,
      lastFailureDetail: null,
      lastCheckedAt: null,
      lookupsThisMonth: 0,
      keywordCount: 2,
    });
    expect(JSON.stringify(connected.body)).not.toContain(firstPassword);
    expect(JSON.stringify(connected.body)).not.toContain("iphertext");
    const stored = await pool!.query<{ password_ciphertext: string }>("select password_ciphertext from dataforseo_connection where organization_id = $1", [organizationId]);
    expect(stored.rows[0]?.password_ciphertext).toMatch(/^v1:/);
    expect(stored.rows[0]?.password_ciphertext).not.toContain(firstPassword);
    const duplicate = await json(post(cookie, "dataforseo/connect", { login, password: firstPassword }));
    expect(duplicate.response.status).toBe(409);
  });

  it("reports the DataForSEO connection in provider health after Cloudflare", async () => {
    const cookie = await signIn("operator@example.com");
    const body = (await json(overview(cookie))).body;
    expect(body.dataforseo).toMatchObject({ login, keywordCount: 2 });
    expect(JSON.stringify(body)).not.toContain(firstPassword);
    const providers = body.providers as Array<{ id: string; name: string; state: string; identifier: string | null; testable: boolean }>;
    expect(providers.map((provider) => provider.id)).toEqual(["twilio", "cloudflare", "dataforseo", "hyperdrive", "email", "r2", "openai", "triggerdev"]);
    expect(providers[2]).toMatchObject({ name: "DataForSEO", state: "connected", identifier: login, testable: true });
  });

  it("records test failures without discarding the last success and clears them on recovery", async () => {
    const cookie = await signIn("operator@example.com");
    const before = await json(overview(cookie));
    unavailable = true;
    const failed = await json(post(cookie, "dataforseo/test"));
    expect(failed.response.status).toBe(502);
    const degraded = await json(overview(cookie));
    expect(degraded.body.dataforseo).toMatchObject({ lastVerifiedAt: (before.body.dataforseo as { lastVerifiedAt: string }).lastVerifiedAt, lastFailureDetail: expect.any(String) });
    expect((degraded.body.providers as Array<{ id: string; state: string }>).find((provider) => provider.id === "dataforseo")?.state).toBe("degraded");
    unavailable = false;
    const restored = await json(post(cookie, "dataforseo/test"));
    expect(restored.response.status).toBe(200);
    expect(restored.body.connection).toMatchObject({ lastFailureAt: null });
  });

  it("reports Needs re-entry under a different master key and recovers on rotation", async () => {
    const cookie = await signIn("operator@example.com");
    const rotatedKey = "ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=";
    const underRotatedKey = handler({ masterKey: rotatedKey });
    const health = await json(overview(cookie), underRotatedKey);
    expect(health.body.dataforseo).toMatchObject({ credentialState: "unreadable" });
    expect((health.body.providers as Array<{ id: string; state: string }>).find((provider) => provider.id === "dataforseo")?.state).toBe("needs_reentry");
    const tested = await json(post(cookie, "dataforseo/test"), underRotatedKey);
    expect(tested.response.status).toBe(409);
    expect(tested.body).toMatchObject({ error: "credential_unreadable" });
    const rotated = await json(post(cookie, "dataforseo/rotate", { password: secondPassword }), underRotatedKey);
    expect(rotated.response.status).toBe(200);
    expect(rotated.body.connection).toMatchObject({ credentialState: "readable", lastFailureAt: null });
    expect((await json(post(cookie, "dataforseo/rotate", { password: secondPassword }))).body.connection).toMatchObject({ credentialState: "readable" });
  });

  it("verifies the replacement password before rotating it", async () => {
    const cookie = await signIn("operator@example.com");
    const rejected = await json(post(cookie, "dataforseo/rotate", { password: "rejected-password" }));
    expect(rejected.response.status).toBe(422);
    const before = await pool!.query<{ password_ciphertext: string }>("select password_ciphertext from dataforseo_connection where organization_id = $1", [organizationId]);
    const rotated = await json(post(cookie, "dataforseo/rotate", { password: secondPassword }));
    expect(rotated.response.status).toBe(200);
    const after = await pool!.query<{ password_ciphertext: string }>("select password_ciphertext from dataforseo_connection where organization_id = $1", [organizationId]);
    expect(after.rows[0].password_ciphertext).not.toBe(before.rows[0].password_ciphertext);
    verifiedPasswords.length = 0;
    await json(post(cookie, "dataforseo/test"));
    expect(verifiedPasswords).toEqual([secondPassword]);
  });

  it("reports lookups this month from the connection and disconnects by removing the credential", async () => {
    const cookie = await signIn("operator@example.com");
    await pool!.query("update dataforseo_connection set lookups_this_month = 14, lookups_month = date_trunc('month', current_date)::date, last_checked_at = now() where organization_id = $1", [organizationId]);
    const counted = await json(overview(cookie));
    expect(counted.body.dataforseo).toMatchObject({ lookupsThisMonth: 14, lastCheckedAt: expect.any(String) });
    await pool!.query("update dataforseo_connection set lookups_month = (date_trunc('month', current_date) - interval '1 month')::date where organization_id = $1", [organizationId]);
    const stale = await json(overview(cookie));
    expect(stale.body.dataforseo).toMatchObject({ lookupsThisMonth: 0 });
    const disconnected = await json(post(cookie, "dataforseo/disconnect"));
    expect(disconnected.response.status).toBe(200);
    await expect(pool!.query("select count(*) from dataforseo_connection where organization_id = $1", [organizationId])).resolves.toMatchObject({ rows: [{ count: "0" }] });
    await expect(pool!.query("select count(*) from site_keyword where removed_at is null")).resolves.toMatchObject({ rows: [{ count: "2" }] });
    expect((await json(overview(cookie))).body.dataforseo).toBeNull();
    const test = await json(post(cookie, "dataforseo/test"));
    expect(test.response.status).toBe(404);
  });
});
