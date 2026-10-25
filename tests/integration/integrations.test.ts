/**
 * -------------------------------------------------------------------------
 * @file   integrations.test.ts
 * @brief  Verifies Organization integrations through authenticated routes.
 *
 * @description
 *  Exercises Twilio connection security, number synchronization, provider
 *  health including unfinished media cleanup, Organization isolation, and
 *  Hyperdrive and Email Service checks.
 *
 * @remarks
 *  `pool.end()` resolves before its clients' sockets close, so stopping the
 *  container right after it can send a pooled client PostgreSQL's
 *  administrator shutdown (57P01) with no listener left; each client
 *  ignores that one error and still throws any other.
 *  The suite uses one PostgreSQL container, real Better Auth sessions, and a
 *  deterministic in-memory Twilio provider boundary.
 *
 * @see
 *  data/integrations-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestPool } from "./test-pool";

import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { encryptSecret } from "@/data/credential-encryption";
import { migrateDatabase } from "@/data/migrate";
import { masterKeyFingerprint } from "@/data/provider-credential";
import { createIntegrations, IntegrationsError } from "@/data/integrations";
import { createIntegrationsHandler } from "@/data/integrations-handler";
import { schema } from "@/data/schema";
import { createTracerAuth } from "@/data/tracer-auth";
import { TwilioClientError, type TwilioAccountSummary, type TwilioClient, type TwilioCredential, type TwilioIncomingPhoneNumber } from "@/data/twilio-client";
import type { TransactionalEmailMessage } from "@/data/transactional-email";

const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const accountSid = "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const firstKeySid = "SK11111111111111111111111111111111";
const secondKeySid = "SK22222222222222222222222222222222";
const firstSecret = "first-synthetic-secret";
const secondSecret = "second-synthetic-secret";
const authToken = "synthetic-auth-token";
const account: TwilioAccountSummary = { sid: accountSid, friendlyName: "Tracer Account", status: "active", type: "Full" };

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let organizationId = "";
let operatorId = "";
let viewerId = "";
const messages: TransactionalEmailMessage[] = [];
const backgroundTasks: Promise<unknown>[] = [];
const accepted = new Map<string, TwilioAccountSummary>();
const credentials: TwilioCredential[] = [];
let incoming: TwilioIncomingPhoneNumber[] = [];
let unavailable = false;

const fakeTwilio: TwilioClient = {
  async fetchAccount(credential) {
    credentials.push(credential);
    if (unavailable) throw new TwilioClientError("unavailable", null);
    const match = accepted.get(`${credential.apiKeySid}:${credential.apiKeySecret}`);
    if (!match) throw new TwilioClientError("authentication_failed", 401);
    return match;
  },
  async listIncomingPhoneNumbers(credential) {
    credentials.push(credential);
    if (unavailable) throw new TwilioClientError("unavailable", null);
    if (!accepted.has(`${credential.apiKeySid}:${credential.apiKeySecret}`)) {
      throw new TwilioClientError("authentication_failed", 401);
    }
    return incoming;
  },
  async fetchIncomingPhoneNumber() {
    throw new Error("not implemented");
  },
  async updateIncomingPhoneNumberVoice() {
    throw new Error("not implemented");
  },
};

const database = () => drizzle(pool!, { schema });

const auth = () => createTracerAuth({
  database: database(),
  email: {
    async send(message) {
      messages.push(message);
      return { messageId: `email-${messages.length}` };
    },
  },
  emailFrom: "auth@example.com",
  allowedRecipients: new Set(["operator@example.com", "viewer@example.com"]),
  backgroundTask: (promise) => backgroundTasks.push(promise),
  secret: "integration-only-secret",
  baseURL: "http://localhost:3000",
});

function handler(overrides: { masterKey?: string; allowedRecipients?: ReadonlySet<string> } = {}) {
  const configuredMasterKey = "masterKey" in overrides ? overrides.masterKey : masterKey;
  return createIntegrationsHandler({
    auth: auth(),
    database: database(),
    pool: pool!,
    twilio: fakeTwilio,
    cloudflare: { async verifyToken() { throw new Error("not implemented"); }, async listSites() { throw new Error("not implemented"); }, async listDeployments() { throw new Error("not implemented"); }, async fetchDailyTraffic() { throw new Error("not implemented"); }, async captureScreenshot() { throw new Error("not implemented"); } },
    masterKey: configuredMasterKey,
    configuration: {
      twilioMasterKey: Boolean(configuredMasterKey),
      hyperdrive: true,
      email: true,
      emailFrom: "auth@example.com",
      emailAllowlistCount: (overrides.allowedRecipients ?? new Set(["operator@example.com"])).size,
      r2: false,
      r2Bucket: null,
      openai: false,
      triggerdev: false,
    },
    email: {
      async send(message) {
        messages.push(message);
        return { messageId: `email-${messages.length}` };
      },
    },
    emailFrom: "auth@example.com",
    allowedRecipients: overrides.allowedRecipients ?? new Set(["operator@example.com"]),
  });
}

async function signIn(email: string): Promise<string> {
  const currentMessages = messages.length;
  const currentTasks = backgroundTasks.length;
  const instance = auth();
  const send = await instance.handler(new Request("http://localhost:3000/api/auth/email-otp/send-verification-otp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, type: "sign-in" }),
  }));
  expect(send.status).toBe(200);
  await Promise.all(backgroundTasks.splice(currentTasks));
  const code = messages.slice(currentMessages).at(-1)?.text.match(/\d{6}/)?.[0];
  expect(code).toMatch(/^\d{6}$/);
  const verify = await instance.handler(new Request("http://localhost:3000/api/auth/sign-in/email-otp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, otp: code }),
  }));
  expect(verify.status).toBe(200);
  return (verify.headers.get("set-cookie") ?? "").split(";", 1)[0];
}

async function json(request: Request, routeHandler = handler()): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await routeHandler(request);
  return { response, body: await response.json() as Record<string, unknown> };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = createTestPool(container.getConnectionUri());
  await migrateDatabase(container.getConnectionUri());
  const bootstrapped = await bootstrapInitialOperator(pool, {
    email: "operator@example.com",
    name: "Example Operator",
    timezone: "America/Chicago",
  });
  organizationId = bootstrapped.organizationId;
  operatorId = bootstrapped.userId;
  viewerId = "viewer-user-id";
  await pool.query(
    `insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at)
     values ($1, 'Client Viewer', 'viewer@example.com', false, 'Active', 'UTC', now(), now())`,
    [viewerId],
  );
  await pool.query(
    `insert into member (id, organization_id, user_id, role, created_at) values ('viewer-membership-id', $1, $2, 'member', now())`,
    [organizationId, viewerId],
  );
  await pool.query(
    `insert into organization (id, name, slug, created_at) values ('other-organization-id', 'Other Org', 'other-org', now())`,
  );
  const otherCiphertext = await encryptSecret(masterKey, "other-secret");
  await pool.query(
    `insert into twilio_connection
       (id, organization_id, account_sid, api_key_sid, api_key_secret_ciphertext, account_friendly_name,
        connected_by_user_id, connected_at, last_verified_at, created_at, updated_at)
     values ('other-connection-id', 'other-organization-id', $1, $2, $3, 'Other Account', $4, now(), now(), now(), now())`,
    [accountSid, firstKeySid, otherCiphertext, operatorId],
  );
  await pool.query("update twilio_connection set master_key_fingerprint = $1 where master_key_fingerprint is null", [await masterKeyFingerprint(masterKey)]);
  await pool.query(
    `insert into twilio_number
       (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable,
        first_seen_at, last_seen_at, created_at, updated_at)
     values ('other-number-id', 'other-organization-id', 'PN99999999999999999999999999999999', '+14155559999', 'Other', true, now(), now(), now(), now())`,
  );
  accepted.set(`${firstKeySid}:${firstSecret}`, account);
  accepted.set(`${secondKeySid}:${secondSecret}`, account);
  accepted.set(`${accountSid}:${authToken}`, account);
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe.sequential("Organization integrations", () => {
  it("requires an Active Operator", async () => {
    const unauthenticated = await json(new Request("http://localhost:3000/api/integrations"));
    expect(unauthenticated.response.status).toBe(401);
    const viewerCookie = await signIn("viewer@example.com");
    const viewer = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie: viewerCookie } }));
    expect(viewer.response.status).toBe(403);
    const connect = await json(new Request("http://localhost:3000/api/integrations/twilio/connect", {
      method: "POST",
      headers: { cookie: viewerCookie, "content-type": "application/json" },
      body: JSON.stringify({ accountSid, apiKeySid: firstKeySid, apiKeySecret: firstSecret }),
    }));
    expect(connect.response.status).toBe(403);
  });

  it("generates, reports, and revokes the Organization's one Forms key for Operators only", async () => {
    const viewerCookie = await signIn("viewer@example.com");
    expect((await json(new Request("http://localhost:3000/api/integrations/forms-key", { method: "POST", headers: { cookie: viewerCookie } }))).response.status).toBe(403);
    const cookie = await signIn("operator@example.com");
    expect((await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }))).body.formsKey).toBeNull();
    const generated = await json(new Request("http://localhost:3000/api/integrations/forms-key", { method: "POST", headers: { cookie } }));
    expect(generated.response.status).toBe(201);
    expect(generated.body).toEqual({ key: expect.stringMatching(/^fk_/), createdAt: expect.any(String) });
    const read = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    expect(read.body.formsKey).toEqual({ createdAt: generated.body.createdAt });
    expect(JSON.stringify(read.body)).not.toContain(generated.body.key as string);
    expect((await handler()(new Request("http://localhost:3000/api/integrations/forms-key", { method: "DELETE", headers: { cookie } }))).status).toBe(204);
    expect((await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }))).body.formsKey).toBeNull();
  });

  it("reports provider health before Twilio is connected", async () => {
    const cookie = await signIn("operator@example.com");
    const result = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    expect(result.response.status).toBe(200);
    expect(result.body.twilio).toBeNull();
    expect(result.body.numbers).toEqual([]);
    expect(result.body.sites).toEqual([]);
    const providers = result.body.providers as Array<{ id: string; state: string }>;
    expect(providers.map((provider) => provider.id)).toEqual(["twilio", "cloudflare", "dataforseo", "hyperdrive", "email", "r2", "openai", "triggerdev"]);
    expect(providers[0]).toMatchObject({ state: "not_configured" });
  });

  it("rejects malformed and provider-rejected credentials without storing them", async () => {
    const cookie = await signIn("operator@example.com");
    const malformed = await json(new Request("http://localhost:3000/api/integrations/twilio/connect", {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ accountSid: "bad", apiKeySid: firstKeySid, apiKeySecret: firstSecret }),
    }));
    expect(malformed.response.status).toBe(400);
    const rejected = await json(new Request("http://localhost:3000/api/integrations/twilio/connect", {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ accountSid, apiKeySid: "SK99999999999999999999999999999999", apiKeySecret: "rejected-secret" }),
    }));
    expect(rejected.response.status).toBe(422);
    await expect(pool!.query("select count(*) from twilio_connection where organization_id = $1", [organizationId])).resolves.toMatchObject({ rows: [{ count: "0" }] });
  });

  it("connects and encrypts the Organization Twilio credential", async () => {
    const cookie = await signIn("operator@example.com");
    const connected = await json(new Request("http://localhost:3000/api/integrations/twilio/connect", {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ accountSid, apiKeySid: firstKeySid, apiKeySecret: firstSecret }),
    }));
    expect(connected.response.status).toBe(201);
    expect(JSON.stringify(connected.body)).not.toContain(firstSecret);
    expect(JSON.stringify(connected.body)).not.toContain("ciphertext");
    expect(JSON.stringify(connected.body)).not.toContain("apiKeySecret");
    const encrypted = await pool!.query<{ api_key_secret_ciphertext: string }>("select api_key_secret_ciphertext from twilio_connection where organization_id = $1", [organizationId]);
    expect(encrypted.rows[0]?.api_key_secret_ciphertext).toMatch(/^v1:/);
    expect(encrypted.rows[0]?.api_key_secret_ciphertext).not.toContain(firstSecret);
    const duplicate = await json(new Request("http://localhost:3000/api/integrations/twilio/connect", {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ accountSid, apiKeySid: firstKeySid, apiKeySecret: firstSecret }),
    }));
    expect(duplicate.response.status).toBe(409);
  });

  it("runs provider operations with decrypted credentials and records seam failures", async () => {
    const integrations = createIntegrations({
      pool: pool!,
      organizationId,
      twilio: fakeTwilio,
      masterKey,
    });

    await expect(integrations.withTwilioCredential(async (credential) => ({ accountSid: credential.accountSid, secret: credential.apiKeySecret }))).resolves.toEqual({ accountSid, secret: firstSecret });
    unavailable = true;
    await expect(integrations.withTwilioCredential(async () => {
      throw new TwilioClientError("unavailable", null);
    })).rejects.toMatchObject({ code: "provider_unavailable" });
    unavailable = false;
    await expect(integrations.getTwilioConnection()).resolves.toMatchObject({ lastFailureDetail: expect.any(String) });

    const disconnected = createIntegrations({
      pool: pool!,
      organizationId: "organization-without-connection",
      twilio: fakeTwilio,
      masterKey,
    });
    await expect(disconnected.withTwilioCredential(async () => "unreachable")).rejects.toBeInstanceOf(IntegrationsError);
    await expect(disconnected.withTwilioCredential(async () => "unreachable")).rejects.toMatchObject({ code: "not_connected" });
  });

  it("seals the credential with the master key fingerprint and reports it readable", async () => {
    const cookie = await signIn("operator@example.com");
    const row = await pool!.query<{ master_key_fingerprint: string | null }>("select master_key_fingerprint from twilio_connection where organization_id = $1", [organizationId]);
    expect(row.rows[0]?.master_key_fingerprint).toBe(await masterKeyFingerprint(masterKey));
    const health = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    expect(health.body.twilio).toMatchObject({ credentialState: "readable" });
  });

  it("records test failures without discarding the last success", async () => {
    const cookie = await signIn("operator@example.com");
    const before = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    unavailable = true;
    const failed = await json(new Request("http://localhost:3000/api/integrations/twilio/test", { method: "POST", headers: { cookie } }));
    expect(failed.response.status).toBe(502);
    expect(failed.body.detail).toContain("unavailable");
    const degraded = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    const beforeTwilio = before.body.twilio as { lastVerifiedAt: string | null };
    expect(degraded.body.twilio).toMatchObject({ lastVerifiedAt: beforeTwilio.lastVerifiedAt, lastFailureDetail: expect.any(String) });
    expect((degraded.body.providers as Array<{ state: string }>)[0].state).toBe("degraded");
    unavailable = false;
    const restored = await json(new Request("http://localhost:3000/api/integrations/twilio/test", { method: "POST", headers: { cookie } }));
    expect(restored.response.status).toBe(200);
    const restoredHealth = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    expect((restoredHealth.body.twilio as { lastFailureAt: string | null }).lastFailureAt).toBeNull();
  });

  it("verifies replacement credentials before rotation", async () => {
    const cookie = await signIn("operator@example.com");
    const rejected = await json(new Request("http://localhost:3000/api/integrations/twilio/rotate", {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ apiKeySid: "SK99999999999999999999999999999999", apiKeySecret: "rejected" }),
    }));
    expect(rejected.response.status).toBe(422);
    const beforeRotation = await pool!.query<{ api_key_sid: string; api_key_secret_ciphertext: string }>("select api_key_sid, api_key_secret_ciphertext from twilio_connection where organization_id = $1", [organizationId]);
    expect(beforeRotation.rows[0]).toMatchObject({ api_key_sid: firstKeySid });
    const rotated = await json(new Request("http://localhost:3000/api/integrations/twilio/rotate", {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ apiKeySid: secondKeySid, apiKeySecret: secondSecret }),
    }));
    expect(rotated.response.status).toBe(200);
    expect((rotated.body.connection as { apiKeySid: string }).apiKeySid).toBe(secondKeySid);
    const afterRotation = await pool!.query<{ api_key_sid: string; api_key_secret_ciphertext: string }>("select api_key_sid, api_key_secret_ciphertext from twilio_connection where organization_id = $1", [organizationId]);
    expect(afterRotation.rows[0]).toMatchObject({ api_key_sid: secondKeySid });
    expect(afterRotation.rows[0]?.api_key_secret_ciphertext).not.toBe(beforeRotation.rows[0]?.api_key_secret_ciphertext);
    await json(new Request("http://localhost:3000/api/integrations/twilio/test", { method: "POST", headers: { cookie } }));
    expect(credentials.at(-1)?.apiKeySid).toBe(secondKeySid);
  });

  it("verifies and encrypts the Twilio Auth Token used for webhook signatures", async () => {
    const cookie = await signIn("operator@example.com");
    const before = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    expect(before.body.twilio).toMatchObject({ authTokenConfigured: false });
    const malformed = await json(new Request("http://localhost:3000/api/integrations/twilio/auth-token", {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ authToken: "  " }),
    }));
    expect(malformed.response.status).toBe(400);
    const rejected = await json(new Request("http://localhost:3000/api/integrations/twilio/auth-token", {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ authToken: "rejected-auth-token" }),
    }));
    expect(rejected.response.status).toBe(422);
    await expect(pool!.query("select auth_token_ciphertext from twilio_connection where organization_id = $1", [organizationId])).resolves.toMatchObject({ rows: [{ auth_token_ciphertext: null }] });

    const configured = await json(new Request("http://localhost:3000/api/integrations/twilio/auth-token", {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ authToken }),
    }));
    expect(configured.response.status).toBe(200);
    expect(configured.body.connection).toMatchObject({ authTokenConfigured: true });
    expect(JSON.stringify(configured.body)).not.toContain(authToken);
    expect(credentials.at(-1)).toMatchObject({ accountSid, apiKeySid: accountSid, apiKeySecret: authToken });
    const stored = await pool!.query<{ auth_token_ciphertext: string }>("select auth_token_ciphertext from twilio_connection where organization_id = $1", [organizationId]);
    expect(stored.rows[0]?.auth_token_ciphertext).toMatch(/^v1:/);
    expect(stored.rows[0]?.auth_token_ciphertext).not.toContain(authToken);
  });

  it("synchronizes supported incoming numbers and releases missing numbers", async () => {
    const cookie = await signIn("operator@example.com");
    incoming = [
      { sid: "PN11111111111111111111111111111111", phoneNumber: "+1 (415) 555-2671", friendlyName: "First", voiceCapable: true, voiceUrl: "https://example.invalid/first", voiceMethod: "POST", voiceFallbackUrl: null, voiceFallbackMethod: null, statusCallback: null, statusCallbackMethod: null },
      { sid: "PN22222222222222222222222222222222", phoneNumber: "4155552672", friendlyName: "Second", voiceCapable: false, voiceUrl: null, voiceMethod: null, voiceFallbackUrl: null, voiceFallbackMethod: null, statusCallback: null, statusCallbackMethod: null },
      { sid: "PN33333333333333333333333333333333", phoneNumber: "+442071234567", friendlyName: "Skipped", voiceCapable: true, voiceUrl: null, voiceMethod: null, voiceFallbackUrl: null, voiceFallbackMethod: null, statusCallback: null, statusCallbackMethod: null },
    ];
    const first = await json(new Request("http://localhost:3000/api/integrations/twilio/sync-numbers", { method: "POST", headers: { cookie } }));
    expect(first.response.status).toBe(200);
    expect(first.body.numbers).toHaveLength(2);
    expect(first.body.skipped).toBe(1);
    incoming = [incoming[0]];
    await json(new Request("http://localhost:3000/api/integrations/twilio/sync-numbers", { method: "POST", headers: { cookie } }));
    expect((await json(new Request("http://localhost:3000/api/integrations/twilio/numbers", { headers: { cookie } }))).body.numbers).toEqual(expect.arrayContaining([expect.objectContaining({ phoneNumber: "+14155552672", releasedAt: expect.any(String) })]));
    incoming = [incoming[0], { sid: "PN22222222222222222222222222222222", phoneNumber: "4155552672", friendlyName: "Second", voiceCapable: false, voiceUrl: null, voiceMethod: null, voiceFallbackUrl: null, voiceFallbackMethod: null, statusCallback: null, statusCallbackMethod: null }];
    const restored = await json(new Request("http://localhost:3000/api/integrations/twilio/sync-numbers", { method: "POST", headers: { cookie } }));
    expect(restored.body.numbers).toEqual(expect.arrayContaining([expect.objectContaining({ phoneNumber: "+14155552672", releasedAt: null })]));
    const health = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    expect((health.body.twilio as { numberCount: number }).numberCount).toBe(2);
    expect(health.body.numbers).toEqual(expect.arrayContaining([expect.objectContaining({ phoneNumber: "+14155552671" }), expect.objectContaining({ phoneNumber: "+14155552672" })]));
    expect(health.body.sites).toEqual([]);
  });

  it("keeps the other Organization connection and numbers invisible", async () => {
    const cookie = await signIn("operator@example.com");
    const numbers = await json(new Request("http://localhost:3000/api/integrations/twilio/numbers", { headers: { cookie } }));
    expect(numbers.body.numbers).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "other-number-id" })]));
    const health = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    expect((health.body.twilio as { accountFriendlyName: string }).accountFriendlyName).toBe("Tracer Account");
  });

  it("reports Needs re-entry when the credential was sealed under a different master key, records it on every use, and recovers on rotation", async () => {
    const cookie = await signIn("operator@example.com");
    const rotatedKey = "ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=";
    const underRotatedKey = handler({ masterKey: rotatedKey });
    const health = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }), underRotatedKey);
    expect(health.body.twilio).toMatchObject({ credentialState: "unreadable" });
    expect((health.body.providers as Array<{ id: string; state: string }>)[0]).toMatchObject({ id: "twilio", state: "needs_reentry" });

    const tested = await json(new Request("http://localhost:3000/api/integrations/twilio/test", { method: "POST", headers: { cookie } }), underRotatedKey);
    expect(tested.response.status).toBe(409);
    expect(tested.body).toMatchObject({ error: "credential_unreadable", detail: expect.stringContaining("different master key") });
    const synced = await json(new Request("http://localhost:3000/api/integrations/twilio/sync-numbers", { method: "POST", headers: { cookie } }), underRotatedKey);
    expect(synced.body).toMatchObject({ error: "credential_unreadable" });
    const recorded = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }), underRotatedKey);
    expect(recorded.body.twilio).toMatchObject({ lastFailureDetail: expect.stringContaining("different master key") });

    const rotated = await json(new Request("http://localhost:3000/api/integrations/twilio/rotate", {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ apiKeySid: secondKeySid, apiKeySecret: secondSecret }),
    }), underRotatedKey);
    expect(rotated.response.status).toBe(200);
    expect(rotated.body.connection).toMatchObject({ credentialState: "readable", lastFailureAt: null });
    const row = await pool!.query<{ master_key_fingerprint: string | null }>("select master_key_fingerprint from twilio_connection where organization_id = $1", [organizationId]);
    expect(row.rows[0]?.master_key_fingerprint).toBe(await masterKeyFingerprint(rotatedKey));

    const backUnderOriginal = await json(new Request("http://localhost:3000/api/integrations/twilio/rotate", {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ apiKeySid: secondKeySid, apiKeySecret: secondSecret }),
    }));
    expect(backUnderOriginal.body.connection).toMatchObject({ credentialState: "readable" });
  });

  it("blocks disconnect while Active Workspaces depend on Twilio and ends their Number Assignments when forced", async () => {
    const cookie = await signIn("operator@example.com");
    const numberId = (await pool!.query<{ id: string }>("select id from twilio_number where organization_id = $1 and twilio_sid = 'PN11111111111111111111111111111111'", [organizationId])).rows[0].id;
    await pool!.query(
      "insert into workspace (id, organization_id, name, reporting_timezone, state, destination_number, created_at, updated_at) values ('disconnect-workspace', $1, 'Disconnect Workspace', 'UTC', 'Active', '+14155550199', now(), now())",
      [organizationId],
    );
    await pool!.query(
      "insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at) values ('disconnect-assignment', $1, 'disconnect-workspace', $2, '+14155552671', now(), now())",
      [organizationId, numberId],
    );
    const blocked = await json(new Request("http://localhost:3000/api/integrations/twilio/disconnect", { method: "POST", headers: { cookie } }));
    expect(blocked.response.status).toBe(409);
    expect(blocked.body).toMatchObject({ error: "active_workspaces", activeWorkspaceCount: 1 });
    expect((await pool!.query("select count(*) from twilio_connection where organization_id = $1", [organizationId])).rows[0]).toEqual({ count: "1" });

    const disconnected = await json(new Request("http://localhost:3000/api/integrations/twilio/disconnect", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ force: true }) }));
    expect(disconnected.response.status).toBe(200);
    expect(disconnected.body).toEqual({ disconnected: true, endedAssignments: 1 });
    expect((await pool!.query("select ended_reason, voice_restore_skipped_at is not null as skipped from number_assignment where id = 'disconnect-assignment'")).rows[0]).toEqual({ ended_reason: "disconnected", skipped: true });
    expect((await pool!.query("select state from workspace where id = 'disconnect-workspace'")).rows[0]).toEqual({ state: "Setup Required" });
    await expect(pool!.query("select count(*) from twilio_connection where organization_id = $1", [organizationId])).resolves.toMatchObject({ rows: [{ count: "0" }] });
    await expect(pool!.query("select count(*) from twilio_connection where organization_id = 'other-organization-id'")).resolves.toMatchObject({ rows: [{ count: "1" }] });
  });

  it("tests Hyperdrive and Email Service", async () => {
    const cookie = await signIn("operator@example.com");
    const hyperdrive = await json(new Request("http://localhost:3000/api/integrations/hyperdrive/test", { method: "POST", headers: { cookie } }));
    expect(hyperdrive.body.status).toBe("ok");
    const email = await json(new Request("http://localhost:3000/api/integrations/email/test", { method: "POST", headers: { cookie } }));
    expect(email.body).toEqual({ status: "sent", to: "operator@example.com" });
    expect(messages.at(-1)).toMatchObject({ subject: "Tracer test email", to: "operator@example.com" });
    const notAllowed = await json(new Request("http://localhost:3000/api/integrations/email/test", { method: "POST", headers: { cookie } }), handler({ allowedRecipients: new Set() }));
    expect(notAllowed.body).toEqual({ error: "recipient_not_allowed" });
  });

  it("reports a missing master key", async () => {
    const cookie = await signIn("operator@example.com");
    const missing = await json(new Request("http://localhost:3000/api/integrations/twilio/connect", {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ accountSid, apiKeySid: firstKeySid, apiKeySecret: firstSecret }),
    }), handler({ masterKey: undefined }));
    expect(missing.response.status).toBe(503);
    const health = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }), handler({ masterKey: undefined }));
    expect((health.body.providers as Array<{ note: string | null }>)[0].note).toContain("TWILIO_CREDENTIAL_MASTER_KEY");
  });

  it("reports the configured OpenAI models with no Transcripts or Lead Assessments yet", async () => {
    const cookie = await signIn("operator@example.com");
    const result = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    const openai = (result.body.providers as Array<{ id: string }>).find((provider) => provider.id === "openai");
    expect(openai).toMatchObject({
      lastSuccessAt: null,
      lastFailureAt: null,
      analysis: { transcriptionModel: "whisper-1", leadAssessmentModel: "gpt-5-mini", lastTranscriptAt: null, lastLeadAssessmentAt: null, failedCount: 0, lastFailureAt: null },
    });
  });

  it("reports no Recording transfers yet for R2 and Trigger.dev", async () => {
    const cookie = await signIn("operator@example.com");
    const result = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    const providers = result.body.providers as Array<{ id: string; lastSuccessAt: string | null; recentFailures?: unknown[] }>;
    for (const id of ["r2", "triggerdev"]) {
      expect(providers.find((provider) => provider.id === id)).toMatchObject({ lastSuccessAt: null, lastFailureAt: null, recentFailures: [] });
    }
  });

  it("reports the last stored Recording transfer and the 5 most recent Organization transfer failures without object keys or Recording SIDs", async () => {
    for (const organization of [organizationId, "other-organization-id"]) {
      await pool!.query(
        `insert into workspace (id, organization_id, name, reporting_timezone, state, created_at, updated_at)
         values ($1, $2, 'Transfer Health', 'UTC', 'Active', now(), now())`,
        [`${organization}-health-workspace`, organization],
      );
      await pool!.query(
        `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, released_at, created_at, updated_at)
         values ($1, $2, $3, '+14155550177', 'Health', true, now(), now(), now(), now(), now())`,
        [`${organization}-health-number`, organization, organization === organizationId ? "PN77777777777777777777777777777777" : "PN88888888888888888888888888888888"],
      );
      await pool!.query(
        `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, ended_at, ended_reason, created_at)
         values ($1, $2, $3, $4, '+14155550177', now(), now(), 'replaced', now())`,
        [`${organization}-health-assignment`, organization, `${organization}-health-workspace`, `${organization}-health-number`],
      );
      await pool!.query(
        `insert into flow_version (id, organization_id, workspace_id, version, graph, published_at) values ($1, $2, $3, 1, '{}', now())`,
        [`${organization}-health-flow`, organization, `${organization}-health-workspace`],
      );
      await pool!.query(
        `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, started_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, 'CA77777777777777777777777777777777', '+14155550177', now(), now(), now())`,
        [`${organization}-health-call`, organization, `${organization}-health-workspace`, `${organization}-health-assignment`, `${organization}-health-flow`],
      );
    }
    async function recording(organization: string, id: string, values: { stored?: string; failure?: [string, string, string] }) {
      await pool!.query(
        `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, transfer_state, r2_object_key, size_bytes, sha256, stored_at, failure_stage, failure_reason, created_at, updated_at)
         values ($1, $2, $3, $4, $5, 'voicemail', 1, $6, $7, $8, $9, $10, $11, $12, now(), coalesce($13::timestamptz, now()))`,
        [
          id, organization, `${organization}-health-workspace`, `${organization}-health-call`, `RE${id.padStart(32, "0")}`,
          values.stored ? "Stored" : "Failed", values.stored ? `organizations/${organization}/recordings/${id}.wav` : null, values.stored ? 42 : null, values.stored ? "checksum" : null,
          values.stored ?? null, values.failure?.[0] ?? null, values.failure?.[1] ?? null, values.failure?.[2] ?? null,
        ],
      );
    }
    await recording(organizationId, "1", { stored: "2026-10-14T01:00:00.000Z" });
    await recording(organizationId, "2", { stored: "2026-10-14T05:00:00.000Z" });
    for (let index = 0; index < 6; index += 1) {
      await recording(organizationId, String(10 + index), { failure: [index % 2 ? "upload" : "download", index % 2 ? "R2 request failed (HTTP 503)" : "Twilio is unavailable", `2026-10-14T0${index}:30:00.000Z`] });
    }
    await recording("other-organization-id", "90", { stored: "2026-10-15T00:00:00.000Z" });
    await recording("other-organization-id", "91", { failure: ["verify", "R2 object does not match the Twilio download", "2026-10-15T01:00:00.000Z"] });

    const cookie = await signIn("operator@example.com");
    const result = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    const providers = result.body.providers as Array<{ id: string }>;
    for (const id of ["r2", "triggerdev"]) {
      expect(providers.find((provider) => provider.id === id)).toMatchObject({
        lastSuccessAt: "2026-10-14T05:00:00.000Z",
        lastFailureAt: "2026-10-14T05:30:00.000Z",
        lastFailureDetail: "R2 request failed (HTTP 503)",
        recentFailures: [
          { stage: "upload", reason: "R2 request failed (HTTP 503)", at: "2026-10-14T05:30:00.000Z" },
          { stage: "download", reason: "Twilio is unavailable", at: "2026-10-14T04:30:00.000Z" },
          { stage: "upload", reason: "R2 request failed (HTTP 503)", at: "2026-10-14T03:30:00.000Z" },
          { stage: "download", reason: "Twilio is unavailable", at: "2026-10-14T02:30:00.000Z" },
          { stage: "upload", reason: "R2 request failed (HTTP 503)", at: "2026-10-14T01:30:00.000Z" },
        ],
      });
    }
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain("organizations/");
    expect(serialized).not.toContain("RE000");
    expect(serialized).not.toContain("R2 object does not match");
  });

  it("reports the last successful Transcript and Lead Assessment and the Organization's failed analysis without content", async () => {
    async function analyzed(organization: string, id: string, values: { transcript: string; completedAt?: string; leadAssessment?: string; processedAt?: string; failedAt?: string }) {
      const completed = values.transcript === "Completed";
      await pool!.query(
        `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, transfer_state, r2_object_key, size_bytes, sha256, stored_at,
                                transcript_state, transcript_failure_reason, transcript_audio_ms, transcript_cost_usd, transcript_completed_at,
                                lead_assessment_state, lead_assessment_failure_reason, created_at, updated_at)
         values ($1, $2, $3, $4, $5, 'voicemail', 1, 'Stored', $6, 42, 'checksum', now(), $7, $8, $9, $10, $11, $12, $13, now(), coalesce($14::timestamptz, now()))`,
        [
          id, organization, `${organization}-health-workspace`, `${organization}-health-call`, `RE${id.padStart(32, "0")}`, `organizations/${organization}/recordings/${id}.wav`,
          values.transcript, values.transcript === "Failed" ? "OpenAI request failed (HTTP 401)" : null, completed ? 60_000 : null, completed ? 0.006 : null, values.completedAt ?? null,
          values.leadAssessment ?? null, values.leadAssessment === "Failed" ? "OpenAI response was incomplete" : null, values.failedAt ?? values.processedAt ?? values.completedAt ?? null,
        ],
      );
      if (values.processedAt) {
        await pool!.query(
          `insert into lead_assessment (id, organization_id, call_id, recording_id, classification, score, summary, rationale, model, input_tokens, output_tokens, cost_usd, processed_at)
           values ($1, $2, $3, $1, 'Good Lead', 80, 'Summary of the call.', 'Rationale.', 'gpt-5-mini', 900, 120, 0.000465, $4)`,
          [id, organization, `${organization}-health-call`, values.processedAt],
        );
      }
    }
    await analyzed(organizationId, "40", { transcript: "Completed", completedAt: "2026-10-16T01:00:00.000Z", leadAssessment: "Completed", processedAt: "2026-10-16T01:01:00.000Z" });
    await analyzed(organizationId, "41", { transcript: "Completed", completedAt: "2026-10-16T03:00:00.000Z", leadAssessment: "Failed", failedAt: "2026-10-16T03:02:00.000Z" });
    await analyzed(organizationId, "42", { transcript: "Failed", failedAt: "2026-10-16T02:00:00.000Z" });
    await analyzed(organizationId, "43", { transcript: "Pending" });
    await analyzed("other-organization-id", "95", { transcript: "Completed", completedAt: "2026-10-17T00:00:00.000Z", leadAssessment: "Completed", processedAt: "2026-10-17T00:01:00.000Z" });
    await analyzed("other-organization-id", "96", { transcript: "Failed", failedAt: "2026-10-17T05:00:00.000Z" });

    const cookie = await signIn("operator@example.com");
    const result = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    const openai = (result.body.providers as Array<{ id: string }>).find((provider) => provider.id === "openai");
    expect(openai).toMatchObject({
      lastSuccessAt: "2026-10-16T03:00:00.000Z",
      lastFailureAt: "2026-10-16T03:02:00.000Z",
      lastFailureDetail: null,
      analysis: {
        transcriptionModel: "whisper-1",
        leadAssessmentModel: "gpt-5-mini",
        lastTranscriptAt: "2026-10-16T03:00:00.000Z",
        lastLeadAssessmentAt: "2026-10-16T01:01:00.000Z",
        failedCount: 2,
        lastFailureAt: "2026-10-16T03:02:00.000Z",
      },
    });
    const serialized = JSON.stringify(openai);
    expect(serialized).not.toMatch(/HTTP 401|incomplete|Summary of the call/);
  });

  it("reports purged and expired Recordings whose cleanup is still unfinished 26 hours later, or blocked without a Twilio connection, oldest first and Organization-scoped", async () => {
    async function lifecycle(organization: string, id: string, values: { startedAgo?: string; purgedAgo?: string; twilio?: "Pending" | "Deleted"; finished?: boolean }) {
      await pool!.query(
        `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, started_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, '+14155550177', now() - $7::interval, now(), now())`,
        [`${id}-call`, organization, `${organization}-health-workspace`, `${organization}-health-assignment`, `${organization}-health-flow`, `CA${id.padStart(32, "0")}`, values.startedAgo ?? "0 seconds"],
      );
      await pool!.query(
        `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, transfer_state, twilio_cleanup_state, twilio_deleted_at,
                                r2_object_key, size_bytes, sha256, stored_at, media_purged_at, media_deleted_at, created_at, updated_at)
         values ($1, $2, $3, $4, $5, 'voicemail', 1, 'Stored', $6, case when $6 = 'Deleted' then now() end,
                 $7, 42, 'checksum', now(), now() - $8::interval, case when $9::boolean then now() end, now(), now())`,
        [id, organization, `${organization}-health-workspace`, `${id}-call`, `RE${id.padStart(32, "0")}`, values.twilio ?? "Deleted", `organizations/${organization}/recordings/${id}.wav`, values.purgedAgo ?? null, values.finished ?? false],
      );
    }
    await lifecycle(organizationId, "lifecycle-purged-stuck", { purgedAgo: "30 hours" });
    await lifecycle(organizationId, "lifecycle-purged-fresh", { purgedAgo: "2 hours" });
    await lifecycle(organizationId, "lifecycle-purged-no-twilio", { purgedAgo: "1 hour", twilio: "Pending" });
    await lifecycle(organizationId, "lifecycle-expired-stuck", { startedAgo: "12 months 2 days" });
    await lifecycle(organizationId, "lifecycle-expired-fresh", { startedAgo: "12 months 2 hours" });
    await lifecycle(organizationId, "lifecycle-purged-finished", { purgedAgo: "40 hours", finished: true });
    await lifecycle(organizationId, "lifecycle-expired-finished", { startedAgo: "13 months", finished: true });
    await lifecycle(organizationId, "lifecycle-retained", { twilio: "Pending" });
    for (let hours = 50; hours < 54; hours += 1) {
      await lifecycle(organizationId, `lifecycle-backlog-${hours}`, { purgedAgo: `${hours} hours` });
    }
    await lifecycle("other-organization-id", "lifecycle-other-stuck", { purgedAgo: "30 hours" });
    await lifecycle("other-organization-id", "lifecycle-other-fresh", { purgedAgo: "1 hour", twilio: "Pending" });
    const since = async (id: string) => (await pool!.query<{ since: Date }>(
      `select coalesce(r.media_purged_at, c.started_at + interval '12 months') as since from recording r join call c on c.id = r.call_id where r.id = $1`,
      [id],
    )).rows[0].since.toISOString();
    const entry = async (id: string, media: "Purged" | "Expired", twilioNotConnected = false) => ({
      callId: `${id}-call`,
      workspaceId: `${organizationId}-health-workspace`,
      workspaceName: "Transfer Health",
      media,
      since: await since(id),
      twilioNotConnected,
    });

    const cookie = await signIn("operator@example.com");
    const result = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    const providers = result.body.providers as Array<{ id: string; mediaLifecycle?: unknown }>;
    expect(providers.find((provider) => provider.id === "triggerdev")?.mediaLifecycle).toEqual({
      stuckCount: 7,
      oldestStuck: [
        await entry("lifecycle-backlog-53", "Purged"),
        await entry("lifecycle-backlog-52", "Purged"),
        await entry("lifecycle-backlog-51", "Purged"),
        await entry("lifecycle-backlog-50", "Purged"),
        await entry("lifecycle-expired-stuck", "Expired"),
      ],
    });
    expect(providers.filter((provider) => provider.mediaLifecycle).map((provider) => provider.id)).toEqual(["triggerdev"]);
    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain("organizations/");
    expect(serialized).not.toContain("lifecycle-other");

    const remaining = await createIntegrations({ pool: pool!, organizationId, twilio: fakeTwilio, masterKey }).getMediaLifecycleHealth();
    expect(remaining.oldestStuck).toHaveLength(5);
    await pool!.query("update recording set media_deleted_at = now() where id like 'lifecycle-backlog-%'");
    await expect(createIntegrations({ pool: pool!, organizationId, twilio: fakeTwilio, masterKey }).getMediaLifecycleHealth()).resolves.toEqual({
      stuckCount: 3,
      oldestStuck: [
        await entry("lifecycle-expired-stuck", "Expired"),
        await entry("lifecycle-purged-stuck", "Purged"),
        await entry("lifecycle-purged-no-twilio", "Purged", true),
      ],
    });
    const other = await createIntegrations({ pool: pool!, organizationId: "other-organization-id", twilio: fakeTwilio, masterKey }).getMediaLifecycleHealth();
    expect(other).toMatchObject({ stuckCount: 1, oldestStuck: [{ callId: "lifecycle-other-stuck-call", twilioNotConnected: false }] });
  });
});
