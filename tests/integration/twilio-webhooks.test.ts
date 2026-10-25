/**
 * -------------------------------------------------------------------------
 * @file   twilio-webhooks.test.ts
 * @brief  Verifies the inbound Twilio voice and status webhook boundary.
 *
 * @description
 *  Sends Twilio-shaped form requests to the webhook handler against a real
 *  PostgreSQL database seeded with an Active Workspace, its Number
 *  Assignment, and its published Flow Version, and checks the Recordings
 *  that connected and voicemail recording callbacks create.
 *
 * @remarks
 *  Requests are signed with node:crypto in the test so the expected signature
 *  never depends on Tracer's own signing code. Recording processing is a fake
 *  at the Trigger.dev boundary that records each request.
 *
 * @see
 *  data/twilio-webhook-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createHmac } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestPool } from "./test-pool";

import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { generateInitialCallFlow, type CallFlowGraph, type WeeklyWindow } from "@/data/call-flow";
import { encryptSecret } from "@/data/credential-encryption";
import { migrateDatabase } from "@/data/migrate";
import { masterKeyFingerprint } from "@/data/provider-credential";
import type { RecordingProcessing } from "@/data/recording";
import { replayCallCallbacks, reportTrackingNumberCalls } from "@/data/call-smoke";
import { createTwilioWebhookHandler } from "@/data/twilio-webhook-handler";

import fixtures from "../contracts/fixtures/twilio/voice-callbacks.json";

const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const authToken = "webhook-auth-token";
const baseURL = "https://tracer.example.com";
const assignmentId = "webhook-assignment";
const trackingNumber = "+14155550101";
const destinationNumber = "+14155550199";

const routingAssignmentId = "routing-assignment";
const routingTrackingNumber = "+14155550103";
const routingTimeZone = "Pacific/Kiritimati";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;

const processingRequests: { id: string; organizationId: string; idempotencyKey: string; committed: boolean }[] = [];
let processingUnavailable = false;
const recordingProcessing: RecordingProcessing = {
  async request(recording) {
    const committed = (await pool!.query("select 1 from recording where id = $1", [recording.id])).rowCount === 1;
    processingRequests.push({ ...recording, committed });
    if (processingUnavailable) throw new Error("Trigger.dev unavailable");
  },
};

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
  return createTwilioWebhookHandler({ pool: pool!, masterKey, baseURL, recordingProcessing });
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
  pool = createTestPool(container.getConnectionUri());
  await migrateDatabase(container.getConnectionUri());
  const { organizationId, userId } = await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "Webhook Operator", timezone: "UTC" });
  await pool.query(
    `insert into twilio_connection (id, organization_id, account_sid, api_key_sid, api_key_secret_ciphertext, auth_token_ciphertext, connected_by_user_id, connected_at, created_at, updated_at)
     values ('webhook-connection', $1, 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'SK11111111111111111111111111111111', $2, $3, $4, now(), now(), now())`,
    [organizationId, await encryptSecret(masterKey, "api-key-secret"), await encryptSecret(masterKey, authToken), userId],
  );
  await pool.query("update twilio_connection set master_key_fingerprint = $1 where master_key_fingerprint is null", [await masterKeyFingerprint(masterKey)]);
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
  await pool.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ('routing-number', $1, 'PNcccccccccccccccccccccccccccccccc', $2, 'Routing Number', true, now(), now(), now(), now())`,
    [organizationId, routingTrackingNumber],
  );
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, destination_number, created_at, updated_at)
     values ('routing-workspace', $1, 'Routing Workspace', $2, 'Active', $3, now(), now())`,
    [organizationId, routingTimeZone, destinationNumber],
  );
  await pool.query(
    `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at)
     values ($1, $2, 'routing-workspace', 'routing-number', $3, now(), now())`,
    [routingAssignmentId, organizationId, routingTrackingNumber],
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

let routingVersion = 0;

async function publishRoutingFlow(graph: CallFlowGraph): Promise<void> {
  routingVersion += 1;
  await pool!.query(
    `insert into flow_version (id, organization_id, workspace_id, version, graph, published_at)
     select $1, organization_id, 'routing-workspace', $2, $3, now() from workspace where id = 'routing-workspace'`,
    [`routing-flow-version-${routingVersion}`, routingVersion, JSON.stringify(graph)],
  );
}

function routingPost(path: string, params: Record<string, string>): Promise<Response> {
  return post(path.replace("{assignment}", routingAssignmentId), params);
}

async function startRoutingCall(callSid: string): Promise<string> {
  const response = await routingPost("/api/twilio/voice/{assignment}", { ...voiceParams(callSid), To: routingTrackingNumber });
  expect(response.status).toBe(200);
  return response.text();
}

function routingCallStatus(callSid: string, status: string, duration = "12"): Promise<Response> {
  return routingPost("/api/twilio/status/{assignment}", { ...voiceParams(callSid), To: routingTrackingNumber, CallStatus: status, CallDuration: duration });
}

function windowAroundNowIn(timeZone: string): WeeklyWindow {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const clock = (value: number): string => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  return {
    day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday) as WeeklyWindow["day"],
    start: clock(Math.max(0, minutes - 30)),
    end: minutes + 30 >= 24 * 60 ? "24:00" : clock(minutes + 30),
  };
}

function businessHoursFlow(weeklyWindows: WeeklyWindow[]): CallFlowGraph {
  const graph = generateInitialCallFlow({ destinationNumber, recordingEnabled: false, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });
  return {
    version: 1,
    nodes: [
      ...graph.nodes,
      { id: "hours", type: "business_hours", position: { x: 0, y: 0 }, weeklyWindows, dateOverrides: [] },
      { id: "outcome-closed", type: "outcome", position: { x: 0, y: 0 }, outcome: "Missed" },
    ],
    edges: [
      ...graph.edges.filter((edge) => edge.source !== "incoming"),
      { id: "incoming-next", source: "incoming", sourceHandle: "next", target: "hours" },
      { id: "hours-open", source: "hours", sourceHandle: "open", target: "forward" },
      { id: "hours-closed", source: "hours", sourceHandle: "closed", target: "outcome-closed" },
    ],
  };
}

function gatedFlow(): CallFlowGraph {
  return generateInitialCallFlow({ destinationNumber, recordingEnabled: false, spamGateEnabled: true, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });
}

function gatherAction(callSid: string, digits: string, attempt: number): Promise<Response> {
  return routingPost(`/api/twilio/gather/{assignment}?node=gate&attempt=${attempt}`, { ...voiceParams(callSid), To: routingTrackingNumber, CallStatus: "in-progress", Digits: digits });
}

function voicemailFlow(entry: "closed" | "missed"): CallFlowGraph {
  const window = windowAroundNowIn(routingTimeZone);
  const graph = entry === "closed" ? businessHoursFlow([{ ...window, day: ((window.day + 3) % 7) as WeeklyWindow["day"] }]) : generateInitialCallFlow({ destinationNumber, recordingEnabled: false, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });
  const replaced = entry === "closed" ? "outcome-closed" : "outcome-missed";
  return {
    version: 1,
    nodes: [
      ...graph.nodes.filter((node) => node.id !== replaced),
      { id: "voicemail", type: "voicemail", position: { x: 0, y: 0 }, greeting: "Please leave a message.", voice: "Polly.Joanna" },
      { id: "outcome-voicemail", type: "outcome", position: { x: 0, y: 0 }, outcome: "Voicemail" },
    ],
    edges: [
      ...graph.edges.map((edge) => (edge.target === replaced ? { ...edge, target: "voicemail" } : edge)),
      { id: "voicemail-next", source: "voicemail", sourceHandle: "next", target: "outcome-voicemail" },
    ],
  };
}

function recordingStatus(callSid: string, status: string, duration: string): Promise<Response> {
  return routingPost("/api/twilio/voicemail-status/{assignment}?node=voicemail", {
    AccountSid: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    CallSid: callSid,
    RecordingSid: `RE${callSid.slice(2)}`,
    RecordingStatus: status,
    RecordingDuration: duration,
    RecordingChannels: "1",
    RecordingSource: "RecordVerb",
  });
}

function routingForwardStatus(callSid: string, status: string): Promise<Response> {
  return routingPost("/api/twilio/forward-status/{assignment}?node=forward", { AccountSid: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", CallSid: `${callSid}-forward`, ParentCallSid: callSid, CallStatus: status, Direction: "outbound-dial" });
}

async function voicemailState(callSid: string): Promise<Record<string, unknown>> {
  const result = await pool!.query("select voicemail_recording_sid, voicemail_duration_seconds from call where twilio_call_sid = $1", [callSid]);
  return result.rows[0];
}

describe.sequential("First-release Call routing", () => {
  it("forwards a Call that starts inside a Business Hours window in the Workspace timezone", async () => {
    await publishRoutingFlow(businessHoursFlow([windowAroundNowIn(routingTimeZone)]));
    const twiml = await startRoutingCall("CA00000000000000000000000000000100");
    expect(twiml).toContain("<Dial ");
  });

  it("completes a Call that starts outside Business Hours on the Closed branch outcome", async () => {
    const window = windowAroundNowIn(routingTimeZone);
    await publishRoutingFlow(businessHoursFlow([{ ...window, day: ((window.day + 3) % 7) as WeeklyWindow["day"] }]));
    const callSid = "CA00000000000000000000000000000101";
    expect(await startRoutingCall(callSid)).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    await routingCallStatus(callSid, "completed", "2");
    expect(await callState(callSid)).toMatchObject({ state: "Completed", outcome: "Missed", outcome_reason: "flow_outcome" });
  });

  it("prompts a gated Call and ends it as Blocked when the caller hangs up during the gate", async () => {
    await publishRoutingFlow(gatedFlow());
    const callSid = "CA00000000000000000000000000000110";
    expect(await startRoutingCall(callSid)).toContain(`action="${baseURL}/api/twilio/gather/${routingAssignmentId}?node=gate&amp;attempt=1"`);
    await routingCallStatus(callSid, "completed", "6");
    expect(await callState(callSid)).toMatchObject({ state: "Completed", outcome: "Blocked", outcome_reason: "gate_not_completed" });
  });

  it("forwards a gated Call after the caller presses the gate digit", async () => {
    const callSid = "CA00000000000000000000000000000111";
    await startRoutingCall(callSid);
    const passed = await gatherAction(callSid, "1", 1);
    expect(passed.status).toBe(200);
    expect(await passed.text()).toContain("<Dial ");
    await routingPost("/api/twilio/forward-status/{assignment}?node=forward", { AccountSid: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", CallSid: `${callSid}-forward`, ParentCallSid: callSid, CallStatus: "initiated" });
    await routingPost("/api/twilio/forward-status/{assignment}?node=forward", { AccountSid: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", CallSid: `${callSid}-forward`, ParentCallSid: callSid, CallStatus: "completed" });
    await routingCallStatus(callSid, "completed", "30");
    expect(await callState(callSid)).toMatchObject({ state: "Completed", outcome: "Answered" });
  });

  it("blocks a gated Call that fails the gate twice without ever forwarding it", async () => {
    const callSid = "CA00000000000000000000000000000112";
    await startRoutingCall(callSid);
    expect(await (await gatherAction(callSid, "9", 1)).text()).toContain("attempt=2");
    expect(await (await gatherAction(callSid, "", 2)).text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    await routingCallStatus(callSid, "completed", "20");
    expect(await callState(callSid)).toMatchObject({ state: "Completed", outcome: "Blocked", outcome_reason: "flow_outcome" });
    const forward = await pool!.query("select forward_node_id from call where twilio_call_sid = $1", [callSid]);
    expect(forward.rows[0].forward_node_id).toBeNull();
  });

  it("answers a duplicate gate result with the same TwiML and one provider event", async () => {
    const callSid = "CA00000000000000000000000000000113";
    await startRoutingCall(callSid);
    const first = await (await gatherAction(callSid, "4", 1)).text();
    expect(await (await gatherAction(callSid, "4", 1)).text()).toBe(first);
    const events = await pool!.query("select kind from provider_event e join call c on c.id = e.call_id where c.twilio_call_sid = $1 order by e.received_at", [callSid]);
    expect(events.rows.map((row) => row.kind)).toEqual(["voice", "gather"]);
  });

  it("speaks the Whisper to the business leg of a Call pinned to a Whisper flow", async () => {
    await publishRoutingFlow(generateInitialCallFlow({ destinationNumber, recordingEnabled: false, spamGateEnabled: false, whisperEnabled: true, whisperMessage: "Tracer lead", disclosureVoice: "Polly.Joanna" }));
    const callSid = "CA00000000000000000000000000000120";
    expect(await startRoutingCall(callSid)).toContain(`<Number url="${baseURL}/api/twilio/whisper/${routingAssignmentId}?node=whisper" method="POST"`);
    const whisper = await routingPost("/api/twilio/whisper/{assignment}?node=whisper", {
      AccountSid: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      CallSid: `${callSid}-forward`,
      ParentCallSid: callSid,
      CallStatus: "in-progress",
      Direction: "outbound-dial",
    });
    expect(whisper.status).toBe(200);
    expect(await whisper.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna" language="en-US">Tracer lead</Say></Response>');
    const events = await pool!.query("select kind from provider_event e join call c on c.id = e.call_id where c.twilio_call_sid = $1 order by e.received_at", [callSid]);
    expect(events.rows.map((row) => row.kind)).toEqual(["voice", "whisper"]);
  });

  it("captures a voicemail on the Closed path and reports Voicemail even after the Call ends first", async () => {
    await publishRoutingFlow(voicemailFlow("closed"));
    const callSid = "CA00000000000000000000000000000130";
    expect(await startRoutingCall(callSid)).toContain('<Record maxLength="120" timeout="5" finishOnKey="#"');
    const action = await routingPost("/api/twilio/voicemail/{assignment}?node=voicemail", { ...voiceParams(callSid), To: routingTrackingNumber, CallStatus: "in-progress", Digits: "#", RecordingDuration: "14" });
    expect(await action.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    await routingCallStatus(callSid, "completed", "25");
    expect(await callState(callSid)).toMatchObject({ state: "Completed", outcome: "Abandoned", outcome_reason: "voicemail_not_captured" });
    expect((await recordingStatus(callSid, "completed", "14")).status).toBe(204);
    expect(await callState(callSid)).toMatchObject({ state: "Completed", outcome: "Voicemail", outcome_reason: "voicemail_captured" });
    expect(await voicemailState(callSid)).toEqual({ voicemail_recording_sid: `RE${callSid.slice(2)}`, voicemail_duration_seconds: 14 });
  });

  it("ends a Closed-path Call as Abandoned when the caller hangs up during the greeting", async () => {
    const callSid = "CA00000000000000000000000000000131";
    await startRoutingCall(callSid);
    await routingCallStatus(callSid, "completed", "3");
    expect(await callState(callSid)).toMatchObject({ state: "Completed", outcome: "Abandoned", outcome_reason: "voicemail_not_captured" });
  });

  it("captures a voicemail after a missed Forward Call in any callback order", async () => {
    await publishRoutingFlow(voicemailFlow("missed"));
    const callSid = "CA00000000000000000000000000000132";
    await startRoutingCall(callSid);
    await routingForwardStatus(callSid, "initiated");
    const action = await routingPost("/api/twilio/forward/{assignment}?node=forward", { ...voiceParams(callSid), To: routingTrackingNumber, CallStatus: "in-progress", DialCallStatus: "no-answer" });
    expect(await action.text()).toContain("<Record ");
    await recordingStatus(callSid, "completed", "40");
    await routingForwardStatus(callSid, "no-answer");
    await routingCallStatus(callSid, "completed", "70");
    expect(await callState(callSid)).toMatchObject({ state: "Completed", outcome: "Voicemail", outcome_reason: "voicemail_captured" });
  });

  it("keeps a missed Forward Call as Missed when no voicemail audio is captured", async () => {
    const callSid = "CA00000000000000000000000000000133";
    await startRoutingCall(callSid);
    await routingForwardStatus(callSid, "initiated");
    await routingForwardStatus(callSid, "busy");
    await routingCallStatus(callSid, "completed", "15");
    await recordingStatus(callSid, "absent", "0");
    expect(await callState(callSid)).toMatchObject({ state: "Completed", outcome: "Missed", outcome_reason: "voicemail_not_captured" });
  });

  it("reports Failed rather than Voicemail when Twilio fails to capture the voicemail", async () => {
    const callSid = "CA00000000000000000000000000000134";
    await startRoutingCall(callSid);
    await routingForwardStatus(callSid, "initiated");
    await routingForwardStatus(callSid, "no-answer");
    await routingCallStatus(callSid, "completed", "60");
    await recordingStatus(callSid, "failed", "0");
    expect(await callState(callSid)).toMatchObject({ state: "Completed", outcome: "Failed", outcome_reason: "voicemail_capture_failed" });
  });

  it("leaves a captured voicemail unchanged when its recording callback is replayed", async () => {
    const callSid = "CA00000000000000000000000000000132";
    const before = await pool!.query("select * from call where twilio_call_sid = $1", [callSid]);
    await recordingStatus(callSid, "completed", "40");
    await routingForwardStatus(callSid, "no-answer");
    expect((await pool!.query("select * from call where twilio_call_sid = $1", [callSid])).rows).toEqual(before.rows);
  });

  it("creates exactly one caller-only voicemail Recording for a captured voicemail in a Workspace that does not record connected conversations", async () => {
    const callSid = "CA00000000000000000000000000000132";
    expect((await pool!.query("select recording_enabled from workspace where id = 'routing-workspace'")).rows[0].recording_enabled).toBe(false);
    expect(await callRecordings(callSid)).toEqual([
      { workspace_id: "routing-workspace", twilio_recording_sid: `RE${callSid.slice(2)}`, source: "voicemail", channels: 1, duration_seconds: 40, transfer_state: "Pending", twilio_cleanup_state: "Pending" },
    ]);
    const events = await pool!.query("select count(*)::int as count from provider_event e join call c on c.id = e.call_id where c.twilio_call_sid = $1 and e.kind = 'voicemail_status'", [callSid]);
    expect(events.rows[0].count).toBe(1);
  });

  it.each([
    ["absent", "CA00000000000000000000000000000133"],
    ["failed", "CA00000000000000000000000000000134"],
  ])("creates no Recording but keeps the provider event for an %s voicemail recording", async (_status, callSid) => {
    expect(await callRecordings(callSid)).toEqual([]);
    const events = await pool!.query("select count(*)::int as count from provider_event e join call c on c.id = e.call_id where c.twilio_call_sid = $1 and e.kind = 'voicemail_status'", [callSid]);
    expect(events.rows[0].count).toBe(1);
  });

  it("replays a gated voicemail Call's signed callbacks without changing it", async () => {
    const gated = gatedFlow();
    const flowWithVoicemail = voicemailFlow("missed");
    await publishRoutingFlow({
      version: 1,
      nodes: [...flowWithVoicemail.nodes, ...gated.nodes.filter((node) => node.id === "gate" || node.id === "outcome-blocked")],
      edges: [
        ...flowWithVoicemail.edges.filter((edge) => edge.source !== "incoming"),
        { id: "incoming-next", source: "incoming", sourceHandle: "next", target: "gate" },
        { id: "gate-pass", source: "gate", sourceHandle: "pass", target: "forward" },
        { id: "gate-blocked", source: "gate", sourceHandle: "blocked", target: "outcome-blocked" },
      ],
    });
    const callSid = "CA00000000000000000000000000000140";
    await startRoutingCall(callSid);
    await gatherAction(callSid, "1", 1);
    await routingForwardStatus(callSid, "initiated");
    await routingForwardStatus(callSid, "no-answer");
    await recordingStatus(callSid, "completed", "22");
    await routingCallStatus(callSid, "completed", "50");
    expect(await callState(callSid)).toMatchObject({ state: "Completed", outcome: "Voicemail" });
    const [reported] = (await reportTrackingNumberCalls(pool!, routingTrackingNumber, 1));
    expect(reported).toMatchObject({ twilioCallSid: callSid, voicemailDurationSeconds: 22 });
    expect(reported.events.map((event) => `${event.kind}:${event.status}`)).toEqual([
      "voice:ringing",
      "gather:in-progress",
      "forward_status:initiated",
      "forward_status:no-answer",
      "voicemail_status:completed",
      "status:completed",
    ]);
    const callId = (await pool!.query("select id from call where twilio_call_sid = $1", [callSid])).rows[0].id as string;
    expect(await replayCallCallbacks({ pool: pool!, callId, baseURL, authToken, send: (request) => handler()(request) })).toEqual({ replayed: 5, rejected: 0, unchanged: true });
  });
});

function connectedRecordingStatus(callSid: string, payload: Record<string, string>): Promise<Response> {
  return routingPost("/api/twilio/recording-status/{assignment}?node=forward", { ...payload, CallSid: callSid, RecordingSid: `RE${callSid.slice(2)}` });
}

async function callRecordings(callSid: string): Promise<Record<string, unknown>[]> {
  const result = await pool!.query(
    `select r.workspace_id, r.twilio_recording_sid, r.source, r.channels, r.duration_seconds, r.transfer_state, r.twilio_cleanup_state
       from recording r join call c on c.id = r.call_id
      where c.twilio_call_sid = $1
      order by r.created_at`,
    [callSid],
  );
  return result.rows;
}

describe.sequential("Connected conversation Recording", () => {
  it("records the answered Forward Call leg in dual channel for a recording-enabled Workspace", async () => {
    await pool!.query("update workspace set recording_enabled = true where id = 'routing-workspace'");
    await publishRoutingFlow(generateInitialCallFlow({ destinationNumber, recordingEnabled: true, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" }));
    expect(await startRoutingCall("CA00000000000000000000000000000200")).toContain(
      `timeout="30" record="record-from-answer-dual" recordingStatusCallback="${baseURL}/api/twilio/recording-status/${routingAssignmentId}?node=forward" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed absent">`,
    );
  });

  it("rejects connected Recording callbacks without a valid Twilio signature", async () => {
    const path = `/api/twilio/recording-status/${routingAssignmentId}?node=forward`;
    const params = { ...fixtures.dialRecordingStatusCompleted, CallSid: "CA00000000000000000000000000000200" };
    expect((await handler()(webhookRequest(path, params, null))).status).toBe(403);
    expect((await handler()(webhookRequest(path, params, sign(`${baseURL}${path}`, params, "other-auth-token")))).status).toBe(403);
    expect(await callRecordings("CA00000000000000000000000000000200")).toEqual([]);
  });

  it("creates one connected dual-channel Recording for the Call from a signed completed callback", async () => {
    const callSid = "CA00000000000000000000000000000200";
    expect((await connectedRecordingStatus(callSid, fixtures.dialRecordingStatusCompleted)).status).toBe(204);
    expect(await callRecordings(callSid)).toEqual([
      { workspace_id: "routing-workspace", twilio_recording_sid: `RE${callSid.slice(2)}`, source: "connected", channels: 2, duration_seconds: 96, transfer_state: "Pending", twilio_cleanup_state: "Pending" },
    ]);
    const events = await pool!.query("select kind, disposition from provider_event e join call c on c.id = e.call_id where c.twilio_call_sid = $1 and e.kind = 'recording_status'", [callSid]);
    expect(events.rows).toEqual([{ kind: "recording_status", disposition: "accepted" }]);
  });

  it("creates no second Recording or provider event when the connected Recording callback is delivered again", async () => {
    const callSid = "CA00000000000000000000000000000200";
    expect((await connectedRecordingStatus(callSid, fixtures.dialRecordingStatusCompleted)).status).toBe(204);
    expect(await callRecordings(callSid)).toHaveLength(1);
    const events = await pool!.query("select count(*)::int as count from provider_event e join call c on c.id = e.call_id where c.twilio_call_sid = $1 and e.kind = 'recording_status'", [callSid]);
    expect(events.rows[0].count).toBe(1);
  });

  it("persists the provider event but creates no Recording when the connected recording is absent", async () => {
    const callSid = "CA00000000000000000000000000000201";
    await startRoutingCall(callSid);
    expect((await connectedRecordingStatus(callSid, fixtures.dialRecordingStatusAbsent)).status).toBe(204);
    expect(await callRecordings(callSid)).toEqual([]);
    const events = await pool!.query("select kind, disposition from provider_event e join call c on c.id = e.call_id where c.twilio_call_sid = $1 and e.kind = 'recording_status'", [callSid]);
    expect(events.rows).toEqual([{ kind: "recording_status", disposition: "accepted" }]);
  });

  it("requests Recording processing once, after the Recording is committed, with a key derived from the Recording", async () => {
    const callSid = "CA00000000000000000000000000000202";
    await startRoutingCall(callSid);
    processingRequests.length = 0;
    await connectedRecordingStatus(callSid, fixtures.dialRecordingStatusCompleted);
    await connectedRecordingStatus(callSid, fixtures.dialRecordingStatusCompleted);
    const recording = (await pool!.query("select r.id, r.organization_id from recording r join call c on c.id = r.call_id where c.twilio_call_sid = $1", [callSid])).rows[0];
    expect(processingRequests).toEqual([{ id: recording.id, organizationId: recording.organization_id, idempotencyKey: `recording-processing:${recording.id}`, committed: true }]);
  });

  it("acknowledges the callback and keeps the Recording Pending when Recording processing cannot be requested", async () => {
    const callSid = "CA00000000000000000000000000000203";
    await startRoutingCall(callSid);
    processingUnavailable = true;
    try {
      expect((await connectedRecordingStatus(callSid, fixtures.dialRecordingStatusCompleted)).status).toBe(204);
    } finally {
      processingUnavailable = false;
    }
    expect(await callRecordings(callSid)).toMatchObject([{ source: "connected", transfer_state: "Pending" }]);
  });

  it("requests Recording processing for a captured voicemail Recording", async () => {
    const callSid = "CA00000000000000000000000000000204";
    await pool!.query("update workspace set recording_enabled = false where id = 'routing-workspace'");
    await publishRoutingFlow(voicemailFlow("closed"));
    await startRoutingCall(callSid);
    processingRequests.length = 0;
    await recordingStatus(callSid, "completed", "18");
    const recording = (await pool!.query("select r.id from recording r join call c on c.id = r.call_id where c.twilio_call_sid = $1 and r.source = 'voicemail'", [callSid])).rows[0];
    expect(processingRequests).toEqual([expect.objectContaining({ id: recording.id, idempotencyKey: `recording-processing:${recording.id}`, committed: true })]);
  });

  it("creates no Recording and requests no processing for a completed voicemail recording shorter than 1 second", async () => {
    const callSid = "CA00000000000000000000000000000205";
    await startRoutingCall(callSid);
    processingRequests.length = 0;
    expect((await recordingStatus(callSid, "completed", "0")).status).toBe(204);
    expect(await callRecordings(callSid)).toEqual([]);
    expect(processingRequests).toEqual([]);
  });
});

describe.sequential("Staging Recording smoke", () => {
  it("reports each Call's Recordings with source, channels, transfer and cleanup state, and failure stage without object keys or caller numbers", async () => {
    const connectedSid = "CA00000000000000000000000000000200";
    await pool!.query(
      `update recording r set transfer_state = 'Stored', r2_object_key = 'organizations/smoke/recordings/connected.wav', size_bytes = 42, sha256 = 'checksum',
              stored_at = now(), twilio_cleanup_state = 'Failed', failure_stage = 'cleanup', failure_reason = 'Twilio request failed (HTTP 500)'
         from call c where c.id = r.call_id and c.twilio_call_sid = $1`,
      [connectedSid],
    );
    const calls = await reportTrackingNumberCalls(pool!, routingTrackingNumber, 50);
    expect(calls.find((call) => call.twilioCallSid === connectedSid)?.recordings).toEqual([
      { source: "connected", channels: 2, transferState: "Stored", twilioCleanupState: "Failed", failureStage: "cleanup" },
    ]);
    expect(calls.find((call) => call.twilioCallSid === "CA00000000000000000000000000000204")?.recordings).toEqual([
      { source: "voicemail", channels: 1, transferState: "Pending", twilioCleanupState: "Pending", failureStage: null },
    ]);
    expect(calls.find((call) => call.twilioCallSid === "CA00000000000000000000000000000201")?.recordings).toEqual([]);
    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain("organizations/");
    expect(serialized).not.toContain("+14155550123");
    expect(serialized).not.toContain(`RE${connectedSid.slice(2)}`);
  });

  it("replays a connected Call's signed Recording callback without a second Recording, provider event, or processing request", async () => {
    const callSid = "CA00000000000000000000000000000202";
    const callId = (await pool!.query("select id from call where twilio_call_sid = $1", [callSid])).rows[0].id as string;
    const eventCount = async () => (await pool!.query("select count(*)::int as count from provider_event where call_id = $1", [callId])).rows[0].count as number;
    const before = { recordings: await callRecordings(callSid), events: await eventCount() };
    processingRequests.length = 0;
    expect(await replayCallCallbacks({ pool: pool!, callId, baseURL, authToken, send: (request) => handler()(request) })).toEqual({ replayed: 1, rejected: 0, unchanged: true });
    expect({ recordings: await callRecordings(callSid), events: await eventCount() }).toEqual(before);
    expect(processingRequests).toEqual([]);
  });
});

async function callEvents(callSid: string): Promise<{ kind: string; detail: Record<string, unknown> }[]> {
  const result = await pool!.query(
    `select e.kind, e.detail
       from call_event e
       join call c on c.id = e.call_id and c.organization_id = e.organization_id and c.workspace_id = e.workspace_id
      where c.twilio_call_sid = $1
      order by e.occurred_at, e.id`,
    [callSid],
  );
  return result.rows;
}

describe.sequential("Call event log", () => {
  beforeAll(async () => {
    const graph = generateInitialCallFlow({ destinationNumber, recordingEnabled: false, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });
    await pool!.query(
      `insert into flow_version (id, organization_id, workspace_id, version, graph, published_at)
       select 'webhook-flow-version-events', organization_id, 'webhook-workspace', 100, $1, now() from workspace where id = 'webhook-workspace'`,
      [JSON.stringify(graph)],
    );
  });

  it("appends Call received exactly once when the voice webhook is delivered twice", async () => {
    const callSid = "CA00000000000000000000000000000900";
    await startCall(callSid);
    await startCall(callSid);
    expect(await callEvents(callSid)).toEqual([{ kind: "call_received", detail: {} }]);
  });

  it("appends Forwarding attempted once and Call completed with its outcome when the Call completes", async () => {
    const callSid = "CA00000000000000000000000000000901";
    await startCall(callSid);
    await forwardStatus(callSid, "initiated");
    await forwardStatus(callSid, "in-progress");
    await forwardStatus(callSid, "completed");
    expect((await callEvents(callSid)).map((event) => event.kind)).toEqual(["call_received", "forwarding_attempted"]);
    await callStatus(callSid, "completed", "42");
    await callStatus(callSid, "completed", "42");
    await forwardStatus(callSid, "completed");
    expect(await callEvents(callSid)).toEqual([
      { kind: "call_received", detail: {} },
      { kind: "forwarding_attempted", detail: {} },
      { kind: "call_completed", detail: { outcome: "Answered" } },
    ]);
  });

  it("appends a second Call completed event when a late Forward Call result corrects a provisional outcome", async () => {
    const callSid = "CA00000000000000000000000000000902";
    await startCall(callSid);
    await callStatus(callSid, "completed", "40");
    await forwardStatus(callSid, "initiated");
    await forwardStatus(callSid, "completed");
    expect(await callEvents(callSid)).toEqual([
      { kind: "call_received", detail: {} },
      { kind: "call_completed", detail: { outcome: "Abandoned" } },
      { kind: "forwarding_attempted", detail: {} },
      { kind: "call_completed", detail: { outcome: "Answered" } },
    ]);
  });

  it("appends Spam gate passed once when the caller presses the gate digit", async () => {
    await publishRoutingFlow(gatedFlow());
    const callSid = "CA00000000000000000000000000000903";
    await startRoutingCall(callSid);
    await gatherAction(callSid, "1", 1);
    await gatherAction(callSid, "1", 1);
    expect((await callEvents(callSid)).map((event) => event.kind)).toEqual(["call_received", "spam_gate_passed"]);
  });

  it("appends Spam gate failed only after the last gate attempt fails", async () => {
    const callSid = "CA00000000000000000000000000000904";
    await startRoutingCall(callSid);
    await gatherAction(callSid, "9", 1);
    expect((await callEvents(callSid)).map((event) => event.kind)).toEqual(["call_received"]);
    await gatherAction(callSid, "", 2);
    await routingCallStatus(callSid, "completed", "20");
    expect(await callEvents(callSid)).toEqual([
      { kind: "call_received", detail: {} },
      { kind: "spam_gate_failed", detail: {} },
      { kind: "call_completed", detail: { outcome: "Blocked" } },
    ]);
  });

  it("appends Spam gate failed when the caller hangs up during the gate", async () => {
    const callSid = "CA00000000000000000000000000000905";
    await startRoutingCall(callSid);
    await routingCallStatus(callSid, "completed", "6");
    expect((await callEvents(callSid)).map((event) => event.kind)).toEqual(["call_received", "spam_gate_failed", "call_completed"]);
  });
});
