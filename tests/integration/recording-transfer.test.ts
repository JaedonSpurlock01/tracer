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
 *  and that waveform generation is requested once the Recording is Stored
 *  without its failure affecting the transfer or cleanup.
 *
 * @remarks
 *  The fakes implement the provider interfaces only. The R2 fake computes
 *  the checksum of the bytes it receives so verification proves the bytes
 *  that reached storage match the Twilio download. Waveform requests go to
 *  a fake at the Trigger.dev boundary that records each request.
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

import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { generateInitialCallFlow } from "@/data/call-flow";
import { encryptSecret } from "@/data/credential-encryption";
import { migrateDatabase } from "@/data/migrate";
import { R2ObjectError, type RecordingObjects, type StoredObject } from "@/data/r2-objects";
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

interface FakeTwilio extends TwilioRecordingMedia {
  media: Map<string, Uint8Array>;
  downloads: string[];
  deletes: { sid: string; transferState: string }[];
  credentials: TwilioCredential[];
  downloadFailure: Error | null;
  deleteFailure: Error | null;
  downloadGate: Promise<void> | null;
}

interface FakeR2 extends RecordingObjects {
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

function dependencies(twilio: FakeTwilio, r2: FakeR2, waveform = fakeWaveform()): RecordingTransferDependencies {
  return { pool: pool!, masterKey, twilio, objects: r2, waveform, now: () => now };
}

let sequence = 0;

async function pendingRecording(source: "connected" | "voicemail" = "voicemail"): Promise<{ id: string; sid: string; callId: string; bytes: Uint8Array }> {
  sequence += 1;
  const callId = `transfer-call-${sequence}`;
  const id = randomUUID();
  const sid = `RE${String(sequence).padStart(32, "0")}`;
  await pool!.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, started_at, created_at, updated_at)
     values ($1, $2, 'transfer-workspace', 'transfer-assignment', 'transfer-flow-version', $3, '+14155550111', now(), now(), now())`,
    [callId, organizationId, `CA${String(sequence).padStart(32, "0")}`],
  );
  await pool!.query(
    `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, created_at, updated_at)
     values ($1, $2, 'transfer-workspace', $3, $4, $5, $6, 12, now(), now())`,
    [id, organizationId, callId, sid, source, source === "connected" ? 2 : 1],
  );
  return { id, sid, callId, bytes: new TextEncoder().encode(`RIFF synthetic ${source} recording ${sequence}`) };
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
  const operator = await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "Transfer Operator", timezone: "UTC" });
  organizationId = operator.organizationId;
  await pool.query(
    `insert into twilio_connection (id, organization_id, account_sid, api_key_sid, api_key_secret_ciphertext, connected_by_user_id, connected_at, created_at, updated_at)
     values ('transfer-connection', $1, $2, 'SK11111111111111111111111111111111', $3, $4, now(), now(), now())`,
    [organizationId, accountSid, await encryptSecret(masterKey, apiKeySecret), operator.userId],
  );
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
    [organizationId, JSON.stringify(graph), operator.userId],
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
});
