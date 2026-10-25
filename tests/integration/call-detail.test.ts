/**
 * -------------------------------------------------------------------------
 * @file   call-detail.test.ts
 * @brief  Verifies the authorized Call Detail and Recent Calls read model.
 *
 * @description
 *  Signs in a real Operator and Client Viewer and reads Call Detail through
 *  the Workspaces server interface to prove Workspace authorization, the
 *  Operator-only Twilio call SID, derived Call facts, Recording
 *  availability, the Transcript and Lead Assessment with their expiry and
 *  Operator-only failure reasons, and the processing timeline. Reads the
 *  five Recent Calls of a Workspace through the same authorization.
 *
 * @remarks
 *  Calls, provider events, and Recordings are seeded directly in the shape
 *  the webhook and Recording tasks persist, because those writers have
 *  their own suites. The Client Viewer payload is checked as raw text so
 *  an Operator-only identifier cannot leak under another field.
 *
 * @see
 *  data/call-details.ts
 *  data/workspaces-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { generateInitialCallFlow } from "@/data/call-flow";
import { createIntegrations } from "@/data/integrations";
import { migrateDatabase } from "@/data/migrate";
import type { RecordingProcessing, RecordingProcessingRequest } from "@/data/recording";
import { createOperatorAdministrationHandler } from "@/data/operator-administration-handler";
import { schema } from "@/data/schema";
import { createTracerAuth } from "@/data/tracer-auth";
import { type TwilioClient } from "@/data/twilio-client";
import { createWorkspacesHandler } from "@/data/workspaces-handler";
import type { TransactionalEmailMessage } from "@/data/transactional-email";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let organizationId = "";
let clientId = "";
let operatorCookie = "";
let clientCookie = "";
const messages: TransactionalEmailMessage[] = [];
const backgroundTasks: Promise<unknown>[] = [];
const recipients = new Set(["operator@example.com", "client@example.com"]);
const fakeTwilio: TwilioClient = {
  async fetchAccount() { throw new Error("not implemented"); },
  async listIncomingPhoneNumbers() { throw new Error("not implemented"); },
  async fetchIncomingPhoneNumber() { throw new Error("not implemented"); },
  async updateIncomingPhoneNumberVoice() { throw new Error("not implemented"); },
};
const email = { async send(message: (typeof messages)[number]) { messages.push(message); return { messageId: `email-${messages.length}` }; } };

const database = () => drizzle(pool!, { schema });
const auth = () => createTracerAuth({
  database: database(),
  email,
  emailFrom: "auth@example.com",
  allowedRecipients: recipients,
  backgroundTask: (promise) => backgroundTasks.push(promise),
  secret: "integration-only-secret",
  baseURL: "http://localhost:3000",
});

const triggerSecretKey = "tr_dev_synthetic_trigger_secret";

function analysisProcessing(): RecordingProcessing & { requests: RecordingProcessingRequest[]; failing: boolean } {
  const requests: RecordingProcessingRequest[] = [];
  return {
    requests,
    failing: false,
    async request(request) {
      requests.push(request);
      if (this.failing) throw new Error(`Trigger.dev is unavailable for ${triggerSecretKey}`);
    },
  };
}

const transcriptionRequests = analysisProcessing();
const leadAssessmentRequests = analysisProcessing();

const workspacesHandler = () => createWorkspacesHandler({
  recordingTranscription: transcriptionRequests,
  recordingLeadAssessment: leadAssessmentRequests,
  auth: auth(),
  database: database(),
  pool: pool!,
  twilio: fakeTwilio,
  integrations: (id) => createIntegrations({ pool: pool!, organizationId: id, twilio: fakeTwilio, masterKey: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=" }),
  baseURL: "http://localhost:3000",
});

const usersHandler = () => createOperatorAdministrationHandler({
  auth: auth(),
  database: database(),
  pool: pool!,
  email,
  emailFrom: "auth@example.com",
  allowedRecipients: recipients,
  signInUrl: "http://localhost:3000/sign-in",
});

async function signIn(address: string): Promise<string> {
  const before = messages.length;
  const taskCount = backgroundTasks.length;
  const instance = auth();
  const send = await instance.handler(new Request("http://localhost:3000/api/auth/email-otp/send-verification-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: address, type: "sign-in" }) }));
  expect(send.status).toBe(200);
  await Promise.all(backgroundTasks.splice(taskCount));
  const code = messages.slice(before).at(-1)?.text.match(/\d{6}/)?.[0];
  const verify = await instance.handler(new Request("http://localhost:3000/api/auth/sign-in/email-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: address, otp: code }) }));
  expect(verify.status).toBe(200);
  return (verify.headers.get("set-cookie") ?? "").split(";", 1)[0];
}

async function callDetail(workspaceId: string, callId: string, cookie: string) {
  const response = await workspacesHandler()(new Request(`http://localhost:3000/api/workspaces/${workspaceId}/calls/${callId}`, { headers: { cookie } }));
  const text = await response.text();
  return { response, text, body: JSON.parse(text) as { call?: Record<string, unknown> } };
}

async function recentCalls(workspaceId: string, cookie: string) {
  const response = await workspacesHandler()(new Request(`http://localhost:3000/api/workspaces/${workspaceId}/calls`, { headers: { cookie } }));
  return { response, body: (await response.json()) as { calls?: Record<string, unknown>[] } };
}

const graph = generateInitialCallFlow({
  destinationNumber: "+14155550199",
  recordingEnabled: true,
  spamGateEnabled: true,
  whisperEnabled: false,
  whisperMessage: null,
  disclosureVoice: "Polly.Joanna",
});
const unrecordedGraph = generateInitialCallFlow({
  destinationNumber: "+14155550199",
  recordingEnabled: false,
  spamGateEnabled: false,
  whisperEnabled: false,
  whisperMessage: null,
  disclosureVoice: "Polly.Joanna",
});

let seeded = 0;

interface SeedCall {
  workspaceId?: string;
  startedAt?: Date;
  graph?: unknown;
  outcome?: string | null;
  answered?: boolean;
  forwarded?: boolean;
  events?: { kind: string; payload: Record<string, string>; key?: string; secondsAfterStart: number }[];
  recording?: { transferState: "Pending" | "Stored" | "Failed"; waveformState?: "Pending" | "Stored" | "Failed"; mp3State?: "Pending" | "Stored" | "Failed"; channels?: 1 | 2 } | null;
  analysis?: {
    transcript: "Pending" | "Completed" | "Failed" | "Skipped";
    skipReason?: string;
    leadAssessment?: "Pending" | "Completed" | "Failed";
    reviewed?: boolean;
  };
}

const transcriptTurns = [
  { speaker: "Caller", startMs: 0, endMs: 4200, text: "Hi, my water heater is leaking." },
  { speaker: "Business", startMs: 4800, endMs: 7600, text: "We can send someone this afternoon." },
];

async function seedCall(callId: string, options: SeedCall = {}): Promise<{ callSid: string; recordingSid: string; recordingId: string }> {
  seeded += 1;
  const sequence = String(seeded).padStart(32, "0");
  const workspaceId = options.workspaceId ?? "granted-active";
  const workspace = (await pool!.query<{ organization_id: string }>("select organization_id from workspace where id = $1", [workspaceId])).rows[0];
  const startedAt = options.startedAt ?? new Date(Date.now() - 600_000 - seeded * 1000);
  const at = (seconds: number) => new Date(startedAt.getTime() + seconds * 1000);
  const trackingNumber = `+1415555${String(seeded).padStart(4, "0")}`;
  await pool!.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ($1, $2, $3, $4, 'Call Number', true, now(), now(), now(), now())`,
    [`${callId}-number`, workspace.organization_id, `PN${sequence}`, trackingNumber],
  );
  await pool!.query(
    `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, ended_at, ended_reason, created_at)
     values ($1, $2, $3, $4, $5, now(), now(), 'replaced', now())`,
    [`${callId}-assignment`, workspace.organization_id, workspaceId, `${callId}-number`, trackingNumber],
  );
  await pool!.query(
    `insert into flow_version (id, organization_id, workspace_id, version, graph, published_at)
     values ($1, $2, $3, $4, $5, now())`,
    [`${callId}-flow`, workspace.organization_id, workspaceId, seeded, JSON.stringify(options.graph ?? graph)],
  );
  const outcome = options.outcome === undefined ? "Answered" : options.outcome;
  const answered = options.answered ?? outcome === "Answered";
  const forwarded = options.forwarded ?? answered;
  const callSid = `CA${sequence}`;
  await pool!.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, caller_number,
                       state, outcome, outcome_reason, forward_node_id, forward_started_at, forward_status, started_at, answered_at, ended_at, duration_seconds, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, '+13125550142', $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now(), now())`,
    [
      callId, workspace.organization_id, workspaceId, `${callId}-assignment`, `${callId}-flow`, callSid, trackingNumber,
      outcome ? "Completed" : "In Progress", outcome, outcome ? "flow_outcome" : null,
      forwarded ? "forward" : null, forwarded ? at(8) : null, forwarded ? (answered ? "completed" : "no-answer") : null,
      startedAt, answered ? at(12) : null, outcome ? at(95) : null, outcome ? 95 : null,
    ],
  );
  for (const [index, event] of (options.events ?? []).entries()) {
    await pool!.query(
      `insert into provider_event (id, organization_id, number_assignment_id, call_id, idempotency_key, kind, disposition, payload, received_at)
       values ($1, $2, $3, $4, $5, $6, 'accepted', $7, $8)`,
      [`${callId}-event-${index}`, workspace.organization_id, `${callId}-assignment`, callId, event.key?.replace("{sid}", callSid) ?? `${callSid}:${event.kind}:${index}`, event.kind, JSON.stringify({ CallSid: callSid, ...event.payload }), at(event.secondsAfterStart)],
    );
  }
  const recordingId = `${callId}-recording`;
  const recordingSid = `RE${sequence}`;
  const recording = options.recording === undefined ? { transferState: "Stored" as const, waveformState: "Stored" as const } : options.recording;
  if (recording) {
    const stored = recording.transferState === "Stored";
    const waveformState = stored ? (recording.waveformState ?? "Stored") : "Pending";
    await pool!.query(
      `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, transfer_state, r2_object_key, size_bytes, sha256, stored_at,
                              failure_stage, failure_reason, waveform_state, waveform_object_key, waveform_generated_at, waveform_failure_reason, created_at, updated_at)
       values ($1, $2, $3, $4, $5, 'connected', $6, 83, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        recordingId, workspace.organization_id, workspaceId, callId, recordingSid, recording.channels ?? 2, recording.transferState,
        stored ? `recordings/${recordingId}.wav` : null, stored ? 1024 : null, stored ? "checksum" : null, stored ? at(100) : null,
        recording.transferState === "Failed" ? "download" : null, recording.transferState === "Failed" ? "Twilio download failed with status 500" : null,
        waveformState, waveformState === "Stored" ? `recordings/${recordingId}.peaks.json` : null, waveformState === "Stored" ? at(110) : null,
        waveformState === "Failed" ? "audiowaveform exited with code 1" : null, at(96), at(120),
      ],
    );
    const mp3State = stored ? (recording.mp3State ?? "Stored") : "Pending";
    if (mp3State !== "Pending") {
      await pool!.query(
        "update recording set mp3_state = $2, mp3_object_key = $3, mp3_size_bytes = $4, mp3_generated_at = $5, mp3_failure_reason = $6 where id = $1",
        [recordingId, mp3State, mp3State === "Stored" ? `recordings/${recordingId}.mp3` : null, mp3State === "Stored" ? 512 : null, at(115), mp3State === "Failed" ? "ffmpeg could not encode the MP3" : null],
      );
    }
  }
  const analysis = options.analysis;
  if (recording && analysis) {
    const completed = analysis.transcript === "Completed";
    await pool!.query(
      `update recording set transcript_state = $2, transcript_skip_reason = $3, transcript_failure_reason = $4, transcript_audio_ms = $5, transcript_cost_usd = $6,
                            transcript_completed_at = $7, lead_assessment_state = $8, lead_assessment_failure_reason = $9, updated_at = $10
        where id = $1`,
      [
        recordingId, analysis.transcript, analysis.transcript === "Skipped" ? (analysis.skipReason ?? "too_short") : null,
        analysis.transcript === "Failed" ? "OpenAI request failed (HTTP 500)" : null, completed ? 166_000 : null, completed ? 0.0166 : null, completed ? at(130) : null,
        analysis.leadAssessment ?? null, analysis.leadAssessment === "Failed" ? "OpenAI response was incomplete" : null, at(145),
      ],
    );
    if (completed) {
      await pool!.query("insert into transcript (recording_id, organization_id, call_id, turns, model, created_at) values ($1, $2, $3, $4, 'whisper-1', $5)", [
        recordingId, workspace.organization_id, callId, JSON.stringify(transcriptTurns), at(130),
      ]);
    }
    if (analysis.leadAssessment === "Completed") {
      await pool!.query(
        `insert into lead_assessment (id, organization_id, call_id, recording_id, classification, score, summary, rationale, model, input_tokens, output_tokens, cost_usd, processed_at)
         values ($1, $2, $3, $4, 'Good Lead', 86, 'Caller needs a leaking water heater repaired today.', 'Urgent, in-scope service request.', 'gpt-5-mini', 900, 120, 0.000465, $5)`,
        [`${callId}-assessment`, workspace.organization_id, callId, recordingId, at(140)],
      );
      await pool!.query("insert into lead_assessment_evidence (lead_assessment_id, position, turn_index, start_ms, quote) values ($1, 0, 0, 0, 'my water heater is leaking')", [`${callId}-assessment`]);
    }
    if (analysis.reviewed) {
      await pool!.query("insert into lead_review (call_id, organization_id, classification, reviewed_at) values ($1, $2, 'Not Good Lead', $3)", [callId, workspace.organization_id, at(150)]);
    }
  }
  return { callSid, recordingSid, recordingId };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrateDatabase(container.getConnectionUri());
  organizationId = (await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "Example Operator", timezone: "UTC" })).organizationId;
  await pool.query(`insert into organization (id, name, slug, created_at) values ('other-organization-id', 'Other', 'other', now())`);
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, recording_enabled, created_at, updated_at)
     values ('granted-active', $1, 'Acme Plumbing', 'America/Chicago', 'Active', true, now(), now()),
            ('granted-quiet', $1, 'Quiet Dental', 'UTC', 'Active', true, now(), now()),
            ('ungranted-active', $1, 'Gamma HVAC', 'UTC', 'Active', true, now(), now()),
            ('other-organization-workspace', 'other-organization-id', 'Other Org Workspace', 'UTC', 'Active', true, now(), now())`,
    [organizationId],
  );
  operatorCookie = await signIn("operator@example.com");
  const provisioned = await usersHandler()(new Request("http://localhost:3000/api/users", {
    method: "POST",
    headers: { cookie: operatorCookie, "content-type": "application/json" },
    body: JSON.stringify({ email: "client@example.com", role: "Client Viewer", workspaceIds: ["granted-active", "granted-quiet"], sendEmail: false }),
  }));
  expect(provisioned.status).toBe(201);
  clientId = ((await provisioned.json()) as { user: { id: string } }).user.id;
  await pool.query(
    `insert into access_grant (id, organization_id, workspace_id, user_id, created_at)
     values ('cross-organization-grant', 'other-organization-id', 'other-organization-workspace', $1, now())`,
    [clientId],
  );
  clientCookie = await signIn("client@example.com");
}, 120_000);

afterAll(async () => { await pool?.end(); await container?.stop(); });

describe.sequential("Call Detail authorization", () => {
  let seededCall: { callSid: string; recordingSid: string; recordingId: string };

  beforeAll(async () => {
    seededCall = await seedCall("answered-call");
  });

  it("gives an Operator the Call facts with the Twilio call SID", async () => {
    const { response, body } = await callDetail("granted-active", "answered-call", operatorCookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.call).toMatchObject({
      id: "answered-call",
      workspace: { id: "granted-active", name: "Acme Plumbing", reportingTimezone: "America/Chicago" },
      callerNumber: "+13125550142",
      destinationNumber: "+14155550199",
      outcome: "Answered",
      totalDurationSeconds: 95,
      twilioCallSid: seededCall.callSid,
    });
  });

  it("gives a Client Viewer with a current Access Grant the Call facts without the Twilio call SID", async () => {
    const { response, text, body } = await callDetail("granted-active", "answered-call", clientCookie);
    expect(response.status).toBe(200);
    expect(body.call).toMatchObject({ id: "answered-call", outcome: "Answered", destinationNumber: "+14155550199" });
    expect(body.call).not.toHaveProperty("twilioCallSid");
    expect(text).not.toContain(seededCall.callSid);
  });

  it("never reveals Recording SIDs or object keys", async () => {
    for (const cookie of [operatorCookie, clientCookie]) {
      const { text } = await callDetail("granted-active", "answered-call", cookie);
      expect(text).not.toContain(seededCall.recordingSid);
      expect(text).not.toContain(".wav");
      expect(text).not.toContain(".peaks.json");
    }
  });

  it("answers the same Not Found for an ungranted Workspace, another Workspace's path, another Organization, and a missing Call", async () => {
    await seedCall("ungranted-call", { workspaceId: "ungranted-active" });
    await seedCall("other-organization-call", { workspaceId: "other-organization-workspace" });
    const denied = [
      ["ungranted-active", "ungranted-call", clientCookie],
      ["granted-quiet", "answered-call", clientCookie],
      ["granted-quiet", "answered-call", operatorCookie],
      ["granted-active", "ungranted-call", clientCookie],
      ["other-organization-workspace", "other-organization-call", clientCookie],
      ["other-organization-workspace", "other-organization-call", operatorCookie],
      ["granted-active", "missing-call", operatorCookie],
    ] as const;
    for (const [workspaceId, callId, cookie] of denied) {
      const { response, body } = await callDetail(workspaceId, callId, cookie);
      expect(response.status).toBe(404);
      expect(body).toEqual({ error: "not_found" });
    }
  });

  it("rejects an unauthenticated Call Detail request", async () => {
    const { response } = await callDetail("granted-active", "answered-call", "");
    expect(response.status).toBe(401);
  });

  it("answers Not Found to an existing Client Viewer session after its Access Grant is removed", async () => {
    const revokedCookie = await signIn("client@example.com");
    await pool!.query("delete from access_grant where user_id = $1 and workspace_id = 'granted-active'", [clientId]);
    try {
      expect((await callDetail("granted-active", "answered-call", revokedCookie)).response.status).toBe(404);
    } finally {
      await pool!.query(`insert into access_grant (id, organization_id, workspace_id, user_id, created_at) values ('restored-grant', $1, 'granted-active', $2, now())`, [organizationId, clientId]);
    }
  });
});

describe.sequential("Call Detail Recording availability", () => {
  async function recordingOf(callId: string) {
    const { response, body } = await callDetail("granted-active", callId, operatorCookie);
    expect(response.status).toBe(200);
    return body.call?.recording;
  }

  it("marks a Stored Recording with Stored peaks Ready with aligned Caller and Business lanes", async () => {
    const { recordingId } = await seedCall("ready-call");
    expect(await recordingOf("ready-call")).toMatchObject({ state: "Ready", id: recordingId, channels: 2, lanes: ["Caller", "Business"], waveform: true, durationSeconds: 83 });
  });

  it("offers the MP3 download whenever its MP3 is Stored and media is retained, whatever the waveform state", async () => {
    const ready = await seedCall("mp3-ready-call");
    const waveformPending = await seedCall("mp3-waveform-pending-call", { recording: { transferState: "Stored", waveformState: "Pending" } });
    const waveformFailed = await seedCall("mp3-waveform-failed-call", { recording: { transferState: "Stored", waveformState: "Failed" } });
    await seedCall("mp3-pending-call", { recording: { transferState: "Stored", mp3State: "Pending" } });
    await seedCall("mp3-failed-call", { recording: { transferState: "Stored", mp3State: "Failed" } });
    const expiredAt = new Date();
    expiredAt.setUTCMonth(expiredAt.getUTCMonth() - 13);
    await seedCall("mp3-expired-call", { startedAt: expiredAt });
    const mp3Of = async (callId: string) => (await callDetail("granted-active", callId, operatorCookie)).body.call?.mp3RecordingId;
    expect(await mp3Of("mp3-ready-call")).toBe(ready.recordingId);
    expect(await mp3Of("mp3-waveform-pending-call")).toBe(waveformPending.recordingId);
    expect(await recordingOf("mp3-waveform-pending-call")).toEqual({ state: "Processing", stage: "waveform" });
    expect(await mp3Of("mp3-waveform-failed-call")).toBe(waveformFailed.recordingId);
    for (const callId of ["mp3-pending-call", "mp3-failed-call", "mp3-expired-call"]) expect(await mp3Of(callId)).toBeNull();
  });

  it("marks a single-channel Recording Ready with one Mixed lane", async () => {
    await seedCall("mixed-call", { recording: { transferState: "Stored", channels: 1 } });
    expect(await recordingOf("mixed-call")).toMatchObject({ state: "Ready", channels: 1, lanes: ["Mixed"] });
  });

  it("keeps a Stored Recording playable when its waveform failed, without peaks", async () => {
    await seedCall("no-peaks-call", { recording: { transferState: "Stored", waveformState: "Failed" } });
    expect(await recordingOf("no-peaks-call")).toMatchObject({ state: "Ready", waveform: false });
  });

  it("marks a Recording Processing while its transfer or its waveform is Pending", async () => {
    await seedCall("transfer-pending-call", { recording: { transferState: "Pending" } });
    await seedCall("waveform-pending-call", { recording: { transferState: "Stored", waveformState: "Pending" } });
    expect(await recordingOf("transfer-pending-call")).toEqual({ state: "Processing", stage: "transfer" });
    expect(await recordingOf("waveform-pending-call")).toEqual({ state: "Processing", stage: "waveform" });
  });

  it("marks a Recording whose transfer failed Failed without the failure detail", async () => {
    await seedCall("transfer-failed-call", { recording: { transferState: "Failed" } });
    expect(await recordingOf("transfer-failed-call")).toEqual({ state: "Failed" });
  });

  it("explains a Call without a Recording as disabled when the pinned Flow Version did not record, otherwise not captured", async () => {
    await seedCall("unrecorded-call", { graph: unrecordedGraph, recording: null });
    await seedCall("missed-call", { outcome: "Missed", forwarded: true, recording: null });
    expect(await recordingOf("unrecorded-call")).toEqual({ state: "Unavailable", reason: "disabled" });
    expect(await recordingOf("missed-call")).toEqual({ state: "Unavailable", reason: "not_captured" });
  });

  it("marks Recording media Expired 12 months after the Call started while keeping the Call facts", async () => {
    const startedAt = new Date();
    startedAt.setUTCMonth(startedAt.getUTCMonth() - 13);
    const { recordingId } = await seedCall("expired-call", { startedAt });
    const { text, body } = await callDetail("granted-active", "expired-call", operatorCookie);
    expect(body.call).toMatchObject({ id: "expired-call", outcome: "Answered", totalDurationSeconds: 95, recording: { state: "Expired" } });
    expect(text).not.toContain(recordingId);
  });

  it("marks Recording media an Operator purged Purged with its purge time, before Expired, without the MP3 download", async () => {
    const purgedAt = new Date(Date.now() - 60_000);
    const { recordingId } = await seedCall("purged-call");
    const startedAt = new Date();
    startedAt.setUTCMonth(startedAt.getUTCMonth() - 13);
    const expired = await seedCall("purged-expired-call", { startedAt });
    await pool!.query("update recording set media_purged_at = $2 where id = any($1)", [[recordingId, expired.recordingId], purgedAt]);
    for (const callId of ["purged-call", "purged-expired-call"]) {
      const { text, body } = await callDetail("granted-active", callId, operatorCookie);
      expect(body.call).toMatchObject({ id: callId, outcome: "Answered", totalDurationSeconds: 95, mp3RecordingId: null });
      expect(body.call?.recording).toEqual({ state: "Purged", purgedAt: purgedAt.toISOString() });
      expect(text).not.toContain(`${callId}-recording`);
    }
  });

  it("reports when the media of an available Recording expires", async () => {
    await seedCall("retained-call");
    const call = (await callDetail("granted-active", "retained-call", operatorCookie)).body.call as { startedAt: string; recording: { expiresAt: string } };
    const expected = new Date(call.startedAt);
    expected.setUTCMonth(expected.getUTCMonth() + 12);
    expect(new Date(call.recording.expiresAt).getTime()).toBe(expected.getTime());
  });
});

describe.sequential("Call Detail spam gate and processing timeline", () => {
  const gather = (digits: string, attempt: number, secondsAfterStart: number) => ({ kind: "gather", key: `{sid}:gather:gate:${attempt}`, payload: { Digits: digits }, secondsAfterStart });

  it("derives the spam-gate result from the pinned Keypad Gate and the persisted keypad input", async () => {
    await seedCall("gate-passed-call", { events: [gather("1", 1, 5)] });
    await seedCall("gate-blocked-call", { outcome: "Blocked", forwarded: false, events: [gather("9", 1, 5), gather("", 2, 15)], recording: null });
    await seedCall("gate-unused-call", { graph: unrecordedGraph, recording: null });
    await seedCall("gate-not-reached-call", { outcome: "Abandoned", forwarded: false, recording: null });
    const results = await Promise.all(["gate-passed-call", "gate-blocked-call", "gate-unused-call", "gate-not-reached-call"].map(async (callId) => (await callDetail("granted-active", callId, operatorCookie)).body.call?.spamGate));
    expect(results).toEqual(["Passed", "Blocked", "Not used", "Not reached"]);
  });

  it("orders webhook receipt, routing, Recording transfer, and waveform generation into one timeline", async () => {
    await seedCall("timeline-call", {
      events: [
        { kind: "voice", payload: { CallStatus: "ringing" }, secondsAfterStart: 0 },
        gather("1", 1, 5),
        { kind: "forward_status", payload: { CallStatus: "initiated" }, secondsAfterStart: 8 },
        { kind: "forward_status", payload: { CallStatus: "in-progress" }, secondsAfterStart: 12 },
        { kind: "forward_status", payload: { CallStatus: "completed", CallDuration: "78" }, secondsAfterStart: 90 },
        { kind: "recording_status", payload: { RecordingStatus: "completed" }, secondsAfterStart: 93 },
        { kind: "status", payload: { CallStatus: "completed" }, secondsAfterStart: 95 },
      ],
    });
    const { body } = await callDetail("granted-active", "timeline-call", operatorCookie);
    const timeline = body.call?.timeline as { label: string; status: string; at: string }[];
    expect(timeline.map(({ label, status }) => [label, status])).toEqual([
      ["Call received", "Completed"],
      ["Keypad Gate passed", "Completed"],
      ["Forwarded to Destination Number", "Completed"],
      ["Destination answered", "Completed"],
      ["Forward Call completed", "Completed"],
      ["Recording captured", "Completed"],
      ["Call ended", "Completed"],
      ["Recording stored", "Completed"],
      ["Waveform generated", "Completed"],
    ]);
    expect(timeline.map((entry) => entry.at)).toEqual([...timeline.map((entry) => entry.at)].sort());
    expect(body.call?.connectedDurationSeconds).toBe(78);
  });

  it("shows pending and failed Recording stages without their failure detail", async () => {
    await seedCall("timeline-transfer-pending-call", { recording: { transferState: "Pending" } });
    await seedCall("timeline-transfer-failed-call", { recording: { transferState: "Failed" } });
    await seedCall("timeline-waveform-failed-call", { recording: { transferState: "Stored", waveformState: "Failed" } });
    const stages = async (callId: string) => {
      const { text, body } = await callDetail("granted-active", callId, operatorCookie);
      expect(text).not.toContain("status 500");
      expect(text).not.toContain("audiowaveform");
      return (body.call?.timeline as { label: string; status: string }[]).map(({ label, status }) => [label, status]);
    };
    expect(await stages("timeline-transfer-pending-call")).toEqual([["Recording transfer", "Pending"]]);
    expect(await stages("timeline-transfer-failed-call")).toEqual([["Recording transfer failed", "Failed"]]);
    expect(await stages("timeline-waveform-failed-call")).toEqual([["Recording stored", "Completed"], ["Waveform generation failed", "Failed"]]);
  });

  it("adds Media purged at the purge time and drops the stages purged media will never run", async () => {
    const analyzed = await seedCall("timeline-purged-call", { analysis: { transcript: "Completed", leadAssessment: "Completed" } });
    const transferPending = await seedCall("timeline-purged-transfer-call", { recording: { transferState: "Pending" } });
    const waveformPending = await seedCall("timeline-purged-waveform-call", { recording: { transferState: "Stored", waveformState: "Pending" }, analysis: { transcript: "Pending" } });
    const assessmentPending = await seedCall("timeline-purged-assessment-call", { analysis: { transcript: "Completed", leadAssessment: "Pending" } });
    const purgedAt = new Date();
    await pool!.query("update recording set media_purged_at = $2 where id = any($1)", [[analyzed.recordingId, transferPending.recordingId, waveformPending.recordingId, assessmentPending.recordingId], purgedAt]);
    const timeline = async (callId: string) => (await callDetail("granted-active", callId, operatorCookie)).body.call?.timeline as { label: string; status: string; at: string }[];
    const stages = async (callId: string) => (await timeline(callId)).map(({ label, status }) => [label, status]);
    expect(await stages("timeline-purged-call")).toEqual([
      ["Recording stored", "Completed"],
      ["Waveform generated", "Completed"],
      ["Transcript completed", "Completed"],
      ["Lead Assessment completed", "Completed"],
      ["Media purged", "Completed"],
    ]);
    expect((await timeline("timeline-purged-call")).at(-1)?.at).toBe(purgedAt.toISOString());
    expect(await stages("timeline-purged-transfer-call")).toEqual([["Media purged", "Completed"]]);
    expect(await stages("timeline-purged-waveform-call")).toEqual([["Recording stored", "Completed"], ["Media purged", "Completed"]]);
    expect(await stages("timeline-purged-assessment-call")).toEqual([["Recording stored", "Completed"], ["Waveform generated", "Completed"], ["Transcript completed", "Completed"], ["Media purged", "Completed"]]);
  });
});

describe.sequential("Call Detail Transcript and Lead Assessment", () => {
  const analyzed = { transcript: "Completed", leadAssessment: "Completed" } as const;

  it("gives an Operator and a Client Viewer the Completed Transcript turns and Lead Assessment with evidence", async () => {
    await seedCall("analyzed-call", { analysis: analyzed });
    for (const cookie of [operatorCookie, clientCookie]) {
      const { body } = await callDetail("granted-active", "analyzed-call", cookie);
      expect(body.call?.transcript).toEqual({ state: "Completed", turns: transcriptTurns });
      expect(body.call?.leadAssessment).toEqual({
        state: "Completed",
        classification: "Good Lead",
        score: 86,
        summary: "Caller needs a leaking water heater repaired today.",
        rationale: "Urgent, in-scope service request.",
        processedAt: expect.any(String),
        evidence: [{ turnIndex: 0, startMs: 0, quote: "my water heater is leaking" }],
      });
      expect(body.call?.effectiveLeadClassification).toEqual({ classification: "Good Lead", source: "assessment" });
    }
  });

  it("marks pending and skipped Transcripts with an Unavailable Lead Assessment", async () => {
    await seedCall("transcript-pending-call", { analysis: { transcript: "Pending" } });
    await seedCall("transcript-skipped-call", { analysis: { transcript: "Skipped", skipReason: "spam_gate_not_passed" } });
    const pending = (await callDetail("granted-active", "transcript-pending-call", clientCookie)).body.call;
    expect(pending).toMatchObject({ transcript: { state: "Pending" }, leadAssessment: { state: "Unavailable" } });
    const skipped = (await callDetail("granted-active", "transcript-skipped-call", clientCookie)).body.call;
    expect(skipped?.transcript).toEqual({ state: "Skipped", skipReason: "spam_gate_not_passed" });
    expect(skipped?.leadAssessment).toEqual({ state: "Unavailable" });
  });

  it("keeps the Transcript usable while the Lead Assessment is pending", async () => {
    await seedCall("assessment-pending-call", { analysis: { transcript: "Completed", leadAssessment: "Pending" } });
    const call = (await callDetail("granted-active", "assessment-pending-call", clientCookie)).body.call;
    expect(call).toMatchObject({ transcript: { state: "Completed", turns: transcriptTurns }, leadAssessment: { state: "Pending" }, effectiveLeadClassification: null });
  });

  it("gives Operators the secret-free failure reason of a failed Transcript or Lead Assessment and Client Viewers only the Failed state", async () => {
    await seedCall("transcript-failed-call", { analysis: { transcript: "Failed" } });
    await seedCall("assessment-failed-call", { analysis: { transcript: "Completed", leadAssessment: "Failed" } });
    const operatorTranscript = (await callDetail("granted-active", "transcript-failed-call", operatorCookie)).body.call;
    expect(operatorTranscript?.transcript).toEqual({ state: "Failed", failureReason: "OpenAI request failed (HTTP 500)" });
    const operatorAssessment = (await callDetail("granted-active", "assessment-failed-call", operatorCookie)).body.call;
    expect(operatorAssessment?.leadAssessment).toEqual({ state: "Failed", failureReason: "OpenAI response was incomplete" });
    const clientTranscript = await callDetail("granted-active", "transcript-failed-call", clientCookie);
    expect(clientTranscript.body.call?.transcript).toEqual({ state: "Failed" });
    expect(clientTranscript.text).not.toContain("HTTP 500");
    const clientAssessment = await callDetail("granted-active", "assessment-failed-call", clientCookie);
    expect(clientAssessment.body.call?.leadAssessment).toEqual({ state: "Failed" });
    expect(clientAssessment.text).not.toContain("incomplete");
  });

  it("marks a Recording from before analysis and a Call without a Recording as not analyzed", async () => {
    await seedCall("pre-analysis-call");
    await seedCall("unrecorded-analysis-call", { graph: unrecordedGraph, recording: null });
    for (const callId of ["pre-analysis-call", "unrecorded-analysis-call"]) {
      const call = (await callDetail("granted-active", callId, operatorCookie)).body.call;
      expect(call).toMatchObject({ transcript: { state: "Unavailable" }, leadAssessment: { state: "Unavailable" } });
    }
  });

  it("withholds Transcript turns, evidence, and rationale after media expiry while keeping the non-content Lead Assessment", async () => {
    const startedAt = new Date();
    startedAt.setUTCMonth(startedAt.getUTCMonth() - 13);
    await seedCall("expired-analysis-call", { startedAt, analysis: analyzed });
    const { text, body } = await callDetail("granted-active", "expired-analysis-call", clientCookie);
    expect(body.call?.transcript).toEqual({ state: "Expired" });
    expect(body.call?.leadAssessment).toEqual({
      state: "Completed",
      classification: "Good Lead",
      score: 86,
      summary: "Caller needs a leaking water heater repaired today.",
      processedAt: expect.any(String),
    });
    expect(text).not.toContain("my water heater is leaking");
    expect(text).not.toContain("this afternoon");
    expect(text).not.toContain("Urgent, in-scope service request.");
  });

  it("marks the Transcript of purged media Purged and keeps the Lead Assessment summary, classification, score, and Lead Review without rationale or evidence", async () => {
    const { recordingId } = await seedCall("purged-analysis-call", { analysis: { ...analyzed, reviewed: true } });
    await pool!.query("update recording set media_purged_at = now() where id = $1", [recordingId]);
    for (const cookie of [operatorCookie, clientCookie]) {
      const { text, body } = await callDetail("granted-active", "purged-analysis-call", cookie);
      expect(body.call?.transcript).toEqual({ state: "Purged" });
      expect(body.call?.leadAssessment).toEqual({
        state: "Completed",
        classification: "Good Lead",
        score: 86,
        summary: "Caller needs a leaking water heater repaired today.",
        processedAt: expect.any(String),
      });
      expect(body.call?.leadReview).toMatchObject({ classification: "Not Good Lead" });
      expect(body.call?.effectiveLeadClassification).toEqual({ classification: "Not Good Lead", source: "review" });
      expect(text).not.toContain("my water heater is leaking");
      expect(text).not.toContain("Urgent, in-scope service request.");
    }
  });

  it("reads a pending or failed stage of purged media as Purged or Unavailable, since it will never run", async () => {
    const pending = await seedCall("purged-assessment-pending-call", { analysis: { transcript: "Completed", leadAssessment: "Pending" } });
    const failed = await seedCall("purged-transcript-failed-call", { analysis: { transcript: "Failed" } });
    await pool!.query("update recording set media_purged_at = now() where id = any($1)", [[pending.recordingId, failed.recordingId]]);
    expect((await callDetail("granted-active", "purged-assessment-pending-call", operatorCookie)).body.call).toMatchObject({ transcript: { state: "Purged" }, leadAssessment: { state: "Unavailable" } });
    expect((await callDetail("granted-active", "purged-transcript-failed-call", operatorCookie)).body.call).toMatchObject({ transcript: { state: "Purged" }, leadAssessment: { state: "Unavailable" } });
  });

  it("uses the Lead Review over the Lead Assessment for the effective classification", async () => {
    await seedCall("reviewed-analysis-call", { analysis: { ...analyzed, reviewed: true } });
    const call = (await callDetail("granted-active", "reviewed-analysis-call", clientCookie)).body.call;
    expect(call?.effectiveLeadClassification).toEqual({ classification: "Not Good Lead", source: "review" });
  });

  it("adds Transcript, Lead Assessment, and Lead Review stages to the processing timeline in order", async () => {
    await seedCall("analysis-timeline-call", { analysis: { ...analyzed, reviewed: true } });
    const timeline = (await callDetail("granted-active", "analysis-timeline-call", operatorCookie)).body.call?.timeline as { label: string; status: string; at: string }[];
    expect(timeline.map(({ label, status }) => [label, status])).toEqual([
      ["Recording stored", "Completed"],
      ["Waveform generated", "Completed"],
      ["Transcript completed", "Completed"],
      ["Lead Assessment completed", "Completed"],
      ["Lead Review added", "Completed"],
    ]);
    expect(timeline.map((entry) => entry.at)).toEqual([...timeline.map((entry) => entry.at)].sort());
  });

  it("shows pending, skipped, failed, and expired analysis stages without their failure detail", async () => {
    const startedAt = new Date();
    startedAt.setUTCMonth(startedAt.getUTCMonth() - 13);
    await seedCall("expired-timeline-call", { startedAt, analysis: { transcript: "Completed", leadAssessment: "Completed" } });
    const stages = async (callId: string) => {
      const timeline = (await callDetail("granted-active", callId, operatorCookie)).body.call?.timeline as { label: string; status: string }[];
      expect(JSON.stringify(timeline)).not.toMatch(/HTTP 500|incomplete/);
      return timeline.filter(({ label }) => /Transcri|Lead/.test(label)).map(({ label, status }) => [label, status]);
    };
    expect(await stages("transcript-pending-call")).toEqual([["Transcription", "Pending"]]);
    expect(await stages("transcript-skipped-call")).toEqual([["Transcript skipped", "Completed"]]);
    expect(await stages("transcript-failed-call")).toEqual([["Transcription failed", "Failed"]]);
    expect(await stages("assessment-pending-call")).toEqual([["Transcript completed", "Completed"], ["Lead Assessment", "Pending"]]);
    expect(await stages("assessment-failed-call")).toEqual([["Transcript completed", "Completed"], ["Lead Assessment failed", "Failed"]]);
    expect(await stages("expired-timeline-call")).toEqual([["Transcript completed", "Completed"], ["Lead Assessment completed", "Completed"], ["Transcript expired", "Completed"]]);
  });
});

describe.sequential("Call analysis Retry", () => {
  async function retry(workspaceId: string, callId: string, cookie: string) {
    const response = await workspacesHandler()(new Request(`http://localhost:3000/api/workspaces/${workspaceId}/calls/${callId}/analysis/retry`, { method: "POST", headers: { cookie } }));
    const text = await response.text();
    return { response, text, body: JSON.parse(text) as Record<string, unknown> };
  }

  function clearRequests() {
    transcriptionRequests.requests.length = 0;
    leadAssessmentRequests.requests.length = 0;
    transcriptionRequests.failing = false;
    leadAssessmentRequests.failing = false;
  }

  it("requests transcription again for a failed Transcript with its Recording-derived idempotency key", async () => {
    clearRequests();
    const { recordingId } = await seedCall("retry-transcript-call", { analysis: { transcript: "Failed" } });
    const { response, body } = await retry("granted-active", "retry-transcript-call", operatorCookie);
    expect(response.status).toBe(202);
    expect(body).toEqual({ retry: { stage: "transcription" } });
    expect(transcriptionRequests.requests).toEqual([{ id: recordingId, organizationId, idempotencyKey: `recording-transcription:${recordingId}` }]);
    expect(leadAssessmentRequests.requests).toEqual([]);
    const stored = (await pool!.query("select transcript_state from recording where id = $1", [recordingId])).rows[0];
    expect(stored).toEqual({ transcript_state: "Failed" });
  });

  it("requests the Lead Assessment again for a failed Lead Assessment", async () => {
    clearRequests();
    const { recordingId } = await seedCall("retry-assessment-call", { analysis: { transcript: "Completed", leadAssessment: "Failed" } });
    const { response, body } = await retry("granted-active", "retry-assessment-call", operatorCookie);
    expect(response.status).toBe(202);
    expect(body).toEqual({ retry: { stage: "lead_assessment" } });
    expect(leadAssessmentRequests.requests).toEqual([{ id: recordingId, organizationId, idempotencyKey: `recording-lead-assessment:${recordingId}` }]);
    expect(transcriptionRequests.requests).toEqual([]);
  });

  it("answers Conflict when nothing failed or the media expired", async () => {
    clearRequests();
    const expiredStart = new Date();
    expiredStart.setUTCMonth(expiredStart.getUTCMonth() - 13);
    await seedCall("retry-completed-call", { analysis: { transcript: "Completed", leadAssessment: "Completed" } });
    await seedCall("retry-pending-call", { analysis: { transcript: "Pending" } });
    await seedCall("retry-skipped-call", { analysis: { transcript: "Skipped" } });
    await seedCall("retry-unrecorded-call", { graph: unrecordedGraph, recording: null });
    await seedCall("retry-expired-call", { startedAt: expiredStart, analysis: { transcript: "Failed" } });
    for (const callId of ["retry-completed-call", "retry-pending-call", "retry-skipped-call", "retry-unrecorded-call", "retry-expired-call"]) {
      const { response, body } = await retry("granted-active", callId, operatorCookie);
      expect(response.status).toBe(409);
      expect(body).toEqual({ error: "nothing_to_retry" });
    }
    expect(transcriptionRequests.requests).toEqual([]);
    expect(leadAssessmentRequests.requests).toEqual([]);
  });

  it("answers Conflict for a failed stage whose media an Operator purged", async () => {
    clearRequests();
    const transcript = await seedCall("retry-purged-transcript-call", { analysis: { transcript: "Failed" } });
    const assessment = await seedCall("retry-purged-assessment-call", { analysis: { transcript: "Completed", leadAssessment: "Failed" } });
    await pool!.query("update recording set media_purged_at = now() where id = any($1)", [[transcript.recordingId, assessment.recordingId]]);
    for (const callId of ["retry-purged-transcript-call", "retry-purged-assessment-call"]) {
      const { response, body } = await retry("granted-active", callId, operatorCookie);
      expect(response.status).toBe(409);
      expect(body).toEqual({ error: "nothing_to_retry" });
    }
    expect(transcriptionRequests.requests).toEqual([]);
    expect(leadAssessmentRequests.requests).toEqual([]);
  });

  it("refuses a Client Viewer's Retry with the Operator-only refusal and requests nothing", async () => {
    clearRequests();
    const { response, body } = await retry("granted-active", "retry-transcript-call", clientCookie);
    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "forbidden" });
    expect(transcriptionRequests.requests).toEqual([]);
  });

  it("answers the same Not Found as Call Detail for another Workspace's path, another Organization, and a missing Call", async () => {
    clearRequests();
    await seedCall("retry-other-organization-call", { workspaceId: "other-organization-workspace", analysis: { transcript: "Failed" } });
    for (const [workspaceId, callId] of [["granted-quiet", "retry-transcript-call"], ["other-organization-workspace", "retry-other-organization-call"], ["granted-active", "retry-other-organization-call"], ["granted-active", "missing-call"]]) {
      const { response, body } = await retry(workspaceId, callId, operatorCookie);
      expect(response.status).toBe(404);
      expect(body).toEqual({ error: "not_found" });
    }
    expect(transcriptionRequests.requests).toEqual([]);
  });

  it("rejects an unauthenticated Retry", async () => {
    clearRequests();
    const { response } = await retry("granted-active", "retry-transcript-call", "");
    expect(response.status).toBe(401);
    expect(transcriptionRequests.requests).toEqual([]);
  });

  it("answers Bad Gateway without the Trigger.dev secret when the request fails, leaving the Transcript Failed", async () => {
    clearRequests();
    transcriptionRequests.failing = true;
    const { response, text, body } = await retry("granted-active", "retry-transcript-call", operatorCookie);
    expect(response.status).toBe(502);
    expect(body).toEqual({ error: "provider_unavailable" });
    expect(text).not.toContain(triggerSecretKey);
    expect((await pool!.query("select transcript_state from recording where call_id = 'retry-transcript-call'")).rows[0]).toEqual({ transcript_state: "Failed" });
    clearRequests();
  });
});

describe.sequential("Recent Calls", () => {
  it("lists the five newest Calls of a Workspace with Call Outcome, caller, start time, and connected duration", async () => {
    const base = Date.now() - 3_600_000;
    const seededIds: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const callId = `recent-call-${index}`;
      seededIds.push(callId);
      await seedCall(callId, { workspaceId: "granted-quiet", startedAt: new Date(base + index * 60_000), outcome: index === 2 ? "Missed" : "Answered", recording: null });
    }
    for (const cookie of [operatorCookie, clientCookie]) {
      const { response, body } = await recentCalls("granted-quiet", cookie);
      expect(response.status).toBe(200);
      expect(body.calls?.map((call) => call.id)).toEqual(seededIds.slice(1).reverse());
      expect(body.calls?.[3]).toEqual({
        id: "recent-call-2",
        callerNumber: "+13125550142",
        state: "Completed",
        outcome: "Missed",
        startedAt: new Date(base + 2 * 60_000).toISOString(),
        connectedDurationSeconds: 0,
      });
      expect(body.calls?.[0]).toMatchObject({ outcome: "Answered", connectedDurationSeconds: 83 });
    }
  });

  it("lists no Calls for a Workspace without Calls", async () => {
    await pool!.query(`insert into workspace (id, organization_id, name, reporting_timezone, state, created_at, updated_at) values ('empty-active', $1, 'Empty Office', 'UTC', 'Active', now(), now())`, [organizationId]);
    const { response, body } = await recentCalls("empty-active", operatorCookie);
    expect(response.status).toBe(200);
    expect(body).toEqual({ calls: [] });
  });

  it("answers Not Found for Recent Calls of an ungranted or cross-Organization Workspace", async () => {
    expect((await recentCalls("ungranted-active", clientCookie)).response.status).toBe(404);
    expect((await recentCalls("other-organization-workspace", clientCookie)).response.status).toBe(404);
    expect((await recentCalls("other-organization-workspace", operatorCookie)).response.status).toBe(404);
  });
});
