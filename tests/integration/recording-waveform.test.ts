/**
 * -------------------------------------------------------------------------
 * @file   recording-waveform.test.ts
 * @brief  Verifies Recording waveform generation into private R2.
 *
 * @description
 *  Runs the Recording waveform workflow against a real PostgreSQL database
 *  with fake R2 object and peak generator boundaries, and checks the stored
 *  peaks object and its lanes, the persisted waveform state, idempotent
 *  reruns, failure recovery at the same key, and that Recordings that are
 *  not Stored, missing, past media retention, or purged are left untouched,
 *  and that a purge committing during generation leaves no peaks behind.
 *
 * @remarks
 *  The peak generator fake returns audiowaveform fixture output, because
 *  the audiowaveform CLI exists only in the deployed Trigger.dev image.
 *
 * @see
 *  data/recording-waveform.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createHash, randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestPool } from "./test-pool";

import { AudiowaveformError, type AudiowaveformData, type WaveformPeakGenerator } from "@/data/audiowaveform";
import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { generateInitialCallFlow } from "@/data/call-flow";
import { migrateDatabase } from "@/data/migrate";
import { R2ObjectError, type ArtifactObjects, type RecordingObjects, type StoredObject } from "@/data/r2-objects";
import { generateRecordingWaveform, normalizeWaveformPeaks, type RecordingWaveformDependencies } from "@/data/recording-waveform";

import mixed from "../contracts/fixtures/audiowaveform/mixed.json";
import splitChannels from "../contracts/fixtures/audiowaveform/split-channels.json";

const now = new Date("2026-10-16T12:00:00.000Z");
const days = (count: number) => new Date(now.getTime() - count * 24 * 60 * 60 * 1000);

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let organizationId = "";

interface FakeR2 extends RecordingObjects, Pick<ArtifactObjects, "delete"> {
  objects: Map<string, { bytes: Uint8Array; contentType: string }>;
  gets: string[];
  puts: string[];
  deletes: string[];
  putFailure: Error | null;
  beforeGet: (() => Promise<void>) | null;
}

interface FakePeaks extends WaveformPeakGenerator {
  calls: { wav: Uint8Array; splitChannels: boolean }[];
  failure: Error | null;
  during: (() => Promise<void>) | null;
}

function fakeR2(): FakeR2 {
  const r2: FakeR2 = {
    objects: new Map(),
    gets: [],
    puts: [],
    deletes: [],
    putFailure: null,
    beforeGet: null,
    async head(key): Promise<StoredObject | null> {
      const object = r2.objects.get(key);
      return object ? { sizeBytes: object.bytes.byteLength, sha256: createHash("sha256").update(object.bytes).digest("hex") } : null;
    },
    async put(key, body, _object, contentType = "audio/wav") {
      r2.puts.push(key);
      if (r2.putFailure) throw r2.putFailure;
      r2.objects.set(key, { bytes: body, contentType });
    },
    async get(key) {
      r2.gets.push(key);
      await r2.beforeGet?.();
      return r2.objects.get(key)?.bytes ?? null;
    },
    async delete(key) {
      r2.deletes.push(key);
      r2.objects.delete(key);
    },
  };
  return r2;
}

function fakePeaks(): FakePeaks {
  const peaks: FakePeaks = {
    calls: [],
    failure: null,
    during: null,
    async generate(wav, options) {
      peaks.calls.push({ wav, splitChannels: options.splitChannels });
      await peaks.during?.();
      if (peaks.failure) throw peaks.failure;
      return (options.splitChannels ? splitChannels : mixed) as AudiowaveformData;
    },
  };
  return peaks;
}

function dependencies(r2: FakeR2, peaks: FakePeaks): RecordingWaveformDependencies {
  return { pool: pool!, objects: r2, peaks, now: () => now };
}

let sequence = 0;

async function storedRecording(
  r2: FakeR2,
  options: { channels?: 1 | 2; transfer?: string; callStartedAt?: Date; purgedAt?: Date } = {},
): Promise<{ id: string; callId: string; wavKey: string; peaksKey: string; wav: Uint8Array }> {
  sequence += 1;
  const channels = options.channels ?? 2;
  const transfer = options.transfer ?? "Stored";
  const callId = `waveform-call-${sequence}`;
  const id = randomUUID();
  const base = `organizations/${organizationId}/workspaces/waveform-workspace/calls/${callId}/recordings/${id}`;
  const wav = new TextEncoder().encode(`RIFF synthetic recording ${sequence}`);
  const stored = transfer === "Stored";
  await pool!.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, started_at, created_at, updated_at)
     values ($1, $2, 'waveform-workspace', 'waveform-assignment', 'waveform-flow-version', $3, '+14155550113', $4, $4, $4)`,
    [callId, organizationId, `CA${String(sequence).padStart(32, "0")}`, options.callStartedAt ?? days(1)],
  );
  await pool!.query(
    `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, transfer_state, twilio_cleanup_state,
                            r2_object_key, size_bytes, sha256, stored_at, created_at, updated_at)
     values ($1, $2, 'waveform-workspace', $3, $4, $5, $6, 12, $7, $8, $9, $10, $11, $12, $12, $12)`,
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
  if (options.purgedAt) await purge(id, options.purgedAt);
  if (stored) r2.objects.set(`${base}.wav`, { bytes: wav, contentType: "audio/wav" });
  return { id, callId, wavKey: `${base}.wav`, peaksKey: `${base}.peaks.json`, wav };
}

async function purge(id: string, at: Date): Promise<void> {
  await pool!.query("update recording set media_purged_at = $2 where id = $1", [id, at]);
}

async function waveformRow(id: string): Promise<Record<string, unknown>> {
  const result = await pool!.query(
    `select transfer_state, twilio_cleanup_state, channels, duration_seconds, r2_object_key, waveform_state, waveform_object_key, waveform_failure_reason, waveform_generated_at
       from recording where id = $1`,
    [id],
  );
  return result.rows[0];
}

function storedPeaks(r2: FakeR2, key: string): unknown {
  return JSON.parse(new TextDecoder().decode(r2.objects.get(key)!.bytes));
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = createTestPool(container.getConnectionUri());
  await migrateDatabase(container.getConnectionUri());
  const operator = await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "Waveform Operator", timezone: "UTC" });
  organizationId = operator.organizationId;
  await pool.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ('waveform-number', $1, 'PNffffffffffffffffffffffffffffffff', '+14155550113', 'Waveform Number', true, now(), now(), now(), now())`,
    [organizationId],
  );
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, destination_number, created_at, updated_at)
     values ('waveform-workspace', $1, 'Waveform Workspace', 'UTC', 'Active', '+14155550199', now(), now())`,
    [organizationId],
  );
  await pool.query(
    `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at)
     values ('waveform-assignment', $1, 'waveform-workspace', 'waveform-number', '+14155550113', now(), now())`,
    [organizationId],
  );
  const graph = generateInitialCallFlow({ destinationNumber: "+14155550199", recordingEnabled: true, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });
  await pool.query(
    `insert into flow_version (id, organization_id, workspace_id, version, graph, published_by_user_id, published_at)
     values ('waveform-flow-version', $1, 'waveform-workspace', 1, $2, $3, now())`,
    [organizationId, JSON.stringify(graph), operator.userId],
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe("Recording waveform", () => {
  it("stores Caller and Business peak lanes for a Stored dual-channel Recording beside its WAV", async () => {
    const r2 = fakeR2();
    const peaks = fakePeaks();
    const recording = await storedRecording(r2, { channels: 2 });

    await generateRecordingWaveform(dependencies(r2, peaks), recording.id);

    expect(peaks.calls).toEqual([{ wav: recording.wav, splitChannels: true }]);
    expect(r2.objects.get(recording.peaksKey)?.contentType).toBe("application/json");
    expect(storedPeaks(r2, recording.peaksKey)).toEqual(normalizeWaveformPeaks(splitChannels, 2));
    expect(storedPeaks(r2, recording.peaksKey)).toMatchObject({ lanes: ["Caller", "Business"] });
    expect(await waveformRow(recording.id)).toMatchObject({
      waveform_state: "Stored",
      waveform_object_key: recording.peaksKey,
      waveform_generated_at: now,
      waveform_failure_reason: null,
    });
  });

  it("stores one Mixed lane for a single-channel Recording", async () => {
    const r2 = fakeR2();
    const peaks = fakePeaks();
    const recording = await storedRecording(r2, { channels: 1 });

    await generateRecordingWaveform(dependencies(r2, peaks), recording.id);

    expect(peaks.calls).toEqual([{ wav: recording.wav, splitChannels: false }]);
    expect(storedPeaks(r2, recording.peaksKey)).toMatchObject({ lanes: ["Mixed"], peaks: [[0.5, 0.13, 0.01]] });
    expect(await waveformRow(recording.id)).toMatchObject({ waveform_state: "Stored", waveform_object_key: recording.peaksKey });
  });

  it("does nothing for a Recording whose waveform is already Stored with its peaks object present", async () => {
    const r2 = fakeR2();
    const peaks = fakePeaks();
    const recording = await storedRecording(r2);
    await generateRecordingWaveform(dependencies(r2, peaks), recording.id);
    const before = await waveformRow(recording.id);

    await generateRecordingWaveform(dependencies(r2, peaks), recording.id);

    expect(peaks.calls).toHaveLength(1);
    expect(r2.puts).toEqual([recording.peaksKey]);
    expect(await waveformRow(recording.id)).toEqual(before);
  });

  it("regenerates a Stored waveform whose peaks object is missing", async () => {
    const r2 = fakeR2();
    const peaks = fakePeaks();
    const recording = await storedRecording(r2);
    await generateRecordingWaveform(dependencies(r2, peaks), recording.id);
    r2.objects.delete(recording.peaksKey);

    await generateRecordingWaveform(dependencies(r2, peaks), recording.id);

    expect(peaks.calls).toHaveLength(2);
    expect(r2.objects.has(recording.peaksKey)).toBe(true);
  });

  describe.sequential("when peak generation fails", () => {
    const r2 = fakeR2();
    let recording: Awaited<ReturnType<typeof storedRecording>>;

    it("persists the failure as Failed with a stable reason, leaves the transfer untouched, and rethrows for retry", async () => {
      recording = await storedRecording(r2);
      const peaks = fakePeaks();
      peaks.failure = new AudiowaveformError();

      await expect(generateRecordingWaveform(dependencies(r2, peaks), recording.id)).rejects.toBe(peaks.failure);

      expect(r2.puts).toEqual([]);
      expect(await waveformRow(recording.id)).toMatchObject({
        transfer_state: "Stored",
        twilio_cleanup_state: "Deleted",
        r2_object_key: recording.wavKey,
        waveform_state: "Failed",
        waveform_object_key: null,
        waveform_failure_reason: "audiowaveform could not generate peaks",
      });
    });

    it("records an R2 upload failure and then overwrites the same key on retry and clears the failure", async () => {
      const peaks = fakePeaks();
      r2.putFailure = new R2ObjectError(500);
      await expect(generateRecordingWaveform(dependencies(r2, peaks), recording.id)).rejects.toBe(r2.putFailure);
      expect(await waveformRow(recording.id)).toMatchObject({ waveform_state: "Failed", waveform_failure_reason: "R2 request failed (HTTP 500)" });
      r2.putFailure = null;
      r2.objects.set(recording.peaksKey, { bytes: new TextEncoder().encode("partial"), contentType: "application/json" });

      await generateRecordingWaveform(dependencies(r2, peaks), recording.id);

      expect(r2.puts).toEqual([recording.peaksKey, recording.peaksKey]);
      expect(storedPeaks(r2, recording.peaksKey)).toEqual(normalizeWaveformPeaks(splitChannels, 2));
      expect(await waveformRow(recording.id)).toMatchObject({ waveform_state: "Stored", waveform_object_key: recording.peaksKey, waveform_failure_reason: null });
    });
  });

  it("fails without generating peaks when the Recording's WAV is missing from R2", async () => {
    const r2 = fakeR2();
    const peaks = fakePeaks();
    const recording = await storedRecording(r2);
    r2.objects.delete(recording.wavKey);

    await expect(generateRecordingWaveform(dependencies(r2, peaks), recording.id)).rejects.toThrow("Recording object is missing from R2");

    expect(peaks.calls).toEqual([]);
    expect(await waveformRow(recording.id)).toMatchObject({ waveform_state: "Failed", waveform_failure_reason: "Recording object is missing from R2" });
  });

  it("does nothing for a Recording that is not Stored or no longer exists", async () => {
    const r2 = fakeR2();
    const peaks = fakePeaks();
    const pending = await storedRecording(r2, { transfer: "Pending" });
    const failed = await storedRecording(r2, { transfer: "Failed" });

    await generateRecordingWaveform(dependencies(r2, peaks), pending.id);
    await generateRecordingWaveform(dependencies(r2, peaks), failed.id);
    await expect(generateRecordingWaveform(dependencies(r2, peaks), randomUUID())).resolves.toBeUndefined();

    expect(r2.gets).toEqual([]);
    expect(peaks.calls).toEqual([]);
    expect(await waveformRow(pending.id)).toMatchObject({ waveform_state: "Pending" });
    expect(await waveformRow(failed.id)).toMatchObject({ waveform_state: "Pending" });
  });

  it("skips a Recording whose media expired 12 months after its Call started and keeps its Call and Recording metadata", async () => {
    const r2 = fakeR2();
    const peaks = fakePeaks();
    const expired = await storedRecording(r2, { callStartedAt: new Date("2025-10-16T11:59:59.000Z") });
    const retained = await storedRecording(r2, { callStartedAt: new Date("2025-10-16T12:00:01.000Z") });
    const before = await waveformRow(expired.id);

    await generateRecordingWaveform(dependencies(r2, peaks), expired.id);
    await generateRecordingWaveform(dependencies(r2, peaks), retained.id);

    expect(peaks.calls).toEqual([{ wav: retained.wav, splitChannels: true }]);
    expect(r2.objects.has(expired.peaksKey)).toBe(false);
    expect(await waveformRow(expired.id)).toEqual(before);
    expect(before).toMatchObject({ channels: 2, duration_seconds: 12, waveform_state: "Pending" });
    await expect(pool!.query("select id from call where id = $1", [expired.callId])).resolves.toMatchObject({ rowCount: 1 });
    expect(await waveformRow(retained.id)).toMatchObject({ waveform_state: "Stored" });
  });

  it("skips a Recording whose media an Operator purged without reading or uploading anything", async () => {
    const r2 = fakeR2();
    const peaks = fakePeaks();
    const purged = await storedRecording(r2, { purgedAt: days(0) });
    const before = await waveformRow(purged.id);

    await expect(generateRecordingWaveform(dependencies(r2, peaks), purged.id)).resolves.toBeUndefined();

    expect(r2.gets).toEqual([]);
    expect(r2.puts).toEqual([]);
    expect(peaks.calls).toEqual([]);
    expect(await waveformRow(purged.id)).toEqual(before);
  });

  it("deletes the peaks it uploaded and leaves the waveform unstored when a purge commits while peaks are generated", async () => {
    const r2 = fakeR2();
    const peaks = fakePeaks();
    const recording = await storedRecording(r2);
    peaks.during = () => purge(recording.id, now);

    await expect(generateRecordingWaveform(dependencies(r2, peaks), recording.id)).resolves.toBeUndefined();

    expect(r2.puts).toEqual([recording.peaksKey]);
    expect(r2.objects.has(recording.peaksKey)).toBe(false);
    expect(await waveformRow(recording.id)).toMatchObject({ waveform_state: "Pending", waveform_object_key: null, waveform_generated_at: null });
  });

  it("ends cleanly without recording Failed when a purge deletes the WAV before the run reads it", async () => {
    const r2 = fakeR2();
    const peaks = fakePeaks();
    const recording = await storedRecording(r2);
    r2.beforeGet = async () => {
      await purge(recording.id, now);
      r2.objects.delete(recording.wavKey);
    };

    await expect(generateRecordingWaveform(dependencies(r2, peaks), recording.id)).resolves.toBeUndefined();

    expect(peaks.calls).toEqual([]);
    expect(r2.puts).toEqual([]);
    expect(await waveformRow(recording.id)).toMatchObject({ waveform_state: "Pending", waveform_failure_reason: null });
  });
});
