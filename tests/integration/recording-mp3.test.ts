/**
 * -------------------------------------------------------------------------
 * @file   recording-mp3.test.ts
 * @brief  Verifies Recording MP3 derivation into private R2.
 *
 * @description
 *  Runs the Recording MP3 workflow against a real PostgreSQL database with
 *  fake R2 object and MP3 encoder boundaries, and checks the stored MP3
 *  object, the persisted MP3 state and size, idempotent reruns, failure
 *  recording and recovery at the same key, upload verification, and that
 *  Recordings that are not Stored, missing, or past media retention are
 *  left untouched without producing a file.
 *
 * @remarks
 *  The encoder fake stands in for ffmpeg, which exists only in the
 *  deployed Trigger.dev image; tests/contracts/ffmpeg.test.ts covers the
 *  CLI invocation.
 *
 * @see
 *  data/recording-mp3.ts
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
import { FfmpegError, type Mp3Encoder } from "@/data/ffmpeg";
import { migrateDatabase } from "@/data/migrate";
import { R2ObjectError, type RecordingObjects, type StoredObject } from "@/data/r2-objects";
import { generateRecordingMp3, type RecordingMp3Dependencies } from "@/data/recording-mp3";

const now = new Date("2026-10-16T12:00:00.000Z");
const days = (count: number) => new Date(now.getTime() - count * 24 * 60 * 60 * 1000);

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let organizationId = "";

interface FakeR2 extends RecordingObjects {
  objects: Map<string, { bytes: Uint8Array; contentType: string }>;
  gets: string[];
  puts: string[];
  putFailure: Error | null;
  truncatePuts: boolean;
}

interface FakeEncoder extends Mp3Encoder {
  calls: Uint8Array[];
  failure: Error | null;
}

function fakeR2(): FakeR2 {
  const r2: FakeR2 = {
    objects: new Map(),
    gets: [],
    puts: [],
    putFailure: null,
    truncatePuts: false,
    async head(key): Promise<StoredObject | null> {
      const object = r2.objects.get(key);
      return object ? { sizeBytes: object.bytes.byteLength, sha256: createHash("sha256").update(object.bytes).digest("hex") } : null;
    },
    async put(key, body, _object, contentType = "audio/wav") {
      r2.puts.push(key);
      if (r2.putFailure) throw r2.putFailure;
      r2.objects.set(key, { bytes: r2.truncatePuts ? body.slice(1) : body, contentType });
    },
    async get(key) {
      r2.gets.push(key);
      return r2.objects.get(key)?.bytes ?? null;
    },
  };
  return r2;
}

function fakeEncoder(): FakeEncoder {
  const encoder: FakeEncoder = {
    calls: [],
    failure: null,
    async encode(wav) {
      encoder.calls.push(wav);
      if (encoder.failure) throw encoder.failure;
      return new TextEncoder().encode(`ID3 mp3 of ${new TextDecoder().decode(wav)}`);
    },
  };
  return encoder;
}

function dependencies(r2: FakeR2, encoder: FakeEncoder): RecordingMp3Dependencies {
  return { pool: pool!, objects: r2, encoder, now: () => now };
}

let sequence = 0;

async function storedRecording(
  r2: FakeR2,
  options: { channels?: 1 | 2; transfer?: string; callStartedAt?: Date } = {},
): Promise<{ id: string; callId: string; wavKey: string; mp3Key: string; wav: Uint8Array }> {
  sequence += 1;
  const channels = options.channels ?? 2;
  const transfer = options.transfer ?? "Stored";
  const callId = `mp3-call-${sequence}`;
  const id = randomUUID();
  const base = `organizations/${organizationId}/workspaces/mp3-workspace/calls/${callId}/recordings/${id}`;
  const wav = new TextEncoder().encode(`RIFF synthetic recording ${sequence}`);
  const stored = transfer === "Stored";
  await pool!.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, started_at, created_at, updated_at)
     values ($1, $2, 'mp3-workspace', 'mp3-assignment', 'mp3-flow-version', $3, '+14155550113', $4, $4, $4)`,
    [callId, organizationId, `CA${String(sequence).padStart(32, "0")}`, options.callStartedAt ?? days(1)],
  );
  await pool!.query(
    `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, transfer_state, twilio_cleanup_state,
                            r2_object_key, size_bytes, sha256, stored_at, created_at, updated_at)
     values ($1, $2, 'mp3-workspace', $3, $4, $5, $6, 12, $7, $8, $9, $10, $11, $12, $12, $12)`,
    [
      id,
      organizationId,
      callId,
      `RE${String(sequence).padStart(32, "0")}`,
      channels === 2 ? "connected" : "voicemail",
      channels,
      transfer,
      stored ? "Deleted" : "Pending",
      stored ? `${base}.wav` : null,
      stored ? wav.byteLength : null,
      stored ? createHash("sha256").update(wav).digest("hex") : null,
      days(1),
    ],
  );
  if (stored) r2.objects.set(`${base}.wav`, { bytes: wav, contentType: "audio/wav" });
  return { id, callId, wavKey: `${base}.wav`, mp3Key: `${base}.mp3`, wav };
}

async function mp3Row(id: string): Promise<Record<string, unknown>> {
  const result = await pool!.query(
    `select transfer_state, twilio_cleanup_state, channels, duration_seconds, r2_object_key, size_bytes, waveform_state,
            mp3_state, mp3_object_key, mp3_size_bytes, mp3_failure_reason, mp3_generated_at
       from recording where id = $1`,
    [id],
  );
  return result.rows[0];
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrateDatabase(container.getConnectionUri());
  const operator = await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "MP3 Operator", timezone: "UTC" });
  organizationId = operator.organizationId;
  await pool.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ('mp3-number', $1, 'PNffffffffffffffffffffffffffffffff', '+14155550113', 'MP3 Number', true, now(), now(), now(), now())`,
    [organizationId],
  );
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, destination_number, created_at, updated_at)
     values ('mp3-workspace', $1, 'MP3 Workspace', 'UTC', 'Active', '+14155550199', now(), now())`,
    [organizationId],
  );
  await pool.query(
    `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at)
     values ('mp3-assignment', $1, 'mp3-workspace', 'mp3-number', '+14155550113', now(), now())`,
    [organizationId],
  );
  const graph = generateInitialCallFlow({ destinationNumber: "+14155550199", recordingEnabled: true, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });
  await pool.query(
    `insert into flow_version (id, organization_id, workspace_id, version, graph, published_by_user_id, published_at)
     values ('mp3-flow-version', $1, 'mp3-workspace', 1, $2, $3, now())`,
    [organizationId, JSON.stringify(graph), operator.userId],
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe("Recording MP3", () => {
  it("stores an MP3 of a Stored Recording beside its WAV and records it Stored with its size", async () => {
    const r2 = fakeR2();
    const encoder = fakeEncoder();
    const recording = await storedRecording(r2, { channels: 2 });

    await generateRecordingMp3(dependencies(r2, encoder), recording.id);

    const mp3 = new TextEncoder().encode(`ID3 mp3 of ${new TextDecoder().decode(recording.wav)}`);
    expect(encoder.calls).toEqual([recording.wav]);
    expect(r2.objects.get(recording.mp3Key)).toEqual({ bytes: mp3, contentType: "audio/mpeg" });
    expect(await mp3Row(recording.id)).toMatchObject({
      mp3_state: "Stored",
      mp3_object_key: recording.mp3Key,
      mp3_size_bytes: String(mp3.byteLength),
      mp3_generated_at: now,
      mp3_failure_reason: null,
    });
  });

  it("does nothing for a Recording whose MP3 is already Stored with a matching object present", async () => {
    const r2 = fakeR2();
    const encoder = fakeEncoder();
    const recording = await storedRecording(r2);
    await generateRecordingMp3(dependencies(r2, encoder), recording.id);
    const before = await mp3Row(recording.id);

    await generateRecordingMp3(dependencies(r2, encoder), recording.id);

    expect(encoder.calls).toHaveLength(1);
    expect(r2.puts).toEqual([recording.mp3Key]);
    expect(await mp3Row(recording.id)).toEqual(before);
  });

  it("re-encodes a Stored MP3 whose object is missing or no longer matches its recorded size", async () => {
    const r2 = fakeR2();
    const encoder = fakeEncoder();
    const recording = await storedRecording(r2);
    await generateRecordingMp3(dependencies(r2, encoder), recording.id);
    r2.objects.delete(recording.mp3Key);
    await generateRecordingMp3(dependencies(r2, encoder), recording.id);
    r2.objects.set(recording.mp3Key, { bytes: new TextEncoder().encode("partial"), contentType: "audio/mpeg" });

    await generateRecordingMp3(dependencies(r2, encoder), recording.id);

    expect(encoder.calls).toHaveLength(3);
    expect(r2.puts).toEqual([recording.mp3Key, recording.mp3Key, recording.mp3Key]);
    expect(new TextDecoder().decode(r2.objects.get(recording.mp3Key)!.bytes)).toMatch(/^ID3 mp3 of /);
  });

  describe.sequential("when encoding fails", () => {
    const r2 = fakeR2();
    let recording: Awaited<ReturnType<typeof storedRecording>>;

    it("persists the failure as Failed with a stable reason, leaves the transfer and waveform untouched, and rethrows for retry", async () => {
      recording = await storedRecording(r2);
      const encoder = fakeEncoder();
      encoder.failure = new FfmpegError();

      await expect(generateRecordingMp3(dependencies(r2, encoder), recording.id)).rejects.toBe(encoder.failure);

      expect(r2.puts).toEqual([]);
      expect(await mp3Row(recording.id)).toMatchObject({
        transfer_state: "Stored",
        twilio_cleanup_state: "Deleted",
        r2_object_key: recording.wavKey,
        waveform_state: "Pending",
        mp3_state: "Failed",
        mp3_object_key: null,
        mp3_size_bytes: null,
        mp3_failure_reason: "ffmpeg could not encode the MP3",
      });
    });

    it("records an R2 upload failure and then overwrites the same key on retry and clears the failure", async () => {
      const encoder = fakeEncoder();
      r2.putFailure = new R2ObjectError(500);
      await expect(generateRecordingMp3(dependencies(r2, encoder), recording.id)).rejects.toBe(r2.putFailure);
      expect(await mp3Row(recording.id)).toMatchObject({ mp3_state: "Failed", mp3_failure_reason: "R2 request failed (HTTP 500)" });
      r2.putFailure = null;

      await generateRecordingMp3(dependencies(r2, encoder), recording.id);

      expect(r2.puts).toEqual([recording.mp3Key, recording.mp3Key]);
      expect(await mp3Row(recording.id)).toMatchObject({ mp3_state: "Stored", mp3_object_key: recording.mp3Key, mp3_failure_reason: null });
    });
  });

  it("fails without recording Stored when the uploaded MP3 does not match the encoded size", async () => {
    const r2 = fakeR2();
    const encoder = fakeEncoder();
    const recording = await storedRecording(r2);
    r2.truncatePuts = true;

    await expect(generateRecordingMp3(dependencies(r2, encoder), recording.id)).rejects.toThrow("R2 MP3 object does not match the encoded MP3");

    expect(await mp3Row(recording.id)).toMatchObject({ mp3_state: "Failed", mp3_object_key: null, mp3_failure_reason: "R2 MP3 object does not match the encoded MP3" });
  });

  it("fails without encoding when the Recording's WAV is missing from R2", async () => {
    const r2 = fakeR2();
    const encoder = fakeEncoder();
    const recording = await storedRecording(r2);
    r2.objects.delete(recording.wavKey);

    await expect(generateRecordingMp3(dependencies(r2, encoder), recording.id)).rejects.toThrow("Recording object is missing from R2");

    expect(encoder.calls).toEqual([]);
    expect(await mp3Row(recording.id)).toMatchObject({ mp3_state: "Failed", mp3_failure_reason: "Recording object is missing from R2" });
  });

  it("does nothing for a Recording that is not Stored or no longer exists", async () => {
    const r2 = fakeR2();
    const encoder = fakeEncoder();
    const pending = await storedRecording(r2, { transfer: "Pending" });
    const failed = await storedRecording(r2, { transfer: "Failed" });

    await generateRecordingMp3(dependencies(r2, encoder), pending.id);
    await generateRecordingMp3(dependencies(r2, encoder), failed.id);
    await expect(generateRecordingMp3(dependencies(r2, encoder), randomUUID())).resolves.toBeUndefined();

    expect(r2.gets).toEqual([]);
    expect(encoder.calls).toEqual([]);
    expect(await mp3Row(pending.id)).toMatchObject({ mp3_state: "Pending" });
    expect(await mp3Row(failed.id)).toMatchObject({ mp3_state: "Pending" });
  });

  it("refuses a Recording whose media expired 12 months after its Call started without producing a file, keeping its Call and Recording metadata", async () => {
    const r2 = fakeR2();
    const encoder = fakeEncoder();
    const expired = await storedRecording(r2, { callStartedAt: new Date("2025-10-16T11:59:59.000Z") });
    const retained = await storedRecording(r2, { callStartedAt: new Date("2025-10-16T12:00:01.000Z") });
    const before = await mp3Row(expired.id);

    await generateRecordingMp3(dependencies(r2, encoder), expired.id);
    await generateRecordingMp3(dependencies(r2, encoder), retained.id);

    expect(encoder.calls).toEqual([retained.wav]);
    expect(r2.objects.has(expired.mp3Key)).toBe(false);
    expect(await mp3Row(expired.id)).toEqual(before);
    expect(before).toMatchObject({ channels: 2, duration_seconds: 12, mp3_state: "Pending" });
    await expect(pool!.query("select id from call where id = $1", [expired.callId])).resolves.toMatchObject({ rowCount: 1 });
    expect(await mp3Row(retained.id)).toMatchObject({ mp3_state: "Stored" });
  });
});
