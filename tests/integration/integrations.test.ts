/**
 * -------------------------------------------------------------------------
 * @file   integrations.test.ts
 * @brief  Verifies Organization integrations through authenticated routes.
 *
 * @description
 *  Exercises Twilio connection security, number synchronization, provider
 *  health, Organization isolation, and Hyperdrive and Email Service checks.
 *
 * @remarks
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
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { encryptSecret } from "@/data/credential-encryption";
import { migrateDatabase } from "@/data/migrate";
import { createIntegrations, IntegrationsError } from "@/data/integrations";
import { createIntegrationsHandler } from "@/data/integrations-handler";
import { schema } from "@/data/schema";
import { createTracerAuth } from "@/data/tracer-auth";
import { TwilioClientError, type TwilioAccountSummary, type TwilioClient, type TwilioCredential, type TwilioIncomingPhoneNumber } from "@/data/twilio-client";

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
const messages: { to: string; subject: string; text: string; html: string }[] = [];
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

function handler(overrides: { masterKey?: string; activeWorkspaceCount?: () => Promise<number>; allowedRecipients?: ReadonlySet<string> } = {}) {
  const configuredMasterKey = "masterKey" in overrides ? overrides.masterKey : masterKey;
  return createIntegrationsHandler({
    auth: auth(),
    database: database(),
    pool: pool!,
    twilio: fakeTwilio,
    masterKey: configuredMasterKey,
    configuration: {
      twilioMasterKey: Boolean(configuredMasterKey),
      hyperdrive: true,
      email: true,
      emailFrom: "auth@example.com",
      emailAllowlistCount: (overrides.allowedRecipients ?? new Set(["operator@example.com"])).size,
      r2: false,
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
    activeWorkspaceCount: overrides.activeWorkspaceCount ?? (async () => 0),
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
  pool = new Pool({ connectionString: container.getConnectionUri() });
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

  it("reports provider health before Twilio is connected", async () => {
    const cookie = await signIn("operator@example.com");
    const result = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    expect(result.response.status).toBe(200);
    expect(result.body.twilio).toBeNull();
    const providers = result.body.providers as Array<{ id: string; state: string }>;
    expect(providers.map((provider) => provider.id)).toEqual(["twilio", "hyperdrive", "email", "r2", "openai", "triggerdev"]);
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
      activeWorkspaceCount: async () => 0,
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
      activeWorkspaceCount: async () => 0,
    });
    await expect(disconnected.withTwilioCredential(async () => "unreachable")).rejects.toBeInstanceOf(IntegrationsError);
    await expect(disconnected.withTwilioCredential(async () => "unreachable")).rejects.toMatchObject({ code: "not_connected" });
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
  });

  it("keeps the other Organization connection and numbers invisible", async () => {
    const cookie = await signIn("operator@example.com");
    const numbers = await json(new Request("http://localhost:3000/api/integrations/twilio/numbers", { headers: { cookie } }));
    expect(numbers.body.numbers).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "other-number-id" })]));
    const health = await json(new Request("http://localhost:3000/api/integrations", { headers: { cookie } }));
    expect((health.body.twilio as { accountFriendlyName: string }).accountFriendlyName).toBe("Tracer Account");
  });

  it("blocks disconnect while active workspaces depend on Twilio", async () => {
    const cookie = await signIn("operator@example.com");
    const blocked = await json(new Request("http://localhost:3000/api/integrations/twilio/disconnect", { method: "POST", headers: { cookie } }), handler({ activeWorkspaceCount: async () => 2 }));
    expect(blocked.response.status).toBe(409);
    expect(blocked.body).toMatchObject({ error: "active_workspaces", activeWorkspaceCount: 2 });
    const disconnected = await json(new Request("http://localhost:3000/api/integrations/twilio/disconnect", { method: "POST", headers: { cookie } }));
    expect(disconnected.body).toEqual({ disconnected: true });
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
});
