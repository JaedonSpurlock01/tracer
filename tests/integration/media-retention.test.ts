/**
 * -------------------------------------------------------------------------
 * @file   media-retention.test.ts
 * @brief  Verifies the Recording media expiry sweep.
 *
 * @description
 *  Runs the sweep under the least-privilege runtime role against a real
 *  PostgreSQL database and checks that a Recording whose media expired 12
 *  months after its Call started, or whose media an Operator purged, loses
 *  exactly its Transcript, Lead Assessment evidence quotes and rationale,
 *  and its WAV, waveform peaks, and MP3 objects, while the Call, its
 *  events, the Recording metadata, the rest of the Lead Assessment, the
 *  Lead Review, and analytics stay as they were. A repeated sweep is a
 *  no-op, and a failed R2 delete leaves cleanup unfinished, without
 *  restoring content, until a later sweep finishes it.
 *
 * @remarks
 *  Calls and their analysis are seeded directly through the migration role
 *  in the shape their writers persist, because those writers have their own
 *  suites. Instants are non-round. Private R2 is a fake at the provider
 *  boundary that holds objects by key and can fail a delete.
 *
 * @see
 *  data/media-retention.ts
 *  data/recording-media.ts
 *  data/runtime-role.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestPool } from "./test-pool";

import { createAnalytics } from "@/data/analytics";
import type { Actor } from "@/data/authorization";
import { generateInitialCallFlow } from "@/data/call-flow";
import { encryptSecret } from "@/data/credential-encryption";
import { sweepRecordingMedia, type MediaRemovalDeps } from "@/data/media-retention";
import { migrateDatabase } from "@/data/migrate";
import { masterKeyFingerprint } from "@/data/provider-credential";
import type { ArtifactObjects } from "@/data/r2-objects";
import { provisionRuntimeRole, runtimeRole } from "@/data/runtime-role";
import { createTwilioRecordingMedia } from "@/data/twilio-client";

const now = new Date("2026-10-18T09:41:23.417Z");
const expiredStart = "2025-10-18T09:41:22.903Z";
const unexpiredStart = "2025-10-18T09:41:23.921Z";

let container: StartedPostgreSqlContainer | undefined;
let owner: Pool | undefined;
let runtime: Pool | undefined;

interface FakeR2 extends Pick<ArtifactObjects, "delete"> {
  objects: Set<string>;
  deletes: string[];
  failingKeys: Set<string>;
}

function fakeR2(): FakeR2 {
  const r2: FakeR2 = {
    objects: new Set(),
    deletes: [],
    failingKeys: new Set(),
    async delete(key) {
      r2.deletes.push(key);
      if (r2.failingKeys.has(key)) throw new Error("R2 request failed (HTTP 503)");
      r2.objects.delete(key);
    },
  };
  return r2;
}

const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const accountSid = "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

interface FakeTwilio {
  deletes: Array<{ sid: string; authorization: string | null }>;
  statuses: Map<string, number>;
  fetch: typeof fetch;
}

function fakeTwilio(): FakeTwilio {
  const twilio: FakeTwilio = {
    deletes: [],
    statuses: new Map(),
    fetch: async (input, init) => {
      const sid = String(input).match(/Recordings\/(RE\w+)\.json$/)![1];
      expect(init?.method).toBe("DELETE");
      twilio.deletes.push({ sid, authorization: new Headers(init?.headers).get("authorization") });
      return new Response(null, { status: twilio.statuses.get(sid) ?? 204 });
    },
  };
  return twilio;
}

const sweepDeps = (r2: FakeR2, twilio = fakeTwilio()): MediaRemovalDeps => ({ pool: runtime!, objects: r2, twilio: createTwilioRecordingMedia({ fetch: twilio.fetch }), masterKey });

const objectKeys = (callId: string) => [`recordings/${callId}.wav`, `recordings/${callId}.peaks.json`, `recordings/${callId}.mp3`];

let sequence = 0;

async function seedCall(r2: FakeR2, input: { id: string; startedAt: string; purgedAt?: string }): Promise<void> {
  sequence += 1;
  const sid = String(sequence).padStart(32, "0");
  const [wav, peaks, mp3] = objectKeys(input.id);
  await owner!.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, caller_number,
                       state, outcome, outcome_reason, started_at, answered_at, ended_at, created_at, updated_at)
     values ($1, 'fleet', 'north', 'north-assignment', 'north-flow', $2, '+14155550101', '+13125550142', 'Completed', 'Answered', 'flow_outcome',
             $3::timestamptz, $3::timestamptz + interval '5 seconds', $3::timestamptz + interval '97 seconds', $3::timestamptz, $3::timestamptz)`,
    [input.id, `CA${sid}`, input.startedAt],
  );
  await owner!.query(
    `insert into call_event (organization_id, workspace_id, call_id, kind, occurred_at, detail, idempotency_key)
     values ('fleet', 'north', $1, 'forwarding_attempted', $2::timestamptz + interval '2 seconds', '{}', 'forwarding_attempted:' || $1)`,
    [input.id, input.startedAt],
  );
  await owner!.query(
    `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, transfer_state, twilio_cleanup_state,
                            r2_object_key, size_bytes, sha256, stored_at, twilio_deleted_at, waveform_state, waveform_object_key, waveform_generated_at,
                            mp3_state, mp3_object_key, mp3_size_bytes, mp3_generated_at, transcript_state, transcript_audio_ms, transcript_cost_usd,
                            transcript_completed_at, lead_assessment_state, media_purged_at, media_purged_by_user_id, created_at, updated_at)
     values ($1 || '-recording', 'fleet', 'north', $1, $2, 'connected', 2, 92, 'Stored', 'Deleted', $3, 1472044, 'checksum', $5::timestamptz + interval '2 minutes',
             $5::timestamptz + interval '2 minutes', 'Stored', $4, $5::timestamptz + interval '3 minutes', 'Stored', $6, 368011, $5::timestamptz + interval '3 minutes',
             'Completed', 91873, 0.009187, $5::timestamptz + interval '4 minutes', 'Completed', $7::timestamptz, case when $7::timestamptz is not null then 'fleet-operator' end,
             $5::timestamptz + interval '2 minutes', $5::timestamptz + interval '4 minutes')`,
    [input.id, `RE${sid}`, wav, peaks, input.startedAt, mp3, input.purgedAt ?? null],
  );
  await owner!.query(
    `insert into transcript (recording_id, organization_id, call_id, turns, model, created_at)
     values ($1 || '-recording', 'fleet', $1, $2, 'whisper-1', $3::timestamptz + interval '4 minutes')`,
    [input.id, JSON.stringify([{ speaker: "Caller", startMs: 0, endMs: 2400, text: "Hi, I need a quote." }]), input.startedAt],
  );
  await owner!.query(
    `insert into lead_assessment (id, organization_id, call_id, recording_id, classification, score, summary, rationale, model, input_tokens, output_tokens, cost_usd, processed_at)
     values ($1 || '-assessment', 'fleet', $1, $1 || '-recording', 'Good Lead', 83, 'Caller asked for a quote.', 'Clear service need.', 'gpt-5-mini', 913, 127, 0.000482, $2::timestamptz + interval '5 minutes')`,
    [input.id, input.startedAt],
  );
  await owner!.query(
    "insert into lead_assessment_evidence (lead_assessment_id, position, turn_index, start_ms, quote) values ($1 || '-assessment', 0, 0, 0, 'I need a quote.')",
    [input.id],
  );
  await owner!.query(
    "insert into lead_review (call_id, organization_id, classification, note, reviewer_user_id, reviewed_at) values ($1, 'fleet', 'Not Good Lead', 'Existing customer.', 'fleet-operator', $2::timestamptz + interval '1 day')",
    [input.id, input.startedAt],
  );
  for (const key of objectKeys(input.id)) r2.objects.add(key);
}

async function unfinishTwilioCleanup(r2: FakeR2, callId: string, transfer: string, cleanup: string): Promise<void> {
  if (transfer !== "Stored") {
    await owner!.query("delete from transcript where call_id = $1", [callId]);
    await owner!.query("delete from lead_assessment where call_id = $1", [callId]);
    await owner!.query(
      `update recording set transfer_state = $2, failure_stage = case when $2 = 'Failed' then 'download' end, failure_reason = case when $2 = 'Failed' then 'Twilio is unavailable' end,
              r2_object_key = null, size_bytes = null, sha256 = null, stored_at = null, waveform_state = 'Pending', waveform_object_key = null, waveform_generated_at = null,
              mp3_state = 'Pending', mp3_object_key = null, mp3_size_bytes = null, mp3_generated_at = null, transcript_state = null, transcript_audio_ms = null,
              transcript_cost_usd = null, transcript_completed_at = null, lead_assessment_state = null
        where call_id = $1`,
      [callId, transfer],
    );
    for (const key of objectKeys(callId)) r2.objects.delete(key);
  }
  await owner!.query(
    `update recording set twilio_cleanup_state = $2, twilio_deleted_at = null,
            failure_stage = case when $2 = 'Failed' then 'cleanup' else failure_stage end, failure_reason = case when $2 = 'Failed' then 'Twilio request failed (HTTP 503)' else failure_reason end
      where call_id = $1`,
    [callId, cleanup],
  );
}

async function twilioSids(): Promise<Record<string, string>> {
  const rows = (await owner!.query<{ call_id: string; twilio_recording_sid: string }>("select call_id, twilio_recording_sid from recording")).rows;
  return Object.fromEntries(rows.map((row) => [row.call_id, row.twilio_recording_sid]));
}

interface MediaState {
  transcript: number;
  evidence: number;
  assessment: { classification: string; score: number; summary: string; rationale: string | null; input_tokens: number; output_tokens: number; cost_usd: string } | undefined;
  recording: Record<string, unknown> | undefined;
}

async function mediaState(callId: string): Promise<MediaState> {
  const recordingId = `${callId}-recording`;
  const transcript = await owner!.query("select 1 from transcript where recording_id = $1", [recordingId]);
  const evidence = await owner!.query("select 1 from lead_assessment_evidence where lead_assessment_id = $1", [`${callId}-assessment`]);
  const assessment = await owner!.query("select classification, score, summary, rationale, input_tokens, output_tokens, cost_usd from lead_assessment where recording_id = $1", [recordingId]);
  const recording = await owner!.query(
    `select transfer_state, r2_object_key, size_bytes, waveform_state, waveform_object_key, mp3_state, mp3_object_key, mp3_size_bytes,
            transcript_state, transcript_audio_ms, transcript_cost_usd, lead_assessment_state, media_deleted_at
       from recording where id = $1`,
    [recordingId],
  );
  return { transcript: transcript.rowCount ?? 0, evidence: evidence.rowCount ?? 0, assessment: assessment.rows[0], recording: recording.rows[0] };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  await migrateDatabase(container.getConnectionUri());
  owner = createTestPool(container.getConnectionUri());
  const password = "C".repeat(64);
  await provisionRuntimeRole(owner, password);
  const runtimeUrl = new URL(container.getConnectionUri());
  runtimeUrl.username = runtimeRole;
  runtimeUrl.password = password;
  runtime = createTestPool(runtimeUrl.toString());
  await owner.query("insert into organization (id, name, slug, created_at) values ('fleet', 'fleet', 'fleet', now())");
  await owner.query(`insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at) values ('fleet-operator', 'Fleet Operator', 'fleet-operator@example.com', true, 'Active', 'America/Chicago', now(), now())`);
  await owner.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, recording_enabled, analysis_enabled, created_at, updated_at)
     values ('north', 'fleet', 'North Plumbing', 'America/Chicago', 'Active', true, true, now(), now())`,
  );
  await owner.query(
    `insert into twilio_connection (id, organization_id, account_sid, api_key_sid, api_key_secret_ciphertext, connected_by_user_id, connected_at, created_at, updated_at)
     values ('fleet-connection', 'fleet', $1, 'SK11111111111111111111111111111111', $2, 'fleet-operator', now(), now(), now())`,
    [accountSid, await encryptSecret(masterKey, "retention-api-key-secret")],
  );
    await owner.query("update twilio_connection set master_key_fingerprint = $1 where master_key_fingerprint is null", [await masterKeyFingerprint(masterKey)]);
  await owner.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ('north-number', 'fleet', 'PN${"1".repeat(32)}', '+14155550101', 'Tracking Number', true, now(), now(), now(), now())`,
  );
  await owner.query(
    `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at)
     values ('north-assignment', 'fleet', 'north', 'north-number', '+14155550101', '2025-01-06T15:12:07.311Z', now())`,
  );
  const graph = generateInitialCallFlow({ destinationNumber: "+14155550199", recordingEnabled: true, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });
  await owner.query("insert into flow_version (id, organization_id, workspace_id, version, graph, published_at) values ('north-flow', 'fleet', 'north', 1, $1, now())", [JSON.stringify(graph)]);
}, 120_000);

beforeEach(async () => {
  await owner!.query("delete from call");
});

afterAll(async () => {
  await runtime?.end();
  await owner?.end();
  await container?.stop();
});

describe("Recording media expiry sweep", () => {
  it("removes exactly the Transcript, evidence quotes, rationale, WAV, peaks, and MP3 of a Recording 12 months after its Call started", async () => {
    const r2 = fakeR2();
    await seedCall(r2, { id: "expired-call", startedAt: expiredStart });
    const before = await mediaState("expired-call");
    const events = await owner!.query("select kind, occurred_at from call_event where call_id = 'expired-call'");
    const call = await owner!.query("select state, outcome, started_at, ended_at from call where id = 'expired-call'");
    const review = await owner!.query("select * from lead_review where call_id = 'expired-call'");

    const result = await sweepRecordingMedia(sweepDeps(r2), now);

    expect(result).toEqual({ selected: 1, completed: 1, failed: 0 });
    expect([...r2.objects]).toEqual([]);
    expect(r2.deletes.sort()).toEqual(objectKeys("expired-call").sort());
    const after = await mediaState("expired-call");
    expect(after.transcript).toBe(0);
    expect(after.evidence).toBe(0);
    expect(after.assessment).toEqual({ ...before.assessment, rationale: null });
    expect(after.recording).toEqual({ ...before.recording, media_deleted_at: now });
    await expect(owner!.query("select kind, occurred_at from call_event where call_id = 'expired-call'")).resolves.toMatchObject({ rows: events.rows });
    await expect(owner!.query("select state, outcome, started_at, ended_at from call where id = 'expired-call'")).resolves.toMatchObject({ rows: call.rows });
    await expect(owner!.query("select * from lead_review where call_id = 'expired-call'")).resolves.toMatchObject({ rows: review.rows });
  });

  it("leaves a Recording whose media has not expired untouched and cleans up a purged Recording before expiry the same way", async () => {
    const r2 = fakeR2();
    await seedCall(r2, { id: "current-call", startedAt: unexpiredStart });
    await seedCall(r2, { id: "purged-call", startedAt: unexpiredStart, purgedAt: "2026-10-17T22:13:41.077Z" });
    const current = await mediaState("current-call");
    const purged = await mediaState("purged-call");

    await expect(sweepRecordingMedia(sweepDeps(r2), now)).resolves.toEqual({ selected: 1, completed: 1, failed: 0 });

    expect(await mediaState("current-call")).toEqual(current);
    expect([...r2.objects].sort()).toEqual(objectKeys("current-call").sort());
    expect(await mediaState("purged-call")).toEqual({ transcript: 0, evidence: 0, assessment: { ...purged.assessment, rationale: null }, recording: { ...purged.recording, media_deleted_at: now } });
    await expect(owner!.query("select media_purged_at, media_purged_by_user_id from recording where id = 'purged-call-recording'")).resolves.toMatchObject({
      rows: [{ media_purged_at: new Date("2026-10-17T22:13:41.077Z"), media_purged_by_user_id: "fleet-operator" }],
    });
  });

  it("makes a repeated sweep a no-op once a Recording's cleanup finished", async () => {
    const r2 = fakeR2();
    await seedCall(r2, { id: "expired-call", startedAt: expiredStart });
    await sweepRecordingMedia(sweepDeps(r2), now);
    const finished = await mediaState("expired-call");
    r2.deletes.length = 0;

    await expect(sweepRecordingMedia(sweepDeps(r2), new Date(now.getTime() + 86_400_000))).resolves.toEqual({ selected: 0, completed: 0, failed: 0 });

    expect(r2.deletes).toEqual([]);
    expect(await mediaState("expired-call")).toEqual(finished);
  });

  it("leaves cleanup unfinished after a failed R2 delete without restoring content, keeps sweeping the batch, and finishes on the next sweep", async () => {
    const r2 = fakeR2();
    await seedCall(r2, { id: "failing-call", startedAt: "2025-08-03T14:07:51.233Z" });
    await seedCall(r2, { id: "expired-call", startedAt: expiredStart });
    const [, failingPeaks] = objectKeys("failing-call");
    r2.failingKeys.add(failingPeaks);

    await expect(sweepRecordingMedia(sweepDeps(r2), now)).resolves.toEqual({ selected: 2, completed: 1, failed: 1 });

    const partial = await mediaState("failing-call");
    expect(partial).toMatchObject({ transcript: 0, evidence: 0, assessment: { rationale: null }, recording: { media_deleted_at: null } });
    expect(r2.objects.has(failingPeaks)).toBe(true);
    expect(await mediaState("expired-call")).toMatchObject({ recording: { media_deleted_at: now } });

    r2.failingKeys.clear();
    const later = new Date(now.getTime() + 86_400_000);
    await expect(sweepRecordingMedia(sweepDeps(r2), later)).resolves.toEqual({ selected: 1, completed: 1, failed: 0 });

    expect(await mediaState("failing-call")).toEqual({ ...partial, recording: { ...partial.recording, media_deleted_at: later } });
    expect([...r2.objects]).toEqual([]);
  });

  it("deletes the Twilio copy of purged and expired Recordings whose transfer is Pending or Failed or whose Twilio cleanup is unfinished, then finishes their cleanup", async () => {
    const r2 = fakeR2();
    const twilio = fakeTwilio();
    const fixtures = [
      { id: "expired-pending", transfer: "Pending", cleanup: "Pending", purgedAt: undefined },
      { id: "purged-failed", transfer: "Failed", cleanup: "Pending", purgedAt: "2026-10-17T22:13:41.077Z" },
      { id: "expired-cleanup-pending", transfer: "Stored", cleanup: "Pending", purgedAt: undefined },
      { id: "purged-cleanup-failed", transfer: "Stored", cleanup: "Failed", purgedAt: "2026-10-16T05:52:09.331Z" },
    ];
    for (const fixture of fixtures) {
      await seedCall(r2, { id: fixture.id, startedAt: fixture.purgedAt ? unexpiredStart : expiredStart, purgedAt: fixture.purgedAt });
      await unfinishTwilioCleanup(r2, fixture.id, fixture.transfer, fixture.cleanup);
    }
    const sids = await twilioSids();

    await expect(sweepRecordingMedia(sweepDeps(r2, twilio), now)).resolves.toEqual({ selected: 4, completed: 4, failed: 0 });

    expect(twilio.deletes.map(({ sid }) => sid).sort()).toEqual(fixtures.map(({ id }) => sids[id]).sort());
    expect(new Set(twilio.deletes.map(({ authorization }) => authorization))).toEqual(new Set([`Basic ${btoa("SK11111111111111111111111111111111:retention-api-key-secret")}`]));
    await expect(owner!.query("select call_id, transfer_state, twilio_cleanup_state, twilio_deleted_at, failure_stage, media_deleted_at from recording order by call_id")).resolves.toMatchObject({
      rows: [
        { call_id: "expired-cleanup-pending", transfer_state: "Stored", twilio_cleanup_state: "Deleted", twilio_deleted_at: now, failure_stage: null, media_deleted_at: now },
        { call_id: "expired-pending", transfer_state: "Pending", twilio_cleanup_state: "Deleted", twilio_deleted_at: now, failure_stage: null, media_deleted_at: now },
        { call_id: "purged-cleanup-failed", transfer_state: "Stored", twilio_cleanup_state: "Deleted", twilio_deleted_at: now, failure_stage: null, media_deleted_at: now },
        { call_id: "purged-failed", transfer_state: "Failed", twilio_cleanup_state: "Deleted", twilio_deleted_at: now, failure_stage: "download", media_deleted_at: now },
      ],
    });
    expect([...r2.objects]).toEqual([]);
  });

  it("counts a Twilio Recording that is already gone as deleted", async () => {
    const r2 = fakeR2();
    const twilio = fakeTwilio();
    await seedCall(r2, { id: "gone-call", startedAt: expiredStart });
    await unfinishTwilioCleanup(r2, "gone-call", "Failed", "Pending");
    twilio.statuses.set((await twilioSids())["gone-call"], 404);

    await expect(sweepRecordingMedia(sweepDeps(r2, twilio), now)).resolves.toEqual({ selected: 1, completed: 1, failed: 0 });

    await expect(owner!.query("select twilio_cleanup_state, twilio_deleted_at, media_deleted_at from recording")).resolves.toMatchObject({ rows: [{ twilio_cleanup_state: "Deleted", twilio_deleted_at: now, media_deleted_at: now }] });
  });

  it("leaves cleanup unfinished when the Twilio delete fails, keeps sweeping the batch, and retries the delete on the next sweep", async () => {
    const r2 = fakeR2();
    const twilio = fakeTwilio();
    await seedCall(r2, { id: "failing-twilio-call", startedAt: "2025-08-03T14:07:51.233Z" });
    await unfinishTwilioCleanup(r2, "failing-twilio-call", "Pending", "Pending");
    await seedCall(r2, { id: "expired-call", startedAt: expiredStart });
    const sid = (await twilioSids())["failing-twilio-call"];
    twilio.statuses.set(sid, 503);

    await expect(sweepRecordingMedia(sweepDeps(r2, twilio), now)).resolves.toEqual({ selected: 2, completed: 1, failed: 1 });

    await expect(owner!.query("select call_id, twilio_cleanup_state, twilio_deleted_at, media_deleted_at from recording order by call_id")).resolves.toMatchObject({
      rows: [
        { call_id: "expired-call", media_deleted_at: now },
        { call_id: "failing-twilio-call", twilio_cleanup_state: "Pending", twilio_deleted_at: null, media_deleted_at: null },
      ],
    });

    twilio.statuses.clear();
    const later = new Date(now.getTime() + 86_400_000);
    await expect(sweepRecordingMedia(sweepDeps(r2, twilio), later)).resolves.toEqual({ selected: 1, completed: 1, failed: 0 });

    expect(twilio.deletes.map((request) => request.sid)).toEqual([sid, sid]);
    await expect(owner!.query("select twilio_cleanup_state, twilio_deleted_at, media_deleted_at from recording where call_id = 'failing-twilio-call'")).resolves.toMatchObject({
      rows: [{ twilio_cleanup_state: "Deleted", twilio_deleted_at: later, media_deleted_at: later }],
    });
  });

  it("never deletes the Twilio copy of a retained Recording", async () => {
    const r2 = fakeR2();
    const twilio = fakeTwilio();
    await seedCall(r2, { id: "retained-pending", startedAt: unexpiredStart });
    await unfinishTwilioCleanup(r2, "retained-pending", "Pending", "Pending");
    await seedCall(r2, { id: "retained-cleanup-failed", startedAt: unexpiredStart });
    await unfinishTwilioCleanup(r2, "retained-cleanup-failed", "Stored", "Failed");

    await expect(sweepRecordingMedia(sweepDeps(r2, twilio), now)).resolves.toEqual({ selected: 0, completed: 0, failed: 0 });

    expect(twilio.deletes).toEqual([]);
    await expect(owner!.query("select twilio_cleanup_state from recording order by call_id")).resolves.toMatchObject({ rows: [{ twilio_cleanup_state: "Failed" }, { twilio_cleanup_state: "Pending" }] });
  });

  it("cleans up at most 100 Recordings a sweep, oldest first, and the rest on the next sweep", async () => {
    const r2 = fakeR2();
    for (let day = 0; day < 101; day += 1) {
      await seedCall(r2, { id: `batch-call-${String(day).padStart(3, "0")}`, startedAt: new Date(Date.parse("2025-06-02T11:23:17.519Z") + day * 3_600_000).toISOString() });
    }

    await expect(sweepRecordingMedia(sweepDeps(r2), now)).resolves.toEqual({ selected: 100, completed: 100, failed: 0 });
    await expect(owner!.query("select call_id from recording where media_deleted_at is null")).resolves.toMatchObject({ rows: [{ call_id: "batch-call-100" }] });
    await expect(sweepRecordingMedia(sweepDeps(r2), now)).resolves.toEqual({ selected: 1, completed: 1, failed: 0 });
  }, 60_000);

  it("keeps analytics identical after an expired Call's content is removed", async () => {
    const r2 = fakeR2();
    await seedCall(r2, { id: "expired-call", startedAt: expiredStart });
    await seedCall(r2, { id: "current-call", startedAt: unexpiredStart });
    const operator: Actor = { organizationId: "fleet", userId: "fleet-operator", role: "Operator", timezone: "America/Chicago", name: "Fleet Operator", email: "fleet-operator@example.com", state: "Active" };
    const analytics = createAnalytics(owner!, operator, { now: () => now });
    const workspace = await analytics.summary({ workspaceId: "north", range: { kind: "all" } });
    const global = await analytics.summary({ range: { kind: "all" } });
    const stats = await analytics.workspaceListStats(["north"]);
    expect(workspace?.kpis.totalCalls.value).toBe(2);

    await expect(sweepRecordingMedia(sweepDeps(r2), now)).resolves.toMatchObject({ completed: 1 });

    expect(await analytics.summary({ workspaceId: "north", range: { kind: "all" } })).toEqual(workspace);
    expect(await analytics.summary({ range: { kind: "all" } })).toEqual(global);
    expect(await analytics.workspaceListStats(["north"])).toEqual(stats);
  });
});
