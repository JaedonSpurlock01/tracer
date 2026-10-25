/**
 * -------------------------------------------------------------------------
 * @file   media-purge.test.ts
 * @brief  Verifies the Operator Purge Media route.
 *
 * @description
 *  Signs in a real Operator and Client Viewer and purges a Call's media
 *  through the Workspaces server interface, with service queries running
 *  under the least-privilege runtime role against a real PostgreSQL
 *  database. Checks that a purge removes exactly the Transcript, the Lead
 *  Assessment evidence quotes and rationale, and the WAV, waveform peaks,
 *  and MP3, records the purge time, the purging Operator, and a Media
 *  purged Call event, and keeps the Call, the rest of the Lead Assessment,
 *  the Lead Review, and analytics. Also checks the Client Viewer refusal,
 *  the Not Found of siblings, the refusals for a Call with nothing to
 *  purge, a concurrent double purge, and that the media routes and Call
 *  Detail stop serving content the moment the purge commits, even when the
 *  R2 delete failed and the sweep has not run yet.
 *
 * @remarks
 *  Calls and their analysis are seeded directly through the migration role
 *  in the shape their writers persist, because those writers have their own
 *  suites. Private R2 is a fake at the provider boundary that holds objects
 *  by key and can fail a delete.
 *
 * @see
 *  data/media-purge.ts
 *  data/media-retention.ts
 *  data/workspaces-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAnalytics } from "@/data/analytics";
import type { Actor } from "@/data/authorization";
import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { generateInitialCallFlow } from "@/data/call-flow";
import { encryptSecret } from "@/data/credential-encryption";
import { createIntegrations } from "@/data/integrations";
import { sweepRecordingMedia } from "@/data/media-retention";
import { migrateDatabase } from "@/data/migrate";
import { masterKeyFingerprint } from "@/data/provider-credential";
import { createOperatorAdministrationHandler } from "@/data/operator-administration-handler";
import { provisionRuntimeRole, runtimeRole } from "@/data/runtime-role";
import { schema } from "@/data/schema";
import { createTracerAuth } from "@/data/tracer-auth";
import { createTwilioRecordingMedia, type TwilioClient } from "@/data/twilio-client";
import { createWorkspacesHandler } from "@/data/workspaces-handler";
import type { TransactionalEmailMessage } from "@/data/transactional-email";

let container: StartedPostgreSqlContainer | undefined;
let owner: Pool | undefined;
let runtime: Pool | undefined;
let organizationId = "";
let operatorId = "";
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

const database = () => drizzle(owner!, { schema });
const auth = () => createTracerAuth({
  database: database(),
  email,
  emailFrom: "auth@example.com",
  allowedRecipients: recipients,
  backgroundTask: (promise) => backgroundTasks.push(promise),
  secret: "integration-only-secret",
  baseURL: "http://localhost:3000",
});

const r2 = {
  objects: new Map<string, Uint8Array>(),
  deletes: [] as string[],
  failingKeys: new Set<string>(),
  async get(key: string) {
    const bytes = r2.objects.get(key);
    return bytes ? { body: new Blob([bytes as BlobPart]).stream() } : null;
  },
  async delete(key: string) {
    r2.deletes.push(key);
    if (r2.failingKeys.has(key)) throw new Error("R2 request failed (HTTP 503)");
    r2.objects.delete(key);
  },
};

const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

const twilio = {
  deletes: [] as string[],
  statuses: new Map<string, number>(),
  async fetch(input: RequestInfo | URL, init?: RequestInit) {
    const sid = String(input).match(/Recordings\/(RE\w+)\.json$/)![1];
    expect(init?.method).toBe("DELETE");
    twilio.deletes.push(sid);
    return new Response(null, { status: twilio.statuses.get(sid) ?? 204 });
  },
};

const twilioMedia = createTwilioRecordingMedia({ fetch: (input, init) => twilio.fetch(input, init) });

const workspacesHandler = () => createWorkspacesHandler({
  auth: auth(),
  database: database(),
  pool: runtime!,
  twilio: fakeTwilio,
  integrations: (id) => createIntegrations({ pool: owner!, organizationId: id, twilio: fakeTwilio, masterKey: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=" }),
  baseURL: "http://localhost:3000",
  recordingBucket: r2,
  masterKey,
  twilioMedia,
});

const usersHandler = () => createOperatorAdministrationHandler({
  auth: auth(),
  database: database(),
  pool: owner!,
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

async function request(path: string, cookie: string, init: RequestInit = {}) {
  const response = await workspacesHandler()(new Request(`http://localhost:3000/api/workspaces/${path}`, { ...init, headers: { cookie } }));
  const text = await response.text();
  return { response, text };
}

async function purge(workspaceId: string, callId: string, cookie = operatorCookie) {
  const { response, text } = await request(`${workspaceId}/calls/${callId}/media/purge`, cookie, { method: "POST" });
  return { response, body: JSON.parse(text) as Record<string, unknown> };
}

const objectKeys = (callId: string) => [`recordings/${callId}.wav`, `recordings/${callId}.peaks.json`, `recordings/${callId}.mp3`];

let sequence = 0;

async function seedCall(id: string, input: { workspaceId?: string; startedAt?: Date; transferState?: "Pending" | "Stored" | "Failed"; recording?: boolean } = {}): Promise<void> {
  sequence += 1;
  const sid = String(sequence).padStart(32, "0");
  const workspaceId = input.workspaceId ?? "granted";
  const organization = (await owner!.query<{ organization_id: string }>("select organization_id from workspace where id = $1", [workspaceId])).rows[0].organization_id;
  const startedAt = input.startedAt ?? new Date(Date.now() - 86_400_000 - sequence * 7_919);
  const flowId = `${workspaceId}-flow`;
  await owner!.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, caller_number,
                       state, outcome, outcome_reason, started_at, answered_at, ended_at, created_at, updated_at)
     values ($1, $2, $3, $3 || '-assignment', $4, $5, '+14155550101', '+13125550142', 'Completed', 'Answered', 'flow_outcome',
             $6::timestamptz, $6::timestamptz + interval '5 seconds', $6::timestamptz + interval '97 seconds', $6::timestamptz, $6::timestamptz)`,
    [id, organization, workspaceId, flowId, `CA${sid}`, startedAt],
  );
  await owner!.query(
    `insert into call_event (organization_id, workspace_id, call_id, kind, occurred_at, detail, idempotency_key)
     values ($1, $2, $3, 'forwarding_attempted', $4::timestamptz + interval '2 seconds', '{}', 'forwarding_attempted:' || $3)`,
    [organization, workspaceId, id, startedAt],
  );
  if (input.recording === false) return;
  const stored = (input.transferState ?? "Stored") === "Stored";
  const [wav, peaks, mp3] = objectKeys(id);
  await owner!.query(
    `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, transfer_state, twilio_cleanup_state,
                            r2_object_key, size_bytes, sha256, stored_at, waveform_state, waveform_object_key, waveform_generated_at,
                            mp3_state, mp3_object_key, mp3_size_bytes, mp3_generated_at, transcript_state, transcript_audio_ms, transcript_cost_usd,
                            transcript_completed_at, lead_assessment_state, created_at, updated_at)
     values ($1 || '-recording', $2, $3, $1, $4, 'connected', 2, 92, $5, $6, $7, $8, $9, $10, $11, $12, $10, $11, $13, $14, $10,
             $15, $16, $17, $10, $18, $19::timestamptz, $19::timestamptz)`,
    [
      id, organization, workspaceId, `RE${sid}`, input.transferState ?? "Stored", stored ? "Deleted" : "Pending",
      stored ? wav : null, stored ? 6 : null, stored ? "checksum" : null, stored ? new Date(startedAt.getTime() + 120_000) : null,
      stored ? "Stored" : "Pending", stored ? peaks : null, stored ? mp3 : null, stored ? 3 : null,
      stored ? "Completed" : null, stored ? 91_873 : null, stored ? 0.009187 : null, stored ? "Completed" : null, startedAt,
    ],
  );
  if (!stored) return;
  await owner!.query(
    "insert into transcript (recording_id, organization_id, call_id, turns, model, created_at) values ($1 || '-recording', $2, $1, $3, 'whisper-1', now())",
    [id, organization, JSON.stringify([{ speaker: "Caller", startMs: 0, endMs: 2400, text: "Hi, my water heater is leaking." }])],
  );
  await owner!.query(
    `insert into lead_assessment (id, organization_id, call_id, recording_id, classification, score, summary, rationale, model, input_tokens, output_tokens, cost_usd, processed_at)
     values ($1 || '-assessment', $2, $1, $1 || '-recording', 'Good Lead', 83, 'Caller needs a repair.', 'Urgent, in-scope service request.', 'gpt-5-mini', 913, 127, 0.000482, now())`,
    [id, organization],
  );
  await owner!.query("insert into lead_assessment_evidence (lead_assessment_id, position, turn_index, start_ms, quote) values ($1 || '-assessment', 0, 0, 0, 'my water heater is leaking')", [id]);
  await owner!.query("insert into lead_review (call_id, organization_id, classification, note, reviewed_at) values ($1, $2, 'Not Good Lead', 'Existing customer.', now())", [id, organization]);
  r2.objects.set(wav, new Uint8Array([1, 2, 3, 4, 5, 6]));
  r2.objects.set(peaks, new TextEncoder().encode("{}"));
  r2.objects.set(mp3, new Uint8Array([7, 8, 9]));
}

async function mediaState(callId: string) {
  const recordingId = `${callId}-recording`;
  const transcript = await owner!.query("select 1 from transcript where recording_id = $1", [recordingId]);
  const evidence = await owner!.query("select 1 from lead_assessment_evidence where lead_assessment_id = $1", [`${callId}-assessment`]);
  const assessment = await owner!.query("select classification, score, summary, rationale, input_tokens, output_tokens, cost_usd from lead_assessment where recording_id = $1", [recordingId]);
  const recording = await owner!.query(
    `select transfer_state, r2_object_key, waveform_state, waveform_object_key, mp3_state, mp3_object_key, transcript_state, transcript_audio_ms, transcript_cost_usd,
            lead_assessment_state, media_purged_at, media_purged_by_user_id, media_deleted_at
       from recording where id = $1`,
    [recordingId],
  );
  const review = await owner!.query("select classification, note from lead_review where call_id = $1", [callId]);
  const call = await owner!.query("select state, outcome, started_at, ended_at from call where id = $1", [callId]);
  return { transcript: transcript.rowCount ?? 0, evidence: evidence.rowCount ?? 0, assessment: assessment.rows[0], recording: recording.rows[0], review: review.rows[0], call: call.rows[0] };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  await migrateDatabase(container.getConnectionUri());
  owner = new Pool({ connectionString: container.getConnectionUri() });
  const password = "D".repeat(64);
  await provisionRuntimeRole(owner, password);
  const runtimeUrl = new URL(container.getConnectionUri());
  runtimeUrl.username = runtimeRole;
  runtimeUrl.password = password;
  runtime = new Pool({ connectionString: runtimeUrl.toString() });
  ({ organizationId, userId: operatorId } = await bootstrapInitialOperator(owner, { email: "operator@example.com", name: "Example Operator", timezone: "UTC" }));
  await owner.query(
    `insert into twilio_connection (id, organization_id, account_sid, api_key_sid, api_key_secret_ciphertext, connected_by_user_id, connected_at, created_at, updated_at)
     values ('purge-connection', $1, 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'SK11111111111111111111111111111111', $2, $3, now(), now(), now())`,
    [organizationId, await encryptSecret(masterKey, "purge-api-key-secret"), operatorId],
  );
    await owner.query("update twilio_connection set master_key_fingerprint = $1 where master_key_fingerprint is null", [await masterKeyFingerprint(masterKey)]);
  await owner.query(`insert into organization (id, name, slug, created_at) values ('other-organization-id', 'Other', 'other', now())`);
  await owner.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, recording_enabled, analysis_enabled, created_at, updated_at)
     values ('granted', $1, 'Acme Plumbing', 'UTC', 'Active', true, true, now(), now()),
            ('quiet', $1, 'Quiet Dental', 'UTC', 'Active', true, true, now(), now()),
            ('other-organization-workspace', 'other-organization-id', 'Other Org Workspace', 'UTC', 'Active', true, true, now(), now())`,
    [organizationId],
  );
  const graph = generateInitialCallFlow({ destinationNumber: "+14155550199", recordingEnabled: true, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });
  for (const [index, workspace] of [["granted", organizationId], ["quiet", organizationId], ["other-organization-workspace", "other-organization-id"]].entries()) {
    await owner.query(
      `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
       values ($1 || '-number', $2, $3, $4, 'Tracking Number', true, now(), now(), now(), now())`,
      [workspace[0], workspace[1], `PN${String(index + 1).repeat(32)}`, `+1415555010${index + 1}`],
    );
    await owner.query(
      `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at)
       values ($1 || '-assignment', $2, $1, $1 || '-number', $3, now() - interval '2 years', now())`,
      [workspace[0], workspace[1], `+1415555010${index + 1}`],
    );
    await owner.query("insert into flow_version (id, organization_id, workspace_id, version, graph, published_at) values ($1 || '-flow', $2, $1, 1, $3, now())", [workspace[0], workspace[1], JSON.stringify(graph)]);
  }
  operatorCookie = await signIn("operator@example.com");
  const provisioned = await usersHandler()(new Request("http://localhost:3000/api/users", {
    method: "POST",
    headers: { cookie: operatorCookie, "content-type": "application/json" },
    body: JSON.stringify({ email: "client@example.com", role: "Client Viewer", workspaceIds: ["granted"], sendEmail: false }),
  }));
  expect(provisioned.status).toBe(201);
  clientCookie = await signIn("client@example.com");
}, 120_000);

afterAll(async () => {
  await runtime?.end();
  await owner?.end();
  await container?.stop();
});

describe.sequential("Operator Purge Media", () => {
  it("removes exactly the Transcript, evidence quotes, rationale, WAV, peaks, and MP3 and records the purge time, Operator, and a Media purged event", async () => {
    await seedCall("purged-call");
    const before = await mediaState("purged-call");
    const started = Date.now();

    const { response, body } = await purge("granted", "purged-call");

    expect(response.status).toBe(200);
    const purgedAt = (body.purge as { purgedAt: string }).purgedAt;
    expect(body).toEqual({ purge: { purgedAt: expect.any(String) } });
    expect(Date.parse(purgedAt)).toBeGreaterThanOrEqual(started - 1000);
    const after = await mediaState("purged-call");
    expect(after).toEqual({
      ...before,
      transcript: 0,
      evidence: 0,
      assessment: { ...before.assessment, rationale: null },
      recording: { ...before.recording, media_purged_at: new Date(purgedAt), media_purged_by_user_id: operatorId, media_deleted_at: expect.any(Date) },
    });
    expect(objectKeys("purged-call").filter((key) => r2.objects.has(key))).toEqual([]);
    const events = await owner!.query("select kind, occurred_at, actor_user_id, detail from call_event where call_id = 'purged-call' order by occurred_at, id");
    expect(events.rows.map((row) => row.kind)).toEqual(["forwarding_attempted", "media_purged"]);
    expect(events.rows[1]).toEqual({ kind: "media_purged", occurred_at: new Date(purgedAt), actor_user_id: operatorId, detail: {} });
  });

  it("refuses a Client Viewer with the Operator-only refusal and changes nothing", async () => {
    await seedCall("client-call");
    const before = await mediaState("client-call");

    const { response, body } = await purge("granted", "client-call", clientCookie);

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "forbidden" });
    expect(await mediaState("client-call")).toEqual(before);
    expect(objectKeys("client-call").every((key) => r2.objects.has(key))).toBe(true);
  });

  it("answers the same Not Found as Call Detail for another Workspace's path, another Organization, and a missing Call", async () => {
    await seedCall("foreign-call", { workspaceId: "other-organization-workspace" });
    await seedCall("granted-call");
    const foreign = await mediaState("foreign-call");
    const granted = await mediaState("granted-call");
    for (const [workspaceId, callId] of [["quiet", "granted-call"], ["other-organization-workspace", "foreign-call"], ["granted", "foreign-call"], ["granted", "missing-call"]]) {
      const { response, body } = await purge(workspaceId, callId);
      expect(response.status).toBe(404);
      expect(body).toEqual({ error: "not_found" });
    }
    expect(await mediaState("foreign-call")).toEqual(foreign);
    expect(await mediaState("granted-call")).toEqual(granted);
  });

  it("answers Conflict for a Call without a Recording, expired media, and media already purged", async () => {
    const expiredStart = new Date();
    expiredStart.setUTCMonth(expiredStart.getUTCMonth() - 13);
    await seedCall("unrecorded-call", { recording: false });
    await seedCall("expired-call", { startedAt: expiredStart });
    await seedCall("repurged-call");
    expect((await purge("granted", "repurged-call")).response.status).toBe(200);
    const expired = await mediaState("expired-call");
    const repurged = await mediaState("repurged-call");

    expect(await purge("granted", "unrecorded-call")).toMatchObject({ response: { status: 409 }, body: { error: "no_recording" } });
    expect(await purge("granted", "expired-call")).toMatchObject({ response: { status: 409 }, body: { error: "media_expired" } });
    expect(await purge("granted", "repurged-call")).toMatchObject({ response: { status: 409 }, body: { error: "already_purged" } });

    expect(await mediaState("expired-call")).toEqual(expired);
    expect(await mediaState("repurged-call")).toEqual(repurged);
    await expect(owner!.query("select count(*)::int as count from call_event where kind = 'media_purged' and call_id in ('unrecorded-call', 'expired-call', 'repurged-call')")).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it("lets exactly one of two concurrent purges succeed and the other answer already purged", async () => {
    await seedCall("concurrent-call");

    const results = await Promise.all([purge("granted", "concurrent-call"), purge("granted", "concurrent-call")]);

    expect(results.map(({ response }) => response.status).sort()).toEqual([200, 409]);
    expect(results.find(({ response }) => response.status === 409)?.body).toEqual({ error: "already_purged" });
    const purgedAt = (results.find(({ response }) => response.status === 200)?.body.purge as { purgedAt: string }).purgedAt;
    expect(await mediaState("concurrent-call")).toMatchObject({ recording: { media_purged_at: new Date(purgedAt) } });
    await expect(owner!.query("select occurred_at from call_event where kind = 'media_purged' and call_id = 'concurrent-call'")).resolves.toMatchObject({ rows: [{ occurred_at: new Date(purgedAt) }] });
  });

  it("refuses the audio, peaks, and MP3 routes once purged even when the R2 delete failed, and leaves cleanup to the sweep", async () => {
    await seedCall("failing-call");
    const recordingId = "failing-call-recording";
    for (const media of ["audio", "peaks", "mp3"]) expect((await request(`granted/recordings/${recordingId}/${media}`, clientCookie)).response.status).toBe(200);
    const [, peaks] = objectKeys("failing-call");
    r2.failingKeys.add(peaks);

    expect((await purge("granted", "failing-call")).response.status).toBe(200);

    r2.failingKeys.clear();
    expect(r2.objects.has(peaks)).toBe(true);
    expect(await mediaState("failing-call")).toMatchObject({ transcript: 0, evidence: 0, assessment: { rationale: null }, recording: { media_deleted_at: null } });
    for (const cookie of [operatorCookie, clientCookie]) {
      for (const media of ["audio", "peaks", "mp3"]) {
        const { response, text } = await request(`granted/recordings/${recordingId}/${media}`, cookie);
        expect(response.status).toBe(404);
        expect(JSON.parse(text)).toEqual({ error: "not_found" });
      }
    }

    const swept = new Date();
    await expect(sweepRecordingMedia({ pool: runtime!, objects: r2, twilio: twilioMedia, masterKey }, swept)).resolves.toMatchObject({ failed: 0 });
    expect(objectKeys("failing-call").filter((key) => r2.objects.has(key))).toEqual([]);
    expect(await mediaState("failing-call")).toMatchObject({ recording: { media_deleted_at: swept } });
  });

  it("withholds Transcript turns, evidence, and rationale from Call Detail for a purged Recording even if a late writer stored them again", async () => {
    await seedCall("late-writer-call");
    expect((await purge("granted", "late-writer-call")).response.status).toBe(200);
    await owner!.query("delete from lead_assessment where id = 'late-writer-call-assessment'");
    await owner!.query(
      `insert into lead_assessment (id, organization_id, call_id, recording_id, classification, score, summary, rationale, model, input_tokens, output_tokens, cost_usd, processed_at)
       values ('late-writer-call-assessment', $1, 'late-writer-call', 'late-writer-call-recording', 'Good Lead', 83, 'Caller needs a repair.', 'Urgent, in-scope service request.', 'gpt-5-mini', 913, 127, 0.000482, now())`,
      [organizationId],
    );
    await owner!.query("insert into lead_assessment_evidence (lead_assessment_id, position, turn_index, start_ms, quote) values ('late-writer-call-assessment', 0, 0, 0, 'my water heater is leaking')");
    await owner!.query(
      "insert into transcript (recording_id, organization_id, call_id, turns, model, created_at) values ('late-writer-call-recording', $1, 'late-writer-call', $2, 'whisper-1', now())",
      [organizationId, JSON.stringify([{ speaker: "Caller", startMs: 0, endMs: 2400, text: "Hi, my water heater is leaking." }])],
    );

    for (const cookie of [operatorCookie, clientCookie]) {
      const { response, text } = await request("granted/calls/late-writer-call", cookie);
      expect(response.status).toBe(200);
      expect(text).not.toContain("water heater");
      expect(text).not.toContain("Urgent, in-scope");
      expect((JSON.parse(text) as { call: { leadAssessment: unknown } }).call.leadAssessment).toEqual({
        state: "Completed",
        classification: "Good Lead",
        score: 83,
        summary: "Caller needs a repair.",
        processedAt: expect.any(String),
      });
    }
  });

  it("deletes the Twilio copy of a Recording whose transfer is Pending or Failed and finishes its cleanup", async () => {
    await seedCall("pending-transfer-call", { transferState: "Pending" });
    await seedCall("failed-transfer-call", { transferState: "Failed" });
    r2.deletes.length = 0;
    twilio.deletes.length = 0;

    for (const callId of ["pending-transfer-call", "failed-transfer-call"]) {
      const { response, body } = await purge("granted", callId);
      expect(response.status).toBe(200);
      const purgedAt = new Date((body.purge as { purgedAt: string }).purgedAt);
      expect(await mediaState(callId)).toMatchObject({ recording: { media_purged_at: purgedAt, media_purged_by_user_id: operatorId, media_deleted_at: purgedAt } });
      await expect(owner!.query("select twilio_cleanup_state, twilio_deleted_at from recording where call_id = $1", [callId])).resolves.toMatchObject({ rows: [{ twilio_cleanup_state: "Deleted", twilio_deleted_at: purgedAt }] });
      await expect(owner!.query("select kind from call_event where call_id = $1 and kind = 'media_purged'", [callId])).resolves.toMatchObject({ rowCount: 1 });
    }
    const sids = await owner!.query<{ twilio_recording_sid: string }>("select twilio_recording_sid from recording where call_id in ('pending-transfer-call', 'failed-transfer-call') order by call_id desc");
    expect(twilio.deletes).toEqual(sids.rows.map((row) => row.twilio_recording_sid));
    expect(r2.deletes).toEqual([]);
  });

  it("purges when the Twilio delete fails and leaves the Twilio copy to the media retention sweep", async () => {
    await seedCall("twilio-failing-call", { transferState: "Pending" });
    const sid = (await owner!.query<{ twilio_recording_sid: string }>("select twilio_recording_sid from recording where call_id = 'twilio-failing-call'")).rows[0].twilio_recording_sid;
    twilio.statuses.set(sid, 503);

    const { response, body } = await purge("granted", "twilio-failing-call");

    expect(response.status).toBe(200);
    expect(body).toEqual({ purge: { purgedAt: expect.any(String) } });
    await expect(owner!.query("select twilio_cleanup_state, media_purged_at is not null as purged, media_deleted_at from recording where call_id = 'twilio-failing-call'")).resolves.toMatchObject({
      rows: [{ twilio_cleanup_state: "Pending", purged: true, media_deleted_at: null }],
    });

    twilio.statuses.clear();
    const swept = new Date();
    await sweepRecordingMedia({ pool: runtime!, objects: r2, twilio: twilioMedia, masterKey }, swept);
    await expect(owner!.query("select twilio_cleanup_state, twilio_deleted_at, media_deleted_at from recording where call_id = 'twilio-failing-call'")).resolves.toMatchObject({
      rows: [{ twilio_cleanup_state: "Deleted", twilio_deleted_at: swept, media_deleted_at: swept }],
    });
  });

  it("keeps analytics identical after a purge", async () => {
    await seedCall("analytics-call", { workspaceId: "quiet" });
    const operator: Actor = { organizationId, userId: operatorId, role: "Operator", timezone: "UTC", name: "Example Operator", email: "operator@example.com", state: "Active" };
    const analytics = createAnalytics(owner!, operator);
    const workspace = await analytics.summary({ workspaceId: "quiet", range: { kind: "all" } });
    const global = await analytics.summary({ range: { kind: "all" } });
    const stats = await analytics.workspaceListStats(["quiet"]);
    expect(workspace?.kpis.totalCalls.value).toBe(1);

    expect((await purge("quiet", "analytics-call")).response.status).toBe(200);

    expect(await analytics.summary({ workspaceId: "quiet", range: { kind: "all" } })).toEqual(workspace);
    expect(await analytics.summary({ range: { kind: "all" } })).toEqual(global);
    expect(await analytics.workspaceListStats(["quiet"])).toEqual(stats);
  });
});

