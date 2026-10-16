/**
 * -------------------------------------------------------------------------
 * @file   workspace-routing.test.ts
 * @brief  Verifies Workspace activation and Call Flow routing routes.
 *
 * @description
 *  Exercises Organization-scoped number assignment, draft, publication, and
 *  Twilio restoration behavior through the authenticated HTTP handler.
 *
 * @remarks
 *  The suite uses PostgreSQL Testcontainers and a deterministic Twilio fake.
 *
 * @see
 *  data/workspace-routing.ts
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
import { createIntegrations } from "@/data/integrations";
import { migrateDatabase } from "@/data/migrate";
import { schema } from "@/data/schema";
import { createTracerAuth } from "@/data/tracer-auth";
import { TwilioClientError, type TwilioClient, type TwilioVoiceConfiguration } from "@/data/twilio-client";
import { createWorkspacesHandler } from "@/data/workspaces-handler";
import { generateInitialCallFlow, type CallFlowGraph } from "@/data/call-flow";

const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const accountSid = "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const apiKeySid = "SK11111111111111111111111111111111";
const apiKeySecret = "routing-secret";
const baseURL = "http://localhost:3000";
const priorConfiguration: TwilioVoiceConfiguration = {
  voiceUrl: "https://example.invalid/old-voice",
  voiceMethod: "POST",
  voiceFallbackUrl: "https://example.invalid/old-fallback",
  voiceFallbackMethod: "POST",
  statusCallback: "https://example.invalid/old-status",
  statusCallbackMethod: "POST",
};

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let routingPool: Pool | undefined;
let organizationId = "";
let operatorId = "";
const secondOrganizationId = "second-routing-organization";
const secondOperatorId = "second-routing-operator";
const messages: { to: string; subject: string; text: string; html: string }[] = [];
const backgroundTasks: Promise<unknown>[] = [];
const fetchedSids: string[] = [];
const updates: Array<{ sid: string; configuration: TwilioVoiceConfiguration }> = [];
let updateUnavailable = false;
let failingUpdateSid: string | null = null;

const fakeTwilio: TwilioClient = {
  async fetchAccount() {
    return { sid: accountSid, friendlyName: "Routing Account", status: "active", type: "Full" };
  },
  async listIncomingPhoneNumbers() {
    return [];
  },
  async fetchIncomingPhoneNumber(_credential, sid) {
    fetchedSids.push(sid);
    return {
      sid,
      phoneNumber: "+14155550101",
      friendlyName: "Routing Number",
      voiceCapable: true,
      ...priorConfiguration,
    };
  },
  async updateIncomingPhoneNumberVoice(_credential, sid, configuration) {
    if (updateUnavailable || sid === failingUpdateSid) throw new TwilioClientError("unavailable", null);
    updates.push({ sid, configuration });
    return {
      sid,
      phoneNumber: "+14155550101",
      friendlyName: "Routing Number",
      voiceCapable: true,
      ...configuration,
    };
  },
};

const database = () => drizzle(pool!, { schema });
const auth = () =>
  createTracerAuth({
    database: database(),
    email: {
      async send(message) {
        messages.push(message);
        return { messageId: `email-${messages.length}` };
      },
    },
    emailFrom: "auth@example.com",
    allowedRecipients: new Set(["operator@example.com", "second@example.com"]),
    backgroundTask: (promise) => backgroundTasks.push(promise),
    secret: "routing-test-secret",
    baseURL,
  });

function integrationsFor(organization: string) {
  return createIntegrations({
    pool: routingPool!,
    organizationId: organization,
    twilio: fakeTwilio,
    masterKey,
    activeWorkspaceCount: async () => 0,
  });
}

function handler() {
  return createWorkspacesHandler({
    auth: auth(),
    database: database(),
    pool: routingPool!,
    twilio: fakeTwilio,
    integrations: integrationsFor,
    baseURL,
  });
}

async function signIn(email: string): Promise<string> {
  const before = messages.length;
  const taskCount = backgroundTasks.length;
  const instance = auth();
  const send = await instance.handler(
    new Request(`${baseURL}/api/auth/email-otp/send-verification-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, type: "sign-in" }),
    }),
  );
  expect(send.status).toBe(200);
  await Promise.all(backgroundTasks.splice(taskCount));
  const code = messages.slice(before).at(-1)?.text.match(/\d{6}/)?.[0];
  const verify = await instance.handler(
    new Request(`${baseURL}/api/auth/sign-in/email-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, otp: code }),
    }),
  );
  expect(verify.status).toBe(200);
  return (verify.headers.get("set-cookie") ?? "").split(";", 1)[0];
}

async function json(request: Request): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await handler()(request);
  return { response, body: (await response.json()) as Record<string, unknown> };
}

async function createWorkspace(cookie: string, name: string): Promise<string> {
  const result = await json(
    new Request(`${baseURL}/api/workspaces`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name, reportingTimezone: "UTC" }),
    }),
  );
  expect(result.response.status).toBe(201);
  return (result.body.workspace as { id: string }).id;
}

function generatedGraph(destinationNumber = "+14155550101", recordingEnabled = false): CallFlowGraph {
  return generateInitialCallFlow({
    destinationNumber,
    recordingEnabled,
    spamGateEnabled: false,
    whisperEnabled: false,
    whisperMessage: null,
    disclosureVoice: "Polly.Joanna",
  });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  routingPool = new Pool({ connectionString: container.getConnectionUri(), max: 1 });
  await migrateDatabase(container.getConnectionUri());
  const first = await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "Routing Operator", timezone: "UTC" });
  organizationId = first.organizationId;
  operatorId = first.userId;
  await pool.query(
    `insert into organization (id, name, slug, created_at) values ($1, 'Second Routing Organization', 'second-routing-org', now())`,
    [secondOrganizationId],
  );
  await pool.query(
    `insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at) values ($1, 'Second Operator', 'second@example.com', false, 'Active', 'UTC', now(), now())`,
    [secondOperatorId],
  );
  await pool.query(
    `insert into member (id, organization_id, user_id, role, created_at) values ('second-routing-member', $1, $2, 'owner', now())`,
    [secondOrganizationId, secondOperatorId],
  );
  const ciphertext = await encryptSecret(masterKey, apiKeySecret);
  await pool.query(
    `insert into twilio_connection (id, organization_id, account_sid, api_key_sid, api_key_secret_ciphertext, connected_by_user_id, connected_at, created_at, updated_at) values ('routing-connection', $1, $2, $3, $4, $5, now(), now(), now())`,
    [organizationId, accountSid, apiKeySid, ciphertext, operatorId],
  );
  for (const [id, sid, phoneNumber, voiceCapable] of [
    ["routing-number-a", "PNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "+14155550101", true],
    ["routing-number-b", "PNbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "+14155550102", true],
    ["routing-number-c", "PNcccccccccccccccccccccccccccccccc", "+14155550103", true],
    ["routing-number-released", "PNdddddddddddddddddddddddddddddddd", "+14155550104", true],
    ["routing-number-no-voice", "PNeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "+14155550105", false],
    ["routing-number-f", "PNffffffffffffffffffffffffffffffff", "+14155550106", true],
    ["routing-number-g", "PNgggggggggggggggggggggggggggggggg", "+14155550107", true],
    ["routing-number-h", "PNhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh", "+14155550108", true],
    ["routing-number-i", "PNiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii", "+14155550109", true],
    ["routing-number-j", "PNjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjj", "+14155550110", true],
    ["routing-number-k", "PNkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk", "+14155550111", true],
    ["routing-number-l", "PNllllllllllllllllllllllllllllllll", "+14155550112", true],
    ["routing-number-m", "PNmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm", "+14155550113", true],
    ["routing-number-n", "PNnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn", "+14155550114", true],
    ["routing-number-o", "PNoooooooooooooooooooooooooooooooo", "+14155550115", true],
    ["routing-number-p", "PNpppppppppppppppppppppppppppppppp", "+14155550116", true],
  ]) {
    await pool.query(
      `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, released_at, first_seen_at, last_seen_at, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, now(), now(), now(), now())`,
      [id, organizationId, sid, phoneNumber, id, voiceCapable, id === "routing-number-released" ? new Date() : null],
    );
  }
  await pool.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at) values ('second-routing-number', $1, 'PNffffffffffffffffffffffffffffffff', '+14155550201', 'Second Number', true, now(), now(), now(), now())`,
    [secondOrganizationId],
  );
}, 120_000);

afterAll(async () => {
  await routingPool?.end();
  await pool?.end();
  await container?.stop();
});

describe.sequential("Workspace routing", () => {
  it("lists only available voice numbers and marks active assignments", async () => {
    const cookie = await signIn("operator@example.com");
    const workspaceId = await createWorkspace(cookie, "Assigned Number Workspace");
    await pool!.query(
      `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at) values ('listing-assignment', $1, $2, 'routing-number-b', '+14155550102', now(), now())`,
      [organizationId, workspaceId],
    );

    const result = await json(new Request(`${baseURL}/api/workspaces/numbers`, { headers: { cookie } }));

    expect(result.response.status).toBe(200);
    expect(result.body.numbers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "routing-number-a", assignedWorkspace: null }),
        expect.objectContaining({ id: "routing-number-b", assignedWorkspace: { id: workspaceId, name: "Assigned Number Workspace" } }),
      ]),
    );
    expect(result.body.numbers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "routing-number-released" }),
        expect.objectContaining({ id: "routing-number-no-voice" }),
      ]),
    );
  });

  it("validates and persists routing settings while generating a valid draft", async () => {
    const cookie = await signIn("operator@example.com");
    const workspaceId = await createWorkspace(cookie, "Settings Workspace");
    for (const body of [
      {
        destinationNumber: "bad",
        recordingEnabled: false,
        analysisEnabled: false,
        spamGateEnabled: false,
        whisperEnabled: false,
        whisperMessage: null,
      },
      {
        destinationNumber: "+14155550101",
        recordingEnabled: false,
        analysisEnabled: true,
        spamGateEnabled: false,
        whisperEnabled: false,
        whisperMessage: null,
      },
      {
        destinationNumber: "+14155550101",
        recordingEnabled: false,
        analysisEnabled: false,
        spamGateEnabled: false,
        whisperEnabled: true,
        whisperMessage: "",
      },
    ]) {
      const invalid = await json(
        new Request(`${baseURL}/api/workspaces/${workspaceId}/routing`, {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      expect(invalid.response.status).toBe(400);
    }
    const updated = await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/routing`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          destinationNumber: "+1 (415) 555-2671",
          recordingEnabled: true,
          analysisEnabled: true,
          spamGateEnabled: true,
          whisperEnabled: true,
          whisperMessage: "From Tracer.",
        }),
      }),
    );
    expect(updated.response.status).toBe(200);
    expect(updated.body.workspace).toMatchObject({
      destinationNumber: "+14155552671",
      recordingEnabled: true,
      analysisEnabled: true,
      spamGateEnabled: true,
      whisperEnabled: true,
      whisperMessage: "From Tracer.",
    });
    const flow = await json(new Request(`${baseURL}/api/workspaces/${workspaceId}/flow`, { headers: { cookie } }));
    expect(flow.body.draft).toMatchObject({ basedOnVersion: null });
    expect(flow.body.validation).toMatchObject({ valid: true });
    const discarded = await handler()(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/flow`, { method: "DELETE", headers: { cookie } }),
    );
    expect(discarded.status).toBe(204);
    const afterDiscard = await json(new Request(`${baseURL}/api/workspaces/${workspaceId}/flow`, { headers: { cookie } }));
    expect(afterDiscard.body.draft).toBeNull();
  });

  it("refuses activation until the Twilio Auth Token is configured", async () => {
    const cookie = await signIn("operator@example.com");
    const workspaceId = await createWorkspace(cookie, "Missing Auth Token Workspace");
    await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/routing`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          destinationNumber: "+14155550101",
          recordingEnabled: false,
          analysisEnabled: false,
          spamGateEnabled: false,
          whisperEnabled: false,
          whisperMessage: null,
        }),
      }),
    );
    updates.length = 0;
    const refused = await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/activate`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ twilioNumberId: "routing-number-a" }),
      }),
    );
    expect(refused.response.status).toBe(409);
    expect(refused.body.error).toBe("twilio_auth_token_missing");
    expect(updates).toHaveLength(0);
    expect((await pool!.query("select state from workspace where id = $1", [workspaceId])).rows[0].state).toBe("Setup Required");
    expect((await pool!.query("select count(*)::int as count from number_assignment where workspace_id = $1", [workspaceId])).rows[0].count).toBe(0);
    await pool!.query("update twilio_connection set auth_token_ciphertext = $2 where organization_id = $1", [organizationId, await encryptSecret(masterKey, "routing-auth-token")]);
  });

  it("activates a Workspace and snapshots and updates Twilio voice configuration", async () => {
    const cookie = await signIn("operator@example.com");
    const workspaceId = await createWorkspace(cookie, "Activation Workspace");
    await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/routing`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          destinationNumber: "+14155550101",
          recordingEnabled: false,
          analysisEnabled: false,
          spamGateEnabled: false,
          whisperEnabled: false,
          whisperMessage: null,
        }),
      }),
    );
    updates.length = 0;
    const activated = await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/activate`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ twilioNumberId: "routing-number-a" }),
      }),
    );
    expect(activated.response.status).toBe(200);
    expect(activated.body.workspace).toMatchObject({
      state: "Active",
      trackingNumber: "+14155550101",
      publishedFlowVersion: { version: 1 },
    });
    const assignment = await pool!.query("select * from number_assignment where workspace_id = $1", [workspaceId]);
    expect(assignment.rows[0]).toMatchObject({
      prior_voice_url: priorConfiguration.voiceUrl,
      prior_voice_method: priorConfiguration.voiceMethod,
      prior_voice_fallback_url: priorConfiguration.voiceFallbackUrl,
      prior_voice_fallback_method: priorConfiguration.voiceFallbackMethod,
      prior_status_callback_url: priorConfiguration.statusCallback,
      prior_status_callback_method: priorConfiguration.statusCallbackMethod,
    });
    expect(await pool!.query("select version from flow_version where workspace_id = $1", [workspaceId])).toMatchObject({
      rows: [{ version: 1 }],
    });
    expect(await pool!.query("select count(*) from call_flow_draft where workspace_id = $1", [workspaceId])).toMatchObject({
      rows: [{ count: "0" }],
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      sid: "PNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      configuration: {
        voiceUrl: expect.stringMatching(new RegExp(`/api/twilio/voice/${assignment.rows[0].id}$`)),
        statusCallback: expect.stringMatching(new RegExp(`/api/twilio/status/${assignment.rows[0].id}$`)),
      },
    });
  });

  it("rejects assigned numbers, invalid drafts, and missing Twilio connections", async () => {
    const cookie = await signIn("operator@example.com");
    const assignedWorkspaceId = await createWorkspace(cookie, "Already Assigned Workspace");
    await pool!.query(
      `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at) values ('already-assigned', $1, $2, 'routing-number-c', '+14155550103', now(), now())`,
      [organizationId, assignedWorkspaceId],
    );
    const otherWorkspaceId = await createWorkspace(cookie, "Number Reuse Workspace");
    await json(
      new Request(`${baseURL}/api/workspaces/${otherWorkspaceId}/routing`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          destinationNumber: "+14155550101",
          recordingEnabled: false,
          analysisEnabled: false,
          spamGateEnabled: false,
          whisperEnabled: false,
          whisperMessage: null,
        }),
      }),
    );
    const assigned = await json(
      new Request(`${baseURL}/api/workspaces/${otherWorkspaceId}/activate`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ twilioNumberId: "routing-number-c" }),
      }),
    );
    expect(assigned.response.status).toBe(409);
    expect(assigned.body.error).toBe("number_unavailable");

    const invalidWorkspaceId = await createWorkspace(cookie, "Invalid Draft Workspace");
    const invalidGraph = generatedGraph();
    invalidGraph.edges = invalidGraph.edges.filter((edge) => edge.sourceHandle !== "missed");
    await json(
      new Request(`${baseURL}/api/workspaces/${invalidWorkspaceId}/flow`, {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ graph: invalidGraph }),
      }),
    );
    const invalidActivation = await json(
      new Request(`${baseURL}/api/workspaces/${invalidWorkspaceId}/activate`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ twilioNumberId: "routing-number-f" }),
      }),
    );
    expect(invalidActivation.response.status).toBe(422);
    expect(invalidActivation.body.issues).toEqual(expect.any(Array));
    expect((await pool!.query("select state from workspace where id = $1", [invalidWorkspaceId])).rows[0].state).toBe("Setup Required");

    const secondCookie = await signIn("second@example.com");
    const secondWorkspaceId = await createWorkspace(secondCookie, "No Connection Workspace");
    await json(
      new Request(`${baseURL}/api/workspaces/${secondWorkspaceId}/routing`, {
        method: "PATCH",
        headers: { cookie: secondCookie, "content-type": "application/json" },
        body: JSON.stringify({
          destinationNumber: "+14155550201",
          recordingEnabled: false,
          analysisEnabled: false,
          spamGateEnabled: false,
          whisperEnabled: false,
          whisperMessage: null,
        }),
      }),
    );
    const noConnection = await json(
      new Request(`${baseURL}/api/workspaces/${secondWorkspaceId}/activate`, {
        method: "POST",
        headers: { cookie: secondCookie, "content-type": "application/json" },
        body: JSON.stringify({ twilioNumberId: "second-routing-number" }),
      }),
    );
    expect(noConnection.response.status).toBe(409);
    expect(noConnection.body.error).toBe("twilio_not_connected");
  });

  it("rolls back activation and retains the draft when Twilio update fails", async () => {
    const cookie = await signIn("operator@example.com");
    const workspaceId = await createWorkspace(cookie, "Failed Activation Workspace");
    await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/routing`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          destinationNumber: "+14155550101",
          recordingEnabled: false,
          analysisEnabled: false,
          spamGateEnabled: false,
          whisperEnabled: false,
          whisperMessage: null,
        }),
      }),
    );
    updateUnavailable = true;
    const failed = await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/activate`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ twilioNumberId: "routing-number-g" }),
      }),
    );
    updateUnavailable = false;
    expect(failed.response.status).toBe(502);
    expect((await pool!.query("select state from workspace where id = $1", [workspaceId])).rows[0].state).toBe("Setup Required");
    expect((await pool!.query("select count(*) from number_assignment where workspace_id = $1", [workspaceId])).rows[0].count).toBe("0");
    expect((await pool!.query("select count(*) from call_flow_draft where workspace_id = $1", [workspaceId])).rows[0].count).toBe("1");
    expect(
      (await pool!.query("select last_failure_detail from twilio_connection where organization_id = $1", [organizationId])).rows[0]
        .last_failure_detail,
    ).toEqual(expect.any(String));
  });

  it("publishes modified drafts and rejects invalid publication", async () => {
    const cookie = await signIn("operator@example.com");
    const workspace = await pool!.query<{ id: string }>("select id from workspace where name = 'Activation Workspace'");
    const workspaceId = workspace.rows[0].id;
    const graph = generateInitialCallFlow({
      destinationNumber: "+14155550102",
      recordingEnabled: false,
      spamGateEnabled: true,
      whisperEnabled: true,
      whisperMessage: "Published whisper",
      disclosureVoice: "Polly.Joanna",
    });
    const forward = graph.nodes.find((node) => node.type === "forward_call");
    if (!forward || forward.type !== "forward_call") throw new Error("Expected forward node");
    forward.timeoutSeconds = 45;
    const saved = await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/flow`, {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ graph }),
      }),
    );
    expect(saved.response.status).toBe(200);
    const published = await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/flow/publish`, { method: "POST", headers: { cookie } }),
    );
    expect(published.response.status).toBe(200);
    expect(published.body.workspace).toMatchObject({
      destinationNumber: "+14155550102",
      spamGateEnabled: true,
      whisperEnabled: true,
      whisperMessage: "Published whisper",
      publishedFlowVersion: { version: 2 },
    });

    const invalidGraph = generatedGraph();
    invalidGraph.edges = invalidGraph.edges.filter((edge) => edge.sourceHandle !== "missed");
    await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/flow`, {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ graph: invalidGraph }),
      }),
    );
    const invalid = await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/flow/publish`, { method: "POST", headers: { cookie } }),
    );
    expect(invalid.response.status).toBe(422);
    expect(invalid.body.issues).toEqual(expect.any(Array));
    expect(
      (await json(new Request(`${baseURL}/api/workspaces/${workspaceId}/flow`, { headers: { cookie } }))).body.published,
    ).toMatchObject({ version: 2 });

    const setupWorkspaceId = await createWorkspace(cookie, "Setup Publish Workspace");
    const setup = await json(
      new Request(`${baseURL}/api/workspaces/${setupWorkspaceId}/flow/publish`, { method: "POST", headers: { cookie } }),
    );
    expect(setup.response.status).toBe(409);
    expect(setup.body.error).toBe("activation_required");
  });

  it("guards recording settings against a published graph without disclosure", async () => {
    const cookie = await signIn("operator@example.com");
    const workspaceId = await createWorkspace(cookie, "Recording Guard Workspace");
    await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/routing`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          destinationNumber: "+14155550101",
          recordingEnabled: false,
          analysisEnabled: false,
          spamGateEnabled: false,
          whisperEnabled: false,
          whisperMessage: null,
        }),
      }),
    );
    await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/activate`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ twilioNumberId: "routing-number-h" }),
      }),
    );
    const rejected = await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/routing`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          destinationNumber: "+14155550101",
          recordingEnabled: true,
          analysisEnabled: false,
          spamGateEnabled: false,
          whisperEnabled: false,
          whisperMessage: null,
        }),
      }),
    );
    expect(rejected.response.status).toBe(409);
    expect(rejected.body.error).toBe("disclosure_required");

    const disclosedWorkspaceId = await createWorkspace(cookie, "Disclosure Workspace");
    const disclosedSettings = {
      destinationNumber: "+14155550101",
      recordingEnabled: true,
      analysisEnabled: false,
      spamGateEnabled: false,
      whisperEnabled: false,
      whisperMessage: null,
    };
    await json(
      new Request(`${baseURL}/api/workspaces/${disclosedWorkspaceId}/routing`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(disclosedSettings),
      }),
    );
    await json(
      new Request(`${baseURL}/api/workspaces/${disclosedWorkspaceId}/activate`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ twilioNumberId: "routing-number-k" }),
      }),
    );
    const accepted = await json(
      new Request(`${baseURL}/api/workspaces/${disclosedWorkspaceId}/routing`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(disclosedSettings),
      }),
    );
    expect(accepted.response.status).toBe(200);
  });

  it("archives Active Workspaces with Twilio restoration and rolls back failures", async () => {
    const cookie = await signIn("operator@example.com");
    const workspaceId = await createWorkspace(cookie, "Archive Workspace");
    await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/routing`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          destinationNumber: "+14155550101",
          recordingEnabled: false,
          analysisEnabled: false,
          spamGateEnabled: false,
          whisperEnabled: false,
          whisperMessage: null,
        }),
      }),
    );
    await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/activate`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ twilioNumberId: "routing-number-i" }),
      }),
    );
    updates.length = 0;
    const archived = await json(new Request(`${baseURL}/api/workspaces/${workspaceId}/archive`, { method: "POST", headers: { cookie } }));
    expect(archived.response.status).toBe(200);
    expect(archived.body.workspace).toMatchObject({ state: "Archived" });
    expect(updates[0]?.configuration).toEqual(priorConfiguration);
    expect(
      (await pool!.query("select ended_at, ended_reason from number_assignment where workspace_id = $1", [workspaceId])).rows[0],
    ).toMatchObject({ ended_reason: "archived", ended_at: expect.any(Date) });

    const failedWorkspaceId = await createWorkspace(cookie, "Failed Archive Workspace");
    await json(
      new Request(`${baseURL}/api/workspaces/${failedWorkspaceId}/routing`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          destinationNumber: "+14155550101",
          recordingEnabled: false,
          analysisEnabled: false,
          spamGateEnabled: false,
          whisperEnabled: false,
          whisperMessage: null,
        }),
      }),
    );
    await json(
      new Request(`${baseURL}/api/workspaces/${failedWorkspaceId}/activate`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ twilioNumberId: "routing-number-j" }),
      }),
    );
    updateUnavailable = true;
    const failed = await json(
      new Request(`${baseURL}/api/workspaces/${failedWorkspaceId}/archive`, { method: "POST", headers: { cookie } }),
    );
    updateUnavailable = false;
    expect(failed.response.status).toBe(502);
    expect((await pool!.query("select state from workspace where id = $1", [failedWorkspaceId])).rows[0].state).toBe("Active");
    expect(
      (await pool!.query("select ended_at from number_assignment where workspace_id = $1", [failedWorkspaceId])).rows[0].ended_at,
    ).toBeNull();
  });

  it("restores and reactivates from the latest published version", async () => {
    const cookie = await signIn("operator@example.com");
    const workspace = await pool!.query<{ id: string }>("select id from workspace where name = 'Archive Workspace'");
    const workspaceId = workspace.rows[0].id;
    const restored = await json(new Request(`${baseURL}/api/workspaces/${workspaceId}/restore`, { method: "POST", headers: { cookie } }));
    expect(restored.body.workspace).toMatchObject({ state: "Setup Required", trackingNumber: null });
    const activated = await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/activate`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ twilioNumberId: "routing-number-i" }),
      }),
    );
    expect(activated.response.status).toBe(200);
    expect(activated.body.workspace).toMatchObject({ state: "Active", publishedFlowVersion: { version: 2 } });
  });

  it("reads immutable versions and enforces Organization isolation", async () => {
    const cookie = await signIn("operator@example.com");
    const workspace = await pool!.query<{ id: string }>("select id from workspace where name = 'Activation Workspace'");
    const workspaceId = workspace.rows[0].id;
    const version = await json(new Request(`${baseURL}/api/workspaces/${workspaceId}/flow/versions/1`, { headers: { cookie } }));
    expect(version.response.status).toBe(200);
    expect(version.body.graph).toMatchObject({ version: 1 });
    const unknown = await json(new Request(`${baseURL}/api/workspaces/${workspaceId}/flow/versions/99`, { headers: { cookie } }));
    expect(unknown.response.status).toBe(404);
    const secondCookie = await signIn("second@example.com");
    expect(
      (await json(new Request(`${baseURL}/api/workspaces/${workspaceId}/flow`, { headers: { cookie: secondCookie } }))).response.status,
    ).toBe(404);
    expect(
      (
        await json(
          new Request(`${baseURL}/api/workspaces/${workspaceId}/flow`, {
            method: "PUT",
            headers: { cookie: secondCookie, "content-type": "application/json" },
            body: JSON.stringify({ graph: generatedGraph() }),
          }),
        )
      ).response.status,
    ).toBe(404);
  });

  it("replaces the Tracking Number while preserving Number Assignment and Call history", async () => {
    const cookie = await signIn("operator@example.com");
    const workspaceId = await createWorkspace(cookie, "Replacement Workspace");
    await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/routing`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ destinationNumber: "+14155550101", recordingEnabled: false, analysisEnabled: false, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null }),
      }),
    );
    await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/activate`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ twilioNumberId: "routing-number-l" }),
      }),
    );
    const original = (await pool!.query("select id from number_assignment where workspace_id = $1 and ended_at is null", [workspaceId])).rows[0].id as string;
    await pool!.query(
      `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, caller_number, state, outcome, outcome_reason, started_at, ended_at, created_at, updated_at)
       select 'replacement-history-call', $1, $2, $3, v.id, 'CAreplacementhistory', '+14155550112', '+14155550123', 'Completed', 'Answered', 'flow_outcome', now(), now(), now(), now()
         from flow_version v where v.workspace_id = $2 order by v.version desc limit 1`,
      [organizationId, workspaceId, original],
    );
    updates.length = 0;

    const replaced = await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/replace-number`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ twilioNumberId: "routing-number-m" }),
      }),
    );
    expect(replaced.response.status).toBe(200);
    expect(replaced.body.workspace).toMatchObject({ state: "Active" });
    const assignments = await pool!.query(
      "select id, twilio_number_id, phone_number, ended_reason, ended_at is not null as ended, prior_voice_url from number_assignment where workspace_id = $1 order by started_at, ended_at nulls last",
      [workspaceId],
    );
    expect(assignments.rows).toEqual([
      { id: original, twilio_number_id: "routing-number-l", phone_number: "+14155550112", ended_reason: "replaced", ended: true, prior_voice_url: priorConfiguration.voiceUrl },
      { id: expect.any(String), twilio_number_id: "routing-number-m", phone_number: "+14155550113", ended_reason: null, ended: false, prior_voice_url: priorConfiguration.voiceUrl },
    ]);
    const replacement = assignments.rows[1].id as string;
    expect(updates).toEqual([
      {
        sid: "PNmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm",
        configuration: {
          voiceUrl: `${baseURL}/api/twilio/voice/${replacement}`,
          voiceMethod: "POST",
          voiceFallbackUrl: null,
          voiceFallbackMethod: null,
          statusCallback: `${baseURL}/api/twilio/status/${replacement}`,
          statusCallbackMethod: "POST",
        },
      },
      { sid: "PNllllllllllllllllllllllllllllllll", configuration: priorConfiguration },
    ]);
    expect((await pool!.query("select number_assignment_id, tracking_number from call where id = 'replacement-history-call'")).rows[0]).toEqual({
      number_assignment_id: original,
      tracking_number: "+14155550112",
    });
  });

  it("keeps the current Tracking Number when restoring the replaced number fails", async () => {
    const cookie = await signIn("operator@example.com");
    const workspaceId = (await pool!.query("select id from workspace where name = 'Replacement Workspace'")).rows[0].id as string;
    const current = (await pool!.query("select id from number_assignment where workspace_id = $1 and ended_at is null", [workspaceId])).rows[0].id as string;
    updates.length = 0;
    failingUpdateSid = "PNmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm";
    try {
      const failed = await json(
        new Request(`${baseURL}/api/workspaces/${workspaceId}/replace-number`, {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ twilioNumberId: "routing-number-n" }),
        }),
      );
      expect(failed.response.status).toBe(502);
    } finally {
      failingUpdateSid = null;
    }
    const active = await pool!.query("select id from number_assignment where workspace_id = $1 and ended_at is null", [workspaceId]);
    expect(active.rows).toEqual([{ id: current }]);
    expect((await pool!.query("select count(*)::int as count from number_assignment where twilio_number_id = 'routing-number-n'")).rows[0].count).toBe(0);
    expect(updates.map((update) => update.sid)).toEqual(["PNnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn", "PNnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn"]);
    expect(updates[1].configuration).toEqual(priorConfiguration);
  });

  it("refuses replacement with an assigned number or outside an Active Workspace", async () => {
    const cookie = await signIn("operator@example.com");
    const workspaceId = (await pool!.query("select id from workspace where name = 'Replacement Workspace'")).rows[0].id as string;
    const assigned = await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/replace-number`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ twilioNumberId: "routing-number-a" }),
      }),
    );
    expect(assigned.response.status).toBe(409);
    expect(assigned.body.error).toBe("number_unavailable");
    const setupWorkspaceId = await createWorkspace(cookie, "Replacement Setup Workspace");
    const notActive = await json(
      new Request(`${baseURL}/api/workspaces/${setupWorkspaceId}/replace-number`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ twilioNumberId: "routing-number-n" }),
      }),
    );
    expect(notActive.response.status).toBe(409);
    expect(notActive.body.error).toBe("activation_required");
  });

  it("detaches the Tracking Number, returns the Workspace to Setup Required, and reactivates on another number", async () => {
    const cookie = await signIn("operator@example.com");
    const workspaceId = await createWorkspace(cookie, "Detach Workspace");
    await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/routing`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ destinationNumber: "+14155550101", recordingEnabled: false, analysisEnabled: false, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null }),
      }),
    );
    await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/activate`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ twilioNumberId: "routing-number-o" }),
      }),
    );
    updates.length = 0;
    const detached = await json(new Request(`${baseURL}/api/workspaces/${workspaceId}/detach-number`, { method: "POST", headers: { cookie } }));
    expect(detached.response.status).toBe(200);
    expect(detached.body.workspace).toMatchObject({ state: "Setup Required", trackingNumber: null });
    expect(updates).toEqual([{ sid: "PNoooooooooooooooooooooooooooooooo", configuration: priorConfiguration }]);
    expect((await pool!.query("select ended_reason, ended_at is not null as ended from number_assignment where workspace_id = $1", [workspaceId])).rows).toEqual([
      { ended_reason: "detached", ended: true },
    ]);

    const reactivated = await json(
      new Request(`${baseURL}/api/workspaces/${workspaceId}/activate`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ twilioNumberId: "routing-number-p" }),
      }),
    );
    expect(reactivated.response.status).toBe(200);
    expect(reactivated.body.workspace).toMatchObject({ state: "Active", trackingNumber: "+14155550116" });
  });

  it("keeps the Workspace Active when restoring the detached number fails", async () => {
    const cookie = await signIn("operator@example.com");
    const workspaceId = (await pool!.query("select id from workspace where name = 'Detach Workspace'")).rows[0].id as string;
    failingUpdateSid = "PNpppppppppppppppppppppppppppppppp";
    try {
      const failed = await json(new Request(`${baseURL}/api/workspaces/${workspaceId}/detach-number`, { method: "POST", headers: { cookie } }));
      expect(failed.response.status).toBe(502);
    } finally {
      failingUpdateSid = null;
    }
    expect((await pool!.query("select state from workspace where id = $1", [workspaceId])).rows[0].state).toBe("Active");
    expect((await pool!.query("select twilio_number_id from number_assignment where workspace_id = $1 and ended_at is null", [workspaceId])).rows).toEqual([
      { twilio_number_id: "routing-number-p" },
    ]);
  });

  it("refuses to detach a number outside an Active Workspace", async () => {
    const cookie = await signIn("operator@example.com");
    const setupWorkspaceId = await createWorkspace(cookie, "Detach Setup Workspace");
    const refused = await json(new Request(`${baseURL}/api/workspaces/${setupWorkspaceId}/detach-number`, { method: "POST", headers: { cookie } }));
    expect(refused.response.status).toBe(409);
    expect(refused.body.error).toBe("activation_required");
  });
});
