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
import { replayCallCallbacks, reportTrackingNumberCalls } from "@/data/call-smoke";
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

async function post(path: string, params: Record<string, string>): Promise<Response> {
  return handler()(webhookRequest(path, params, sign(`${baseURL}${path}`, params)));
}

async function startCall(callSid: string): Promise<void> {
  expect((await post(`/api/twilio/voice/${assignmentId}`, voiceParams(callSid))).status).toBe(200);
}

function forwardStatus(callSid: string, status: string): Promise<Response> {
  return post(`/api/twilio/forward-status/${assignmentId}?node=forward`, {
    AccountSid: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    CallSid: `${callSid}-forward`,
    ParentCallSid: callSid,
    CallStatus: status,
    Direction: "outbound-dial",
  });
}

function callStatus(callSid: string, status: string, duration = "42"): Promise<Response> {
  return post(`/api/twilio/status/${assignmentId}`, { ...voiceParams(callSid), CallStatus: status, CallDuration: duration });
}

async function callState(callSid: string): Promise<Record<string, unknown>> {
  const result = await pool!.query(
    `select state, outcome, outcome_reason, answered_at is not null as answered, ended_at is not null as ended, duration_seconds
       from call where twilio_call_sid = $1`,
    [callSid],
  );
  return result.rows[0];
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
  await pool.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ('archived-number', $1, 'PNbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '+14155550102', 'Archived Number', true, now(), now(), now(), now())`,
    [organizationId],
  );
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, destination_number, created_at, updated_at, archived_at)
     values ('archived-workspace', $1, 'Archived Workspace', 'UTC', 'Archived', $2, now(), now(), now())`,
    [organizationId, destinationNumber],
  );
  await pool.query(
    `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, ended_at, ended_reason, created_at)
     values ('archived-assignment', $1, 'archived-workspace', 'archived-number', '+14155550102', now(), now(), 'archived', now())`,
    [organizationId],
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

  it("answers a signed Incoming Call with Forward Call TwiML from the pinned Flow Version", async () => {
    const params = voiceParams();
    const response = await handler()(webhookRequest(voicePath, params, sign(`${baseURL}${voicePath}`, params)));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/xml");
    expect(await response.text()).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response>' +
        `<Dial action="${baseURL}/api/twilio/forward/${assignmentId}?node=forward" method="POST" timeout="30">` +
        `<Number statusCallback="${baseURL}/api/twilio/forward-status/${assignmentId}?node=forward" statusCallbackEvent="initiated answered completed" statusCallbackMethod="POST">${destinationNumber}</Number>` +
        "</Dial></Response>",
    );
    const call = await pool!.query("select forward_node_id, outcome from call where twilio_call_sid = $1", [params.CallSid]);
    expect(call.rows).toEqual([{ forward_node_id: "forward", outcome: null }]);
  });

  it("creates one In Progress Call pinned to the published Flow Version", async () => {
    const callSid = "CA00000000000000000000000000000002";
    const params = voiceParams(callSid);
    const response = await handler()(webhookRequest(voicePath, params, sign(`${baseURL}${voicePath}`, params)));
    expect(response.status).toBe(200);
    const calls = await pool!.query(
      `select workspace_id, number_assignment_id, flow_version_id, tracking_number, caller_number, state, outcome
         from call where twilio_call_sid = $1`,
      [callSid],
    );
    expect(calls.rows).toEqual([
      {
        workspace_id: "webhook-workspace",
        number_assignment_id: assignmentId,
        flow_version_id: "webhook-flow-version-1",
        tracking_number: trackingNumber,
        caller_number: "+14155550123",
        state: "In Progress",
        outcome: null,
      },
    ]);
    const events = await pool!.query(
      `select e.kind, e.disposition from provider_event e join call c on c.id = e.call_id where c.twilio_call_sid = $1`,
      [callSid],
    );
    expect(events.rows).toEqual([{ kind: "voice", disposition: "accepted" }]);
  });

  it("resumes the same Call without duplicating it or its event on duplicate delivery", async () => {
    const callSid = "CA00000000000000000000000000000003";
    const params = voiceParams(callSid);
    const first = await handler()(webhookRequest(voicePath, params, sign(`${baseURL}${voicePath}`, params)));
    const replay = await handler()(webhookRequest(voicePath, params, sign(`${baseURL}${voicePath}`, params)));
    expect(replay.status).toBe(200);
    expect(await replay.text()).toBe(await first.text());
    const counts = await pool!.query<{ calls: number; events: number }>(
      `select (select count(*)::int from call where twilio_call_sid = $1) as calls,
              (select count(*)::int from provider_event e join call c on c.id = e.call_id where c.twilio_call_sid = $1) as events`,
      [callSid],
    );
    expect(counts.rows[0]).toEqual({ calls: 1, events: 1 });
  });
});

describe.sequential("Call Outcome lifecycle", () => {
  it("completes an answered Call once the Forward Call and the Incoming Call both end", async () => {
    const callSid = "CA00000000000000000000000000000010";
    await startCall(callSid);
    expect((await forwardStatus(callSid, "initiated")).status).toBe(204);
    await forwardStatus(callSid, "in-progress");
    expect(await callState(callSid)).toMatchObject({ state: "In Progress", outcome: null, answered: true });
    await forwardStatus(callSid, "completed");
    expect(await callState(callSid)).toMatchObject({ state: "In Progress", outcome: "Answered" });
    expect((await callStatus(callSid, "completed", "42")).status).toBe(204);
    expect(await callState(callSid)).toEqual({ state: "Completed", outcome: "Answered", outcome_reason: "flow_outcome", answered: true, ended: true, duration_seconds: 42 });
  });

  it.each([
    ["busy", "Missed"],
    ["no-answer", "Missed"],
    ["failed", "Failed"],
    ["canceled", "Abandoned"],
  ])("maps a %s Forward Call to %s even when the Incoming Call ends first", async (status, outcome) => {
    const callSid = `CA0000000000000000000000000000${status.replace(/[^a-z]/g, "").slice(0, 4).padEnd(4, "x")}`;
    await startCall(callSid);
    await forwardStatus(callSid, "initiated");
    await callStatus(callSid, "completed", "9");
    expect(await callState(callSid)).toMatchObject({ state: "In Progress", outcome: null, ended: true });
    await forwardStatus(callSid, status);
    expect(await callState(callSid)).toMatchObject({ state: "Completed", outcome });
  });

  it("marks a caller who hangs up before the Forward Call starts as Abandoned", async () => {
    const callSid = "CA00000000000000000000000000000011";
    await startCall(callSid);
    await callStatus(callSid, "completed", "3");
    expect(await callState(callSid)).toMatchObject({ state: "Completed", outcome: "Abandoned", outcome_reason: "ended_before_forward" });
  });

  it("corrects a provisional Abandoned outcome when the Forward Call result arrives late", async () => {
    const callSid = "CA00000000000000000000000000000016";
    await startCall(callSid);
    await callStatus(callSid, "completed", "40");
    expect(await callState(callSid)).toMatchObject({ state: "Completed", outcome: "Abandoned", outcome_reason: "ended_before_forward" });
    await forwardStatus(callSid, "initiated");
    await forwardStatus(callSid, "completed");
    expect(await callState(callSid)).toMatchObject({ state: "Completed", outcome: "Answered", outcome_reason: "flow_outcome" });
  });

  it("returns the published branch TwiML to the Forward Call action", async () => {
    const callSid = "CA00000000000000000000000000000012";
    await startCall(callSid);
    const action = await post(`/api/twilio/forward/${assignmentId}?node=forward`, { ...voiceParams(callSid), CallStatus: "in-progress", DialCallStatus: "no-answer" });
    expect(action.status).toBe(200);
    expect(await action.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
  });

  it("keeps a Call on its pinned Flow Version after a new publication", async () => {
    const callSid = "CA00000000000000000000000000000013";
    await startCall(callSid);
    const republished = generateInitialCallFlow({ destinationNumber, recordingEnabled: false, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });
    republished.nodes = republished.nodes.map((node) => (node.id === "outcome-answered" && node.type === "outcome" ? { ...node, outcome: "Missed" } : node));
    await pool!.query(
      `insert into flow_version (id, organization_id, workspace_id, version, graph, published_at)
       select 'webhook-flow-version-2', organization_id, 'webhook-workspace', 2, $1, now() from workspace where id = 'webhook-workspace'`,
      [JSON.stringify(republished)],
    );
    await forwardStatus(callSid, "initiated");
    await forwardStatus(callSid, "completed");
    await callStatus(callSid, "completed");
    expect(await callState(callSid)).toMatchObject({ state: "Completed", outcome: "Answered" });
    const pinned = await pool!.query("select flow_version_id from call where twilio_call_sid = $1", [callSid]);
    expect(pinned.rows[0].flow_version_id).toBe("webhook-flow-version-1");
  });

  it("leaves state and events unchanged when status callbacks are replayed", async () => {
    const callSid = "CA00000000000000000000000000000014";
    await startCall(callSid);
    await forwardStatus(callSid, "initiated");
    await forwardStatus(callSid, "completed");
    await callStatus(callSid, "completed", "42");
    const before = await pool!.query("select * from call where twilio_call_sid = $1", [callSid]);
    const eventsBefore = await pool!.query("select count(*)::int as count from provider_event e join call c on c.id = e.call_id where c.twilio_call_sid = $1", [callSid]);
    await forwardStatus(callSid, "completed");
    await callStatus(callSid, "completed", "42");
    await forwardStatus(callSid, "canceled");
    const after = await pool!.query("select * from call where twilio_call_sid = $1", [callSid]);
    const eventsAfter = await pool!.query("select count(*)::int as count from provider_event e join call c on c.id = e.call_id where c.twilio_call_sid = $1", [callSid]);
    expect(after.rows).toEqual(before.rows);
    expect(eventsAfter.rows[0].count).toBe(eventsBefore.rows[0].count + 1);
  });

  it("rejects status callbacks without a valid signature", async () => {
    const params = { ...voiceParams("CA00000000000000000000000000000015"), CallStatus: "completed" };
    const response = await handler()(webhookRequest(`/api/twilio/status/${assignmentId}`, params, sign(`${baseURL}/api/twilio/status/${assignmentId}`, params, "other-auth-token")));
    expect(response.status).toBe(403);
  });
});

describe.sequential("Inactive Number Assignments", () => {
  it("rejects a Call to an ended Number Assignment without creating a Call", async () => {
    const callSid = "CA00000000000000000000000000000020";
    const path = "/api/twilio/voice/archived-assignment";
    const params = { ...voiceParams(callSid), To: "+14155550102" };
    const response = await post(path, params);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>');
    expect((await pool!.query("select count(*)::int as count from call where twilio_call_sid = $1", [callSid])).rows[0].count).toBe(0);
    const events = await pool!.query("select kind, disposition, detail, call_id, number_assignment_id from provider_event where idempotency_key = $1", [`${callSid}:voice`]);
    expect(events.rows).toEqual([{ kind: "voice", disposition: "rejected", detail: "inactive_assignment", call_id: null, number_assignment_id: "archived-assignment" }]);
  });
});

describe.sequential("Staging call smoke", () => {
  it("reports the newest Calls on a Tracking Number with their provider events", async () => {
    const calls = await reportTrackingNumberCalls(pool!, trackingNumber, 2);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ twilioCallSid: expect.any(String), state: expect.any(String), events: expect.any(Array) });
    const answered = (await reportTrackingNumberCalls(pool!, trackingNumber, 50)).find((call) => call.twilioCallSid === "CA00000000000000000000000000000010");
    expect(answered).toMatchObject({ state: "Completed", outcome: "Answered", durationSeconds: 42 });
    expect(answered?.events.map((event) => `${event.kind}:${event.status}`)).toEqual([
      "voice:ringing",
      "forward_status:initiated",
      "forward_status:in-progress",
      "forward_status:completed",
      "status:completed",
    ]);
  });

  it("replays a completed Call's signed status callbacks without changing it", async () => {
    const callId = (await pool!.query("select id from call where twilio_call_sid = 'CA00000000000000000000000000000010'")).rows[0].id as string;
    const result = await replayCallCallbacks({ pool: pool!, callId, baseURL, authToken, send: (request) => handler()(request) });
    expect(result).toEqual({ replayed: 4, rejected: 0, unchanged: true });
  });
});
