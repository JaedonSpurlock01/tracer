/**
 * -------------------------------------------------------------------------
 * @file   recording-transfer.test.ts
 * @brief  Verifies the durable Recording transfer from Twilio to R2.
 *
 * @description
 *  Runs the Recording transfer workflow against a real PostgreSQL database
 *  with fake Twilio media and R2 object boundaries, and checks the stored
 *  object, the persisted transfer and cleanup states, failure recovery, that
 *  the Twilio copy is never deleted before a verified R2 copy is recorded,
 *  that waveform generation is requested once the Recording is Stored
 *  without its failure affecting the transfer or cleanup, and that analysis
 *  eligibility is decided when the Recording is Stored so only an eligible
 *  Recording requests transcription, and that a purged or expired
 *  Recording is never transferred while a purge waiting on a running
 *  transfer deletes the WAV it stored.
 *
 * @remarks
 *  The fakes implement the provider interfaces only. The R2 fake computes
 *  the checksum of the bytes it receives so verification proves the bytes
 *  that reached storage match the Twilio download. Waveform and
 *  transcription requests go to fakes at the Trigger.dev boundary that
 *  record each request.
 *
 * @see
 *  data/recording-transfer.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createHash, randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/data/authorization";
import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { generateInitialCallFlow } from "@/data/call-flow";
import { encryptSecret } from "@/data/credential-encryption";
import { purgeCallMedia } from "@/data/media-purge";
import { migrateDatabase } from "@/data/migrate";
import { masterKeyFingerprint } from "@/data/provider-credential";
import { R2ObjectError, type ArtifactObjects, type RecordingObjects, type StoredObject } from "@/data/r2-objects";
import type { RecordingProcessing, RecordingProcessingRequest } from "@/data/recording";
import { transferRecording, type RecordingTransferDependencies } from "@/data/recording-transfer";
import { TwilioClientError, type TwilioCredential, type TwilioRecordingMedia } from "@/data/twilio-client";

const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const apiKeySecret = "transfer-api-key-secret";
const accountSid = "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const now = new Date("2026-10-16T12:00:00.000Z");

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let organizationId = "";
let operator: Actor | undefined;

interface FakeTwilio extends TwilioRecordingMedia {
  media: Map<string, Uint8Array>;
  downloads: string[];
  deletes: { sid: string; transferState: string }[];
  credentials: TwilioCredential[];
  downloadFailure: Error | null;
  deleteFailure: Error | null;
  downloadGate: Promise<void> | null;
}

interface FakeR2 extends RecordingObjects, Pick<ArtifactObjects, "delete"> {
  objects: Map<string, { bytes: Uint8Array; stored: StoredObject }>;
  puts: string[];
  putFailure: Error | null;
  headOverride: StoredObject | null;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fakeTwilio(): FakeTwilio {
  const twilio: FakeTwilio = {
    media: new Map(),
    downloads: [],
    deletes: [],
    credentials: [],
    downloadFailure: null,
    deleteFailure: null,
    downloadGate: null,
    async downloadRecording(credential, recordingSid) {
      twilio.downloads.push(recordingSid);
      twilio.credentials.push(credential);
      if (twilio.downloadGate) await twilio.downloadGate;
      if (twilio.downloadFailure) throw twilio.downloadFailure;
      return twilio.media.get(recordingSid)!;
    },
    async deleteRecording(_credential, recordingSid) {
      const row = await pool!.query("select transfer_state from recording where twilio_recording_sid = $1", [recordingSid]);
      twilio.deletes.push({ sid: recordingSid, transferState: row.rows[0].transfer_state });
      if (twilio.deleteFailure) throw twilio.deleteFailure;
      twilio.media.delete(recordingSid);
    },
  };
  return twilio;
}

function fakeR2(): FakeR2 {
  const r2: FakeR2 = {
    objects: new Map(),
    puts: [],
    putFailure: null,
    headOverride: null,
    async head(key) {
      return r2.headOverride ?? r2.objects.get(key)?.stored ?? null;
    },
    async put(key, body) {
      r2.puts.push(key);
      if (r2.putFailure) throw r2.putFailure;
      r2.objects.set(key, { bytes: body, stored: { sizeBytes: body.byteLength, sha256: sha256(body) } });
    },
    async get(key) {
      return r2.objects.get(key)?.bytes ?? null;
    },
    async delete(key) {
      r2.objects.delete(key);
    },
  };
  return r2;
}

function fakeWaveform(failure: Error | null = null): RecordingProcessing & { requests: { request: RecordingProcessingRequest; transferState: string }[] } {
  const requests: { request: RecordingProcessingRequest; transferState: string }[] = [];
  return {
    requests,
    async request(request) {
      const row = await pool!.query("select transfer_state from recording where id = $1", [request.id]);
      requests.push({ request, transferState: row.rows[0].transfer_state });
      if (failure) throw failure;
    },
  };
}

function fakeTranscription(failure: Error | null = null): RecordingProcessing & { requests: { request: RecordingProcessingRequest; transcriptState: string | null }[] } {
  const requests: { request: RecordingProcessingRequest; transcriptState: string | null }[] = [];
  return {
    requests,
    async request(request) {
      const row = await pool!.query("select transcript_state from recording where id = $1", [request.id]);
      requests.push({ request, transcriptState: row.rows[0].transcript_state });
      if (failure) throw failure;
    },
  };
}

function dependencies(twilio: FakeTwilio, r2: FakeR2, waveform = fakeWaveform(), transcription = fakeTranscription(), mp3 = fakeWaveform()): RecordingTransferDependencies {
  return { pool: pool!, masterKey, twilio, objects: r2, waveform, transcription, mp3, now: () => now };
}

let sequence = 0;

interface CallSeed {
  workspaceId?: string;
  flowVersionId?: string;
  durationSeconds?: number;
  forwardedSeconds?: number;
  keypadDigits?: string;
}

async function pendingRecording(source: "connected" | "voicemail" = "voicemail", seed: CallSeed = {}): Promise<{ id: string; sid: string; callId: string; bytes: Uint8Array }> {
  sequence += 1;
  const callId = `transfer-call-${sequence}`;
  const id = randomUUID();
  const sid = `RE${String(sequence).padStart(32, "0")}`;
  const callSid = `CA${String(sequence).padStart(32, "0")}`;
  const workspaceId = seed.workspaceId ?? "transfer-workspace";
  await pool!.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, state, outcome, started_at, answered_at, ended_at, created_at, updated_at)
     values ($1, $2, $3, 'transfer-assignment', $4, $5, '+14155550111', $6, $7, now() - interval '5 minutes', $8, $9, now(), now())`,
    [
      callId,
      organizationId,
      workspaceId,
      seed.flowVersionId ?? "transfer-flow-version",
      callSid,
      seed.forwardedSeconds === undefined ? "In Progress" : "Completed",
      seed.forwardedSeconds === undefined ? null : "Answered",
      seed.forwardedSeconds === undefined ? null : new Date(now.getTime() - 4 * 60_000),
      seed.forwardedSeconds === undefined ? null : now,
    ],
  );
  const event = (kind: string, idempotencyKey: string, payload: Record<string, string>) => pool!.query(
    `insert into provider_event (id, organization_id, number_assignment_id, call_id, idempotency_key, kind, disposition, payload, received_at)
     values ($1, $2, 'transfer-assignment', $3, $4, $5, 'accepted', $6, now())`,
    [randomUUID(), organizationId, callId, idempotencyKey, kind, JSON.stringify(payload)],
  );
  if (seed.keypadDigits !== undefined) await event("gather", `${callSid}:gather:gate:1`, { Digits: seed.keypadDigits });
  if (seed.forwardedSeconds !== undefined) await event("forward_status", `${callSid}:forward_status:completed`, { CallStatus: "completed", CallDuration: String(seed.forwardedSeconds) });
  await pool!.query(
    `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())`,
    [id, organizationId, workspaceId, callId, sid, source, source === "connected" ? 2 : 1, seed.durationSeconds ?? 12],
  );
  return { id, sid, callId, bytes: new TextEncoder().encode(`RIFF synthetic ${source} recording ${sequence}`) };
}

async function analysisState(id: string): Promise<{ transcript_state: string | null; transcript_skip_reason: string | null }> {
  const result = await pool!.query("select transcript_state, transcript_skip_reason from recording where id = $1", [id]);
  return result.rows[0];
}

async function recordingRow(id: string): Promise<Record<string, unknown>> {
  const result = await pool!.query(
    `select transfer_state, twilio_cleanup_state, r2_object_key, size_bytes::int as size_bytes, sha256, stored_at, twilio_deleted_at, failure_stage, failure_reason
       from recording where id = $1`,
    [id],
  );
  return result.rows[0];
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrateDatabase(container.getConnectionUri());
  const bootstrapped = await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "Transfer Operator", timezone: "UTC" });
  organizationId = bootstrapped.organizationId;
  operator = { organizationId, userId: bootstrapped.userId, role: "Operator", timezone: "UTC", name: "Transfer Operator", email: "operator@example.com", state: "Active" };
  await pool.query(
    `insert into twilio_connection (id, organization_id, account_sid, api_key_sid, api_key_secret_ciphertext, connected_by_user_id, connected_at, created_at, updated_at)
     values ('transfer-connection', $1, $2, 'SK11111111111111111111111111111111', $3, $4, now(), now(), now())`,
    [organizationId, accountSid, await encryptSecret(masterKey, apiKeySecret), bootstrapped.userId],
  );
  await pool.query("update twilio_connection set master_key_fingerprint = $1 where master_key_fingerprint is null", [await masterKeyFingerprint(masterKey)]);
  await pool.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ('transfer-number', $1, 'PNdddddddddddddddddddddddddddddddd', '+14155550111', 'Transfer Number', true, now(), now(), now(), now())`,
    [organizationId],
  );
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, destination_number, created_at, updated_at)
     values ('transfer-workspace', $1, 'Transfer Workspace', 'UTC', 'Active', '+14155550199', now(), now())`,
    [organizationId],
  );
  await pool.query(
    `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at)
     values ('transfer-assignment', $1, 'transfer-workspace', 'transfer-number', '+14155550111', now(), now())`,
    [organizationId],
  );
  const graph = generateInitialCallFlow({ destinationNumber: "+14155550199", recordingEnabled: false, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });
  await pool.query(
    `insert into flow_version (id, organization_id, workspace_id, version, graph, published_by_user_id, published_at)
     values ('transfer-flow-version', $1, 'transfer-workspace', 1, $2, $3, now())`,
    [organizationId, JSON.stringify(graph), bootstrapped.userId],
  );
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, destination_number, recording_enabled, analysis_enabled, created_at, updated_at)
     values ('analysis-workspace', $1, 'Analysis Workspace', 'UTC', 'Active', '+14155550199', true, true, now(), now())`,
    [organizationId],
  );
  const flow = (spamGateEnabled: boolean) => generateInitialCallFlow({ destinationNumber: "+14155550199", recordingEnabled: true, spamGateEnabled, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });
  await pool.query(
    `insert into flow_version (id, organization_id, workspace_id, version, graph, published_by_user_id, published_at)
     values ('analysis-flow-version', $1, 'analysis-workspace', 1, $2, $4, now()),
            ('analysis-gated-flow-version', $1, 'analysis-workspace', 2, $3, $4, now())`,
    [organizationId, JSON.stringify(flow(false)), JSON.stringify(flow(true)), bootstrapped.userId],
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe("Recording transfer", () => {
  it("stores a Pending Recording in R2 under its deterministic key with the verified size and checksum", async () => {
    const recording = await pendingRecording("connected");
    const twilio = fakeTwilio();
    const r2 = fakeR2();
    twilio.media.set(recording.sid, recording.bytes);

    await transferRecording(dependencies(twilio, r2), recording.id);

    const key = `organizations/${organizationId}/workspaces/transfer-workspace/calls/${recording.callId}/recordings/${recording.id}.wav`;
    expect(twilio.credentials).toEqual([{ accountSid, apiKeySid: "SK11111111111111111111111111111111", apiKeySecret }]);
    expect(r2.objects.get(key)?.bytes).toEqual(recording.bytes);
    expect(await recordingRow(recording.id)).toMatchObject({
      transfer_state: "Stored",
      r2_object_key: key,
      size_bytes: recording.bytes.byteLength,
      sha256: sha256(recording.bytes),
      stored_at: now,
      failure_stage: null,
      failure_reason: null,
    });
  });

  it("deletes the Twilio copy only after the Recording is persisted as Stored, then records the cleanup", async () => {
    const recording = await pendingRecording("voicemail");
    const twilio = fakeTwilio();
    twilio.media.set(recording.sid, recording.bytes);

    await transferRecording(dependencies(twilio, fakeR2()), recording.id);

    expect(twilio.deletes).toEqual([{ sid: recording.sid, transferState: "Stored" }]);
    expect(await recordingRow(recording.id)).toMatchObject({ transfer_state: "Stored", twilio_cleanup_state: "Deleted", twilio_deleted_at: now });
  });

  it("requests waveform generation with its Recording-derived idempotency key once the Recording is Stored", async () => {
    const recording = await pendingRecording("connected");
    const twilio = fakeTwilio();
    const waveform = fakeWaveform();
    twilio.media.set(recording.sid, recording.bytes);

    await transferRecording(dependencies(twilio, fakeR2(), waveform), recording.id);

    expect(waveform.requests).toEqual([{ request: { id: recording.id, organizationId, idempotencyKey: `recording-waveform:${recording.id}` }, transferState: "Stored" }]);
  });

  it("still deletes the Twilio copy when the waveform request fails", async () => {
    const recording = await pendingRecording();
    const twilio = fakeTwilio();
    const waveform = fakeWaveform(new Error("Trigger.dev is unavailable"));
    twilio.media.set(recording.sid, recording.bytes);

    await expect(transferRecording(dependencies(twilio, fakeR2(), waveform), recording.id)).resolves.toBeUndefined();

    expect(waveform.requests).toHaveLength(1);
    expect(twilio.deletes).toEqual([{ sid: recording.sid, transferState: "Stored" }]);
    expect(await recordingRow(recording.id)).toMatchObject({ transfer_state: "Stored", twilio_cleanup_state: "Deleted", failure_stage: null, failure_reason: null });
  });

  it("requests waveform generation even when Twilio cleanup fails", async () => {
    const recording = await pendingRecording();
    const twilio = fakeTwilio();
    const waveform = fakeWaveform();
    twilio.media.set(recording.sid, recording.bytes);
    twilio.deleteFailure = new TwilioClientError("unavailable", null);

    await expect(transferRecording(dependencies(twilio, fakeR2(), waveform), recording.id)).rejects.toBe(twilio.deleteFailure);

    expect(waveform.requests.map(({ request }) => request.id)).toEqual([recording.id]);
  });

  it("does not request waveform generation for a Recording that failed to store", async () => {
    const recording = await pendingRecording();
    const twilio = fakeTwilio();
    const waveform = fakeWaveform();
    twilio.downloadFailure = new TwilioClientError("unavailable", null);

    await expect(transferRecording(dependencies(twilio, fakeR2(), waveform), recording.id)).rejects.toBe(twilio.downloadFailure);

    expect(waveform.requests).toEqual([]);
  });

  it("requests MP3 derivation with its Recording-derived idempotency key once the Recording is Stored, and still cleans up when that request fails", async () => {
    const recording = await pendingRecording("connected");
    const twilio = fakeTwilio();
    const mp3 = fakeWaveform(new Error("Trigger.dev is unavailable"));
    twilio.media.set(recording.sid, recording.bytes);

    await expect(transferRecording(dependencies(twilio, fakeR2(), fakeWaveform(), fakeTranscription(), mp3), recording.id)).resolves.toBeUndefined();

    expect(mp3.requests).toEqual([{ request: { id: recording.id, organizationId, idempotencyKey: `recording-mp3:${recording.id}` }, transferState: "Stored" }]);
    expect(twilio.deletes).toEqual([{ sid: recording.sid, transferState: "Stored" }]);
  });

  it("does not request MP3 derivation for a Recording that failed to store", async () => {
    const recording = await pendingRecording();
    const twilio = fakeTwilio();
    const mp3 = fakeWaveform();
    twilio.downloadFailure = new TwilioClientError("unavailable", null);

    await expect(transferRecording(dependencies(twilio, fakeR2(), fakeWaveform(), fakeTranscription(), mp3), recording.id)).rejects.toBe(twilio.downloadFailure);

    expect(mp3.requests).toEqual([]);
  });

  describe("analysis eligibility at Stored time", () => {
    const analysis = { workspaceId: "analysis-workspace", flowVersionId: "analysis-flow-version" };
    const gated = { workspaceId: "analysis-workspace", flowVersionId: "analysis-gated-flow-version" };

    async function transferWithTranscription(recording: Awaited<ReturnType<typeof pendingRecording>>, transcription = fakeTranscription()) {
      const twilio = fakeTwilio();
      twilio.media.set(recording.sid, recording.bytes);
      await transferRecording(dependencies(twilio, fakeR2(), fakeWaveform(), transcription), recording.id);
      return { transcription, twilio };
    }

    it("skips analysis without requesting transcription when the Workspace has analysis disabled", async () => {
      const recording = await pendingRecording("voicemail", { durationSeconds: 60 });

      const { transcription } = await transferWithTranscription(recording);

      expect(transcription.requests).toEqual([]);
      expect(await analysisState(recording.id)).toEqual({ transcript_state: "Skipped", transcript_skip_reason: "analysis_disabled" });
    });

    it("requests one transcription with its Recording-derived idempotency key for an eligible voicemail after Pending is committed", async () => {
      const recording = await pendingRecording("voicemail", { ...analysis, durationSeconds: 15 });

      const { transcription } = await transferWithTranscription(recording);

      expect(transcription.requests).toEqual([{ request: { id: recording.id, organizationId, idempotencyKey: `recording-transcription:${recording.id}` }, transcriptState: "Pending" }]);
      expect(await analysisState(recording.id)).toEqual({ transcript_state: "Pending", transcript_skip_reason: null });
    });

    it("skips a voicemail shorter than 15 seconds without requesting transcription", async () => {
      const recording = await pendingRecording("voicemail", { ...analysis, durationSeconds: 14 });

      const { transcription } = await transferWithTranscription(recording);

      expect(transcription.requests).toEqual([]);
      expect(await analysisState(recording.id)).toEqual({ transcript_state: "Skipped", transcript_skip_reason: "too_short" });
    });

    it("measures a connected Recording by the forwarded leg's connected duration", async () => {
      const eligible = await pendingRecording("connected", { ...analysis, durationSeconds: 20, forwardedSeconds: 15 });
      const short = await pendingRecording("connected", { ...analysis, durationSeconds: 40, forwardedSeconds: 14 });

      const eligibleRun = await transferWithTranscription(eligible);
      const shortRun = await transferWithTranscription(short);

      expect(eligibleRun.transcription.requests.map(({ request }) => request.idempotencyKey)).toEqual([`recording-transcription:${eligible.id}`]);
      expect(shortRun.transcription.requests).toEqual([]);
      expect(await analysisState(short.id)).toEqual({ transcript_state: "Skipped", transcript_skip_reason: "too_short" });
    });

    it("requests transcription only when the Call passed the pinned Keypad Gate", async () => {
      const passed = await pendingRecording("connected", { ...gated, keypadDigits: "1", forwardedSeconds: 60 });
      const blocked = await pendingRecording("voicemail", { ...gated, keypadDigits: "9", durationSeconds: 60 });

      const passedRun = await transferWithTranscription(passed);
      const blockedRun = await transferWithTranscription(blocked);

      expect(passedRun.transcription.requests).toHaveLength(1);
      expect(blockedRun.transcription.requests).toEqual([]);
      expect(await analysisState(blocked.id)).toEqual({ transcript_state: "Skipped", transcript_skip_reason: "spam_gate_not_passed" });
    });

    it("keeps the eligibility decided at Stored time when analysis is enabled before a cleanup retry", async () => {
      await pool!.query("update workspace set recording_enabled = true where id = 'transfer-workspace'");
      const recording = await pendingRecording("voicemail", { durationSeconds: 60 });
      const twilio = fakeTwilio();
      const r2 = fakeR2();
      twilio.media.set(recording.sid, recording.bytes);
      twilio.deleteFailure = new TwilioClientError("unavailable", null);
      try {
        await expect(transferRecording(dependencies(twilio, r2), recording.id)).rejects.toBe(twilio.deleteFailure);
        await pool!.query("update workspace set analysis_enabled = true where id = 'transfer-workspace'");
        twilio.deleteFailure = null;
        const transcription = fakeTranscription();

        await transferRecording(dependencies(twilio, r2, fakeWaveform(), transcription), recording.id);

        expect(transcription.requests).toEqual([]);
        expect(await analysisState(recording.id)).toEqual({ transcript_state: "Skipped", transcript_skip_reason: "analysis_disabled" });
      } finally {
        await pool!.query("update workspace set analysis_enabled = false, recording_enabled = false where id = 'transfer-workspace'");
      }
    });

    it("never fails the transfer or cleanup when the transcription request fails, leaving the Transcript Pending", async () => {
      const recording = await pendingRecording("voicemail", { ...analysis, durationSeconds: 30 });

      const { transcription, twilio } = await transferWithTranscription(recording, fakeTranscription(new Error("Trigger.dev is unavailable")));

      expect(transcription.requests).toHaveLength(1);
      expect(twilio.deletes).toEqual([{ sid: recording.sid, transferState: "Stored" }]);
      expect(await analysisState(recording.id)).toEqual({ transcript_state: "Pending", transcript_skip_reason: null });
      expect(await recordingRow(recording.id)).toMatchObject({ transfer_state: "Stored", twilio_cleanup_state: "Deleted", failure_stage: null });
    });

    it("re-requests a Pending transcription with the same idempotency key on a cleanup retry", async () => {
      const recording = await pendingRecording("voicemail", { ...analysis, durationSeconds: 30 });
      const twilio = fakeTwilio();
      const r2 = fakeR2();
      const transcription = fakeTranscription();
      twilio.media.set(recording.sid, recording.bytes);
      twilio.deleteFailure = new TwilioClientError("unavailable", null);
      await expect(transferRecording(dependencies(twilio, r2, fakeWaveform(), transcription), recording.id)).rejects.toBe(twilio.deleteFailure);
      twilio.deleteFailure = null;

      await transferRecording(dependencies(twilio, r2, fakeWaveform(), transcription), recording.id);

      expect(transcription.requests.map(({ request }) => request.idempotencyKey)).toEqual([`recording-transcription:${recording.id}`, `recording-transcription:${recording.id}`]);
    });

    it("decides nothing and requests no transcription for a Recording that failed to store", async () => {
      const recording = await pendingRecording("voicemail", { ...analysis, durationSeconds: 30 });
      const twilio = fakeTwilio();
      const transcription = fakeTranscription();
      twilio.downloadFailure = new TwilioClientError("unavailable", null);

      await expect(transferRecording(dependencies(twilio, fakeR2(), fakeWaveform(), transcription), recording.id)).rejects.toBe(twilio.downloadFailure);

      expect(transcription.requests).toEqual([]);
      expect(await analysisState(recording.id)).toEqual({ transcript_state: null, transcript_skip_reason: null });
    });
  });

  it("persists a download failure as Failed with a secret-free reason and rethrows it for retry", async () => {
    const recording = await pendingRecording();
    const twilio = fakeTwilio();
    const r2 = fakeR2();
    twilio.downloadFailure = new TwilioClientError("authentication_failed", 401);

    await expect(transferRecording(dependencies(twilio, r2), recording.id)).rejects.toBe(twilio.downloadFailure);

    expect(await recordingRow(recording.id)).toMatchObject({
      transfer_state: "Failed",
      twilio_cleanup_state: "Pending",
      failure_stage: "download",
      failure_reason: "Twilio rejected the credential (HTTP 401)",
    });
    expect(String((await recordingRow(recording.id)).failure_reason)).not.toContain(apiKeySecret);
    expect(r2.puts).toEqual([]);
    expect(twilio.deletes).toEqual([]);
  });

  it("never deletes the Twilio copy when the R2 upload fails", async () => {
    const recording = await pendingRecording();
    const twilio = fakeTwilio();
    const r2 = fakeR2();
    twilio.media.set(recording.sid, recording.bytes);
    r2.putFailure = new R2ObjectError(500);

    await expect(transferRecording(dependencies(twilio, r2), recording.id)).rejects.toBe(r2.putFailure);

    expect(twilio.deletes).toEqual([]);
    expect(await recordingRow(recording.id)).toMatchObject({ transfer_state: "Failed", twilio_cleanup_state: "Pending", failure_stage: "upload", failure_reason: "R2 request failed (HTTP 500)", r2_object_key: null });
  });

  it("never deletes the Twilio copy when the stored R2 object does not match the download", async () => {
    const recording = await pendingRecording();
    const twilio = fakeTwilio();
    const r2 = fakeR2();
    twilio.media.set(recording.sid, recording.bytes);
    r2.headOverride = { sizeBytes: recording.bytes.byteLength, sha256: "0".repeat(64) };

    await expect(transferRecording(dependencies(twilio, r2), recording.id)).rejects.toThrow("R2 object does not match the Twilio download");

    expect(twilio.deletes).toEqual([]);
    expect(await recordingRow(recording.id)).toMatchObject({ transfer_state: "Failed", twilio_cleanup_state: "Pending", failure_stage: "verify", failure_reason: "R2 object does not match the Twilio download", r2_object_key: null });
  });

  describe.sequential("when the Stored write is lost", () => {
    let recording: Awaited<ReturnType<typeof pendingRecording>>;
    const r2 = fakeR2();

    it("never deletes the Twilio copy when the database rejects the Stored write", async () => {
      recording = await pendingRecording();
      const twilio = fakeTwilio();
      twilio.media.set(recording.sid, recording.bytes);
      await pool!.query(
        `create function reject_stored_recording() returns trigger language plpgsql as $$
         begin raise exception 'injected database failure'; end $$`,
      );
      await pool!.query(
        `create trigger reject_stored_recording before update on recording
           for each row when (new.transfer_state = 'Stored' and new.id = '${recording.id}') execute function reject_stored_recording()`,
      );
      try {
        await expect(transferRecording(dependencies(twilio, r2), recording.id)).rejects.toThrow("injected database failure");
      } finally {
        await pool!.query("drop trigger reject_stored_recording on recording");
        await pool!.query("drop function reject_stored_recording()");
      }

      expect(twilio.deletes).toEqual([]);
      expect(await recordingRow(recording.id)).toMatchObject({ transfer_state: "Failed", twilio_cleanup_state: "Pending", failure_stage: "verify", failure_reason: "Recording verify failed", r2_object_key: null });
    });

    it("reuses the matching object on retry without uploading again and clears the failure", async () => {
      const twilio = fakeTwilio();
      twilio.media.set(recording.sid, recording.bytes);
      const uploadsBefore = r2.puts.length;

      await transferRecording(dependencies(twilio, r2), recording.id);

      expect(r2.puts).toHaveLength(uploadsBefore);
      expect(twilio.deletes).toEqual([{ sid: recording.sid, transferState: "Stored" }]);
      expect(await recordingRow(recording.id)).toMatchObject({ transfer_state: "Stored", twilio_cleanup_state: "Deleted", sha256: sha256(recording.bytes), failure_stage: null, failure_reason: null });
    });
  });

  it("replaces a mismatched object at the same key on retry", async () => {
    const recording = await pendingRecording();
    const twilio = fakeTwilio();
    const r2 = fakeR2();
    twilio.media.set(recording.sid, recording.bytes);
    r2.headOverride = { sizeBytes: 1, sha256: "0".repeat(64) };
    await expect(transferRecording(dependencies(twilio, r2), recording.id)).rejects.toThrow();
    r2.headOverride = null;
    const key = r2.puts[0];
    r2.objects.set(key, { bytes: new Uint8Array([1]), stored: { sizeBytes: 1, sha256: sha256(new Uint8Array([1])) } });

    await transferRecording(dependencies(twilio, r2), recording.id);

    expect(r2.puts).toEqual([key, key]);
    expect(r2.objects.get(key)?.bytes).toEqual(recording.bytes);
    expect(await recordingRow(recording.id)).toMatchObject({ transfer_state: "Stored", r2_object_key: key, failure_stage: null });
  });

  describe.sequential("when Twilio cleanup fails", () => {
    let recording: Awaited<ReturnType<typeof pendingRecording>>;
    const r2 = fakeR2();

    it("keeps the Recording Stored, marks cleanup Failed, and rethrows for retry", async () => {
      recording = await pendingRecording();
      const twilio = fakeTwilio();
      twilio.media.set(recording.sid, recording.bytes);
      twilio.deleteFailure = new TwilioClientError("unavailable", null);

      await expect(transferRecording(dependencies(twilio, r2), recording.id)).rejects.toBe(twilio.deleteFailure);

      expect(await recordingRow(recording.id)).toMatchObject({ transfer_state: "Stored", twilio_cleanup_state: "Failed", failure_stage: "cleanup", failure_reason: "Twilio is unavailable", twilio_deleted_at: null });
    });

    it("retries only the pending cleanup without downloading or uploading again", async () => {
      const twilio = fakeTwilio();
      const uploadsBefore = r2.puts.length;

      await transferRecording(dependencies(twilio, r2), recording.id);

      expect(twilio.downloads).toEqual([]);
      expect(r2.puts).toHaveLength(uploadsBefore);
      expect(twilio.deletes).toEqual([{ sid: recording.sid, transferState: "Stored" }]);
      expect(await recordingRow(recording.id)).toMatchObject({ transfer_state: "Stored", twilio_cleanup_state: "Deleted", twilio_deleted_at: now, failure_stage: null, failure_reason: null });
    });

    it("does nothing for a Recording whose Twilio copy is already deleted", async () => {
      const twilio = fakeTwilio();
      const before = await recordingRow(recording.id);

      await transferRecording(dependencies(twilio, r2), recording.id);

      expect(twilio.downloads).toEqual([]);
      expect(twilio.deletes).toEqual([]);
      expect(await recordingRow(recording.id)).toEqual(before);
    });
  });

  it("does nothing for a Recording that no longer exists", async () => {
    const twilio = fakeTwilio();
    const r2 = fakeR2();

    await expect(transferRecording(dependencies(twilio, r2), randomUUID())).resolves.toBeUndefined();
    expect(twilio.downloads).toEqual([]);
    expect(r2.puts).toEqual([]);
  });

  it("refuses a concurrent duplicate run while another run holds the Recording", async () => {
    const recording = await pendingRecording();
    const twilio = fakeTwilio();
    const r2 = fakeR2();
    twilio.media.set(recording.sid, recording.bytes);
    let release!: () => void;
    twilio.downloadGate = new Promise((resolve) => {
      release = resolve;
    });
    const first = transferRecording(dependencies(twilio, r2), recording.id);
    await expect.poll(() => twilio.downloads.length).toBe(1);

    await expect(transferRecording(dependencies(twilio, r2), recording.id)).rejects.toThrow();
    expect(twilio.downloads).toHaveLength(1);
    release();
    await first;

    expect(r2.puts).toHaveLength(1);
    expect(twilio.deletes).toEqual([{ sid: recording.sid, transferState: "Stored" }]);
    expect(await recordingRow(recording.id)).toMatchObject({ transfer_state: "Stored", twilio_cleanup_state: "Deleted", failure_stage: null });
  });

  it("never downloads or uploads a Pending or Failed transfer whose media an Operator purged or that expired", async () => {
    const twilio = fakeTwilio();
    const r2 = fakeR2();
    const waveform = fakeWaveform();
    const transcription = fakeTranscription();
    const mp3 = fakeWaveform();
    const purgedPending = await pendingRecording();
    const purgedFailed = await pendingRecording();
    const expiredPending = await pendingRecording();
    await pool!.query("update recording set media_purged_at = $2 where id = any($1)", [[purgedPending.id, purgedFailed.id], now]);
    await pool!.query("update recording set transfer_state = 'Failed', failure_stage = 'download', failure_reason = 'Twilio is unavailable' where id = $1", [purgedFailed.id]);
    await pool!.query("update call set started_at = $2::timestamptz - interval '13 months' where id = $1", [expiredPending.callId, now]);
    const records = [purgedPending, purgedFailed, expiredPending];
    for (const recording of records) twilio.media.set(recording.sid, recording.bytes);
    const before = await Promise.all(records.map((recording) => recordingRow(recording.id)));

    for (const recording of records) await expect(transferRecording(dependencies(twilio, r2, waveform, transcription, mp3), recording.id)).resolves.toBeUndefined();

    expect(twilio.downloads).toEqual([]);
    expect(twilio.deletes).toEqual([]);
    expect(r2.puts).toEqual([]);
    expect([waveform.requests, transcription.requests, mp3.requests]).toEqual([[], [], []]);
    expect(await Promise.all(records.map((recording) => recordingRow(recording.id)))).toEqual(before);
  });

  it("leaves no stored WAV behind when an Operator purges while the transfer is storing it", async () => {
    const recording = await pendingRecording();
    const twilio = fakeTwilio();
    const r2 = fakeR2();
    twilio.media.set(recording.sid, recording.bytes);
    let release!: () => void;
    twilio.downloadGate = new Promise((resolve) => {
      release = resolve;
    });
    const transfer = transferRecording(dependencies(twilio, r2), recording.id);
    await expect.poll(() => twilio.downloads.length).toBe(1);
    const purge = purgeCallMedia({ pool: pool!, objects: r2, twilio, masterKey }, operator!, "transfer-workspace", recording.callId, now);
    await expect.poll(async () => (await pool!.query("select 1 from pg_stat_activity where wait_event_type = 'Lock'")).rowCount).toBe(1);

    release();
    await Promise.allSettled([transfer]);

    await expect(purge).resolves.toMatchObject({ purgedAt: now.toISOString() });
    expect(r2.puts).toHaveLength(1);
    expect(r2.objects.size).toBe(0);
    expect(twilio.media.has(recording.sid)).toBe(false);
    await expect(pool!.query("select twilio_cleanup_state, media_deleted_at from recording where id = $1", [recording.id])).resolves.toMatchObject({ rows: [{ twilio_cleanup_state: "Deleted", media_deleted_at: now }] });
  });
});

async function callEvents(callId: string): Promise<{ kind: string; detail: Record<string, unknown> }[]> {
  const result = await pool!.query("select kind, detail from call_event where call_id = $1 order by occurred_at, id", [callId]);
  return result.rows;
}

describe("Recording transfer Call events", () => {
  it("appends Recording transferred and Transcript skipped with its reason once, even when the transfer reruns", async () => {
    const recording = await pendingRecording("voicemail", { durationSeconds: 60 });
    const twilio = fakeTwilio();
    twilio.media.set(recording.sid, recording.bytes);
    const r2 = fakeR2();

    await transferRecording(dependencies(twilio, r2), recording.id);
    await transferRecording(dependencies(twilio, r2), recording.id);

    expect(await callEvents(recording.callId)).toEqual([
      { kind: "recording_transferred", detail: {} },
      { kind: "transcript_skipped", detail: { reason: "analysis_disabled" } },
    ]);
  });

  it("appends no Transcript event when the Transcript becomes Pending", async () => {
    const recording = await pendingRecording("voicemail", { workspaceId: "analysis-workspace", flowVersionId: "analysis-flow-version", durationSeconds: 30 });
    const twilio = fakeTwilio();
    twilio.media.set(recording.sid, recording.bytes);

    await transferRecording(dependencies(twilio, fakeR2()), recording.id);

    expect((await callEvents(recording.callId)).map((event) => event.kind)).toEqual(["recording_transferred"]);
  });

  it("appends one Recording transfer failed for repeated failures, then Recording transferred after a successful retry", async () => {
    const recording = await pendingRecording();
    const twilio = fakeTwilio();
    const r2 = fakeR2();
    twilio.downloadFailure = new TwilioClientError("unavailable", null);

    await expect(transferRecording(dependencies(twilio, r2), recording.id)).rejects.toBe(twilio.downloadFailure);
    await expect(transferRecording(dependencies(twilio, r2), recording.id)).rejects.toBe(twilio.downloadFailure);
    expect(await callEvents(recording.callId)).toEqual([{ kind: "recording_transfer_failed", detail: { stage: "download" } }]);

    twilio.downloadFailure = null;
    twilio.media.set(recording.sid, recording.bytes);
    await transferRecording(dependencies(twilio, r2), recording.id);

    expect((await callEvents(recording.callId)).map((event) => event.kind)).toEqual(["recording_transfer_failed", "recording_transferred", "transcript_skipped"]);
  });

  it("appends no event when only the Twilio cleanup fails", async () => {
    const recording = await pendingRecording();
    const twilio = fakeTwilio();
    twilio.media.set(recording.sid, recording.bytes);
    twilio.deleteFailure = new TwilioClientError("unavailable", null);

    await expect(transferRecording(dependencies(twilio, fakeR2()), recording.id)).rejects.toBe(twilio.deleteFailure);

    expect((await callEvents(recording.callId)).map((event) => event.kind)).toEqual(["recording_transferred", "transcript_skipped"]);
  });
});
