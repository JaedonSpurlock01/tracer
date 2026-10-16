/**
 * -------------------------------------------------------------------------
 * @file   twilio-webhooks.test.ts
 * @brief  Verifies the inbound Twilio voice and status webhook boundary.
 *
 * @description
 *  Sends Twilio-shaped form requests to the webhook handler against a real
 *  PostgreSQL database seeded with an Active Workspace, its Number
 *  Assignment, and its published Flow Version.
 *
 * @remarks
 *  Requests are signed with node:crypto in the test so the expected signature
 *  never depends on Tracer's own signing code.
 *
 * @see
 *  data/twilio-webhook-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createHmac } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { generateInitialCallFlow } from "@/data/call-flow";
import { encryptSecret } from "@/data/credential-encryption";
import { migrateDatabase } from "@/data/migrate";
import { createTwilioWebhookHandler } from "@/data/twilio-webhook-handler";

const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const authToken = "webhook-auth-token";
const baseURL = "https://tracer.example.com";
const assignmentId = "webhook-assignment";
const trackingNumber = "+14155550101";
const destinationNumber = "+14155550199";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;

function sign(url: string, params: Record<string, string>, token = authToken): string {
  const payload = url + Object.keys(params).sort().map((name) => name + params[name]).join("");
  return createHmac("sha1", token).update(payload).digest("base64");
}

function voiceParams(callSid = "CA00000000000000000000000000000001"): Record<string, string> {
  return {
    AccountSid: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    CallSid: callSid,
    CallStatus: "ringing",
    Direction: "inbound",
    From: "+14155550123",
    To: trackingNumber,
  };
}

function webhookRequest(path: string, params: Record<string, string>, signature: string | null): Request {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (signature !== null) headers["x-twilio-signature"] = signature;
  return new Request(`${baseURL}${path}`, { method: "POST", headers, body: new URLSearchParams(params).toString() });
}

function handler() {
  return createTwilioWebhookHandler({ pool: pool!, masterKey, baseURL });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrateDatabase(container.getConnectionUri());
  const { organizationId, userId } = await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "Webhook Operator", timezone: "UTC" });
  await pool.query(
    `insert into twilio_connection (id, organization_id, account_sid, api_key_sid, api_key_secret_ciphertext, auth_token_ciphertext, connected_by_user_id, connected_at, created_at, updated_at)
     values ('webhook-connection', $1, 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'SK11111111111111111111111111111111', $2, $3, $4, now(), now(), now())`,
    [organizationId, await encryptSecret(masterKey, "api-key-secret"), await encryptSecret(masterKey, authToken), userId],
  );
  await pool.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ('webhook-number', $1, 'PNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', $2, 'Webhook Number', true, now(), now(), now(), now())`,
    [organizationId, trackingNumber],
  );
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, destination_number, created_at, updated_at)
     values ('webhook-workspace', $1, 'Webhook Workspace', 'UTC', 'Active', $2, now(), now())`,
    [organizationId, destinationNumber],
  );
  await pool.query(
    `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at)
     values ($1, $2, 'webhook-workspace', 'webhook-number', $3, now(), now())`,
    [assignmentId, organizationId, trackingNumber],
  );
  const graph = generateInitialCallFlow({
    destinationNumber,
    recordingEnabled: false,
    spamGateEnabled: false,
    whisperEnabled: false,
    whisperMessage: null,
    disclosureVoice: "Polly.Joanna",
  });
  await pool.query(
    `insert into flow_version (id, organization_id, workspace_id, version, graph, published_by_user_id, published_at)
     values ('webhook-flow-version-1', $1, 'webhook-workspace', 1, $2, $3, now())`,
    [organizationId, JSON.stringify(graph), userId],
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe.sequential("Twilio voice webhook", () => {
  const voicePath = `/api/twilio/voice/${assignmentId}`;

  it("rejects requests without a valid Twilio signature", async () => {
    const params = voiceParams();
    const unsigned = await handler()(webhookRequest(voicePath, params, null));
    expect(unsigned.status).toBe(403);
    const forged = await handler()(webhookRequest(voicePath, params, sign(`${baseURL}${voicePath}`, params, "other-auth-token")));
    expect(forged.status).toBe(403);
    const tampered = await handler()(webhookRequest(voicePath, { ...params, From: "+14155550999" }, sign(`${baseURL}${voicePath}`, params)));
    expect(tampered.status).toBe(403);
    const unknownAssignment = await handler()(webhookRequest("/api/twilio/voice/unknown-assignment", params, sign(`${baseURL}/api/twilio/voice/unknown-assignment`, params)));
    expect(unknownAssignment.status).toBe(403);
  });

  it("accepts a validly signed request with TwiML", async () => {
    const params = voiceParams();
    const response = await handler()(webhookRequest(voicePath, params, sign(`${baseURL}${voicePath}`, params)));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/xml");
  });
});
