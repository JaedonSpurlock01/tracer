/**
 * -------------------------------------------------------------------------
 * @file   recording-transcription.test.ts
 * @brief  Verifies Recording transcription into a normalized Transcript.
 *
 * @description
 *  Runs the Recording transcription workflow against a real PostgreSQL
 *  database with fake R2 and OpenAI boundaries, checking the normalized
 *  Caller and Business turns from a dual-channel Recording, a voicemail's
 *  single Caller channel, the 3-hour cap, the purge-surviving usage
 *  metadata, the single Lead Assessment request, secret-free failures that
 *  leave playback untouched, retry from Failed, and no-ops for Recordings
 *  that are Skipped, Completed, expired, purged, not Stored, or missing,
 *  including a purge that commits while OpenAI transcribes.
 *
 * @remarks
 *  The fake transcriber tells the channels apart by the constant sample
 *  value each synthetic channel carries, and long Recordings use a low
 *  synthetic sample rate so a 3-hour WAV stays small.
 *
 * @see
 *  data/recording-transcription.ts
 *  tests/integration/recording-waveform.test.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createHash, randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./test-database";

import type { OpenedDatabase } from "@/data/database";
import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { generateInitialCallFlow } from "@/data/call-flow";
import { migrateDatabase } from "@/data/migrate";
import { OpenAIError, type AudioTranscriber, type TranscriptionSegment } from "@/data/openai-client";
import type { RecordingObjects, StoredObject } from "@/data/r2-objects";
import type { RecordingProcessing, RecordingProcessingRequest } from "@/data/recording";
import { transcribeRecording, type RecordingTranscriptionDependencies } from "@/data/recording-transcription";
import { readRecordingAudio } from "@/data/recording-wav";

const now = new Date("2026-10-16T12:00:00.000Z");
const days = (count: number) => new Date(now.getTime() - count * 24 * 60 * 60 * 1000);
const callerSample = 1000;
const businessSample = 2000;

let container: StartedPostgreSqlContainer | undefined;
let database: OpenedDatabase | undefined;
let organizationId = "";

interface FakeR2 extends RecordingObjects {
  objects: Map<string, Uint8Array>;
  gets: string[];
  beforeGet: (() => Promise<void>) | null;
}

interface FakeTranscriber extends AudioTranscriber {
  calls: { speaker: "Caller" | "Business"; durationMs: number }[];
  scripts: Record<"Caller" | "Business", TranscriptionSegment[]>;
  failure: Error | null;
  during: (() => Promise<void>) | null;
}

interface FakeLeadAssessment extends RecordingProcessing {
  requests: RecordingProcessingRequest[];
  failure: Error | null;
}

function fakeR2(): FakeR2 {
  const r2: FakeR2 = {
    objects: new Map(),
    gets: [],
    beforeGet: null,
    async head(key): Promise<StoredObject | null> {
      const bytes = r2.objects.get(key);
      return bytes ? { sizeBytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") } : null;
    },
    async put(key, body) {
      r2.objects.set(key, body);
    },
    async get(key) {
      r2.gets.push(key);
      await r2.beforeGet?.();
      return r2.objects.get(key) ?? null;
    },
  };
  return r2;
}

function fakeTranscriber(scripts: FakeTranscriber["scripts"]): FakeTranscriber {
  const transcriber: FakeTranscriber = {
    calls: [],
    scripts,
    failure: null,
    during: null,
    async transcribe(wav) {
      const audio = readRecordingAudio(wav);
      const speaker = new DataView(wav.buffer, wav.byteOffset).getInt16(44, true) === businessSample ? "Business" : "Caller";
      transcriber.calls.push({ speaker, durationMs: audio.durationMs });
      await transcriber.during?.();
      if (transcriber.failure) throw transcriber.failure;
      return transcriber.scripts[speaker];
    },
  };
  return transcriber;
}

function fakeLeadAssessment(): FakeLeadAssessment {
  const processing: FakeLeadAssessment = {
    requests: [],
    failure: null,
    async request(recording) {
      processing.requests.push(recording);
      if (processing.failure) throw processing.failure;
    },
  };
  return processing;
}

const conversation: FakeTranscriber["scripts"] = {
  Caller: [
    { startMs: 0, endMs: 3000, text: "Hi, I need a quote for a water heater." },
    { startMs: 9000, endMs: 10_500, text: "Thursday works." },
  ],
  Business: [
    { startMs: 3500, endMs: 6000, text: "Sure, when can we come out?" },
    { startMs: 6500, endMs: 8000, text: "We have Thursday open." },
  ],
};

function dependencies(r2: FakeR2, transcriber: FakeTranscriber, leadAssessment: FakeLeadAssessment): RecordingTranscriptionDependencies {
  return { database: database!, objects: r2, transcriber, leadAssessment, now: () => now };
}

function pcmWav(channels: 1 | 2, sampleRate: number, seconds: number): Uint8Array {
  const frames = Math.round(seconds * sampleRate);
  const dataSize = frames * channels * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, 36 + dataSize, true);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, dataSize, true);
  for (let sample = 0; sample < frames * channels; sample += 1) view.setInt16(44 + sample * 2, sample % channels === 0 ? callerSample : businessSample, true);
  return bytes;
}

let sequence = 0;

async function storedRecording(
  r2: FakeR2,
  options: { channels?: 1 | 2; wav?: Uint8Array | null; transfer?: string; transcript?: string | null; skipReason?: string; callStartedAt?: Date; purgedAt?: Date } = {},
): Promise<{ id: string; callId: string; wavKey: string }> {
  sequence += 1;
  const channels = options.channels ?? 2;
  const transfer = options.transfer ?? "Stored";
  const stored = transfer === "Stored";
  const transcript = options.transcript === undefined ? (stored ? "Pending" : null) : options.transcript;
  const callId = `transcription-call-${sequence}`;
  const id = randomUUID();
  const wavKey = `organizations/${organizationId}/workspaces/transcription-workspace/calls/${callId}/recordings/${id}.wav`;
  const wav = options.wav === undefined ? pcmWav(channels, 8000, 12) : options.wav;
  await database!.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, started_at, created_at, updated_at)
     values ($1, $2, 'transcription-workspace', 'transcription-assignment', 'transcription-flow-version', $3, '+14155550114', $4, $4, $4)`,
    [callId, organizationId, `CA${String(sequence).padStart(32, "0")}`, options.callStartedAt ?? days(1)],
  );
  await database!.query(
    `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, transfer_state, twilio_cleanup_state,
                            r2_object_key, size_bytes, sha256, stored_at, waveform_state, waveform_object_key, waveform_generated_at,
                            transcript_state, transcript_skip_reason, created_at, updated_at)
     values ($1, $2, 'transcription-workspace', $3, $4, $5, $6, 40, $7, $8, $9, $10, $11, $12, $13, $14, $12, $15, $16, $12, $12)`,
    [
      id,
      organizationId,
      callId,
      `RE${String(sequence).padStart(32, "0")}`,
      channels === 2 ? "connected" : "voicemail",
      channels,
      transfer,
      stored ? "Deleted" : "Pending",
      stored ? wavKey : null,
      stored ? (wav?.byteLength ?? 1) : null,
      stored ? "checksum" : null,
      days(1),
      stored ? "Stored" : "Pending",
      stored ? wavKey.replace(/\.wav$/, ".peaks.json") : null,
      transcript,
      transcript === "Skipped" ? (options.skipReason ?? "too_short") : null,
    ],
  );
  if (options.purgedAt) await purge(id, options.purgedAt);
  if (stored && wav) r2.objects.set(wavKey, wav);
  return { id, callId, wavKey };
}

async function purge(id: string, at: Date): Promise<void> {
  await database!.query("update recording set media_purged_at = $2 where id = $1", [id, at]);
}

async function recordingRow(id: string): Promise<Record<string, unknown>> {
  const result = await database!.query(
    `select transfer_state, twilio_cleanup_state, r2_object_key, waveform_state, waveform_object_key, transcript_state, transcript_skip_reason, transcript_failure_reason,
            transcript_audio_ms, transcript_cost_usd, transcript_completed_at, lead_assessment_state, lead_assessment_failure_reason
       from recording where id = $1`,
    [id],
  );
  return result.rows[0];
}

async function transcriptRow(id: string): Promise<{ turns: unknown; model: string; call_id: string; organization_id: string } | undefined> {
  const result = await database!.query<{ turns: unknown; model: string; call_id: string; organization_id: string }>("select turns, model, call_id, organization_id from transcript where recording_id = $1", [id]);
  return result.rows[0];
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  database = createTestDatabase(container.getConnectionUri());
  await migrateDatabase(container.getConnectionUri());
  const operator = await bootstrapInitialOperator(database, { email: "operator@example.com", name: "Transcription Operator", timezone: "UTC" });
  organizationId = operator.organizationId;
  await database.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ('transcription-number', $1, 'PNeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', '+14155550114', 'Transcription Number', true, now(), now(), now(), now())`,
    [organizationId],
  );
  await database.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, destination_number, recording_enabled, analysis_enabled, created_at, updated_at)
     values ('transcription-workspace', $1, 'Transcription Workspace', 'UTC', 'Active', '+14155550199', true, true, now(), now())`,
    [organizationId],
  );
  await database.query(
    `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at)
     values ('transcription-assignment', $1, 'transcription-workspace', 'transcription-number', '+14155550114', now(), now())`,
    [organizationId],
  );
  const graph = generateInitialCallFlow({ destinationNumber: "+14155550199", recordingEnabled: true, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });
  await database.query(
    `insert into flow_version (id, organization_id, workspace_id, version, graph, published_by_user_id, published_at)
     values ('transcription-flow-version', $1, 'transcription-workspace', 1, $2, $3, now())`,
    [organizationId, JSON.stringify(graph), operator.userId],
  );
}, 120_000);

afterAll(async () => {
  await database?.close();
  await container?.stop();
});

describe("Recording transcription", () => {
  it("transcribes the Caller and Business channels into one normalized Transcript and marks it Completed", async () => {
    const r2 = fakeR2();
    const transcriber = fakeTranscriber(conversation);
    const leadAssessment = fakeLeadAssessment();
    const recording = await storedRecording(r2, { channels: 2 });

    await transcribeRecording(dependencies(r2, transcriber, leadAssessment), recording.id);

    expect(transcriber.calls).toEqual([
      { speaker: "Caller", durationMs: 12_000 },
      { speaker: "Business", durationMs: 12_000 },
    ]);
    expect(await transcriptRow(recording.id)).toEqual({
      organization_id: organizationId,
      call_id: recording.callId,
      model: "whisper-1",
      turns: [
        { speaker: "Caller", startMs: 0, endMs: 3000, text: "Hi, I need a quote for a water heater." },
        { speaker: "Business", startMs: 3500, endMs: 8000, text: "Sure, when can we come out? We have Thursday open." },
        { speaker: "Caller", startMs: 9000, endMs: 10_500, text: "Thursday works." },
      ],
    });
    expect(await recordingRow(recording.id)).toMatchObject({
      transcript_state: "Completed",
      transcript_failure_reason: null,
      transcript_audio_ms: 24_000,
      transcript_cost_usd: "0.002400",
      transcript_completed_at: now,
      lead_assessment_state: "Pending",
    });
  });

  it("requests exactly one Lead Assessment with the Recording-derived idempotency key after the Transcript is Completed", async () => {
    const r2 = fakeR2();
    const leadAssessment = fakeLeadAssessment();
    const recording = await storedRecording(r2);

    await transcribeRecording(dependencies(r2, fakeTranscriber(conversation), leadAssessment), recording.id);

    expect(leadAssessment.requests).toEqual([{ id: recording.id, organizationId, idempotencyKey: `recording-lead-assessment:${recording.id}` }]);
  });

  it("keeps the Completed Transcript when the Lead Assessment request fails", async () => {
    const r2 = fakeR2();
    const leadAssessment = fakeLeadAssessment();
    leadAssessment.failure = new Error("Trigger.dev is unavailable");
    const recording = await storedRecording(r2);

    await expect(transcribeRecording(dependencies(r2, fakeTranscriber(conversation), leadAssessment), recording.id)).resolves.toBeUndefined();

    expect(await recordingRow(recording.id)).toMatchObject({ transcript_state: "Completed", lead_assessment_state: "Pending" });
  });

  it("transcribes a voicemail as one Caller channel", async () => {
    const r2 = fakeR2();
    const transcriber = fakeTranscriber({ Caller: [{ startMs: 500, endMs: 4000, text: "Please call me back about a repair." }], Business: [] });
    const recording = await storedRecording(r2, { channels: 1 });

    await transcribeRecording(dependencies(r2, transcriber, fakeLeadAssessment()), recording.id);

    expect(transcriber.calls).toEqual([{ speaker: "Caller", durationMs: 12_000 }]);
    expect((await transcriptRow(recording.id))?.turns).toEqual([{ speaker: "Caller", startMs: 500, endMs: 4000, text: "Please call me back about a repair." }]);
    expect(await recordingRow(recording.id)).toMatchObject({ transcript_state: "Completed", transcript_audio_ms: 12_000, transcript_cost_usd: "0.001200" });
  });

  it("transcribes only the first 3 hours of a longer Recording in offset chunks and bills only that audio", async () => {
    const r2 = fakeR2();
    const transcriber = fakeTranscriber({ Caller: [{ startMs: 0, endMs: 1000, text: "Caller chunk." }], Business: [{ startMs: 2000, endMs: 3000, text: "Business chunk." }] });
    const recording = await storedRecording(r2, { channels: 2, wav: pcmWav(2, 100, 3.5 * 60 * 60) });

    await transcribeRecording(dependencies(r2, transcriber, fakeLeadAssessment()), recording.id);

    const turns = (await transcriptRow(recording.id))?.turns as { speaker: string; startMs: number }[];
    expect(transcriber.calls).toHaveLength(18);
    expect(turns).toHaveLength(18);
    expect(turns.filter((turn) => turn.speaker === "Caller").map((turn) => turn.startMs)).toEqual(Array.from({ length: 9 }, (_, index) => index * 1_200_000));
    expect(turns.filter((turn) => turn.speaker === "Business").map((turn) => turn.startMs)).toEqual(Array.from({ length: 9 }, (_, index) => index * 1_200_000 + 2000));
    expect(await recordingRow(recording.id)).toMatchObject({ transcript_state: "Completed", transcript_audio_ms: 21_600_000, transcript_cost_usd: "2.160000" });
  });

  describe.sequential("when OpenAI fails", () => {
    const r2 = fakeR2();
    let recording: Awaited<ReturnType<typeof storedRecording>>;

    it("persists Failed with a secret-free reason, leaves transfer and waveform untouched, and rethrows for retry", async () => {
      recording = await storedRecording(r2);
      const transcriber = fakeTranscriber(conversation);
      const leadAssessment = fakeLeadAssessment();
      transcriber.failure = new OpenAIError("OpenAI request failed (HTTP 500)");

      await expect(transcribeRecording(dependencies(r2, transcriber, leadAssessment), recording.id)).rejects.toBe(transcriber.failure);

      expect(await transcriptRow(recording.id)).toBeUndefined();
      expect(leadAssessment.requests).toEqual([]);
      expect(await recordingRow(recording.id)).toMatchObject({
        transfer_state: "Stored",
        twilio_cleanup_state: "Deleted",
        r2_object_key: recording.wavKey,
        waveform_state: "Stored",
        waveform_object_key: recording.wavKey.replace(/\.wav$/, ".peaks.json"),
        transcript_state: "Failed",
        transcript_failure_reason: "OpenAI request failed (HTTP 500)",
        lead_assessment_state: null,
      });
    });

    it("retries from Failed, clears the failure, and completes the Transcript", async () => {
      const leadAssessment = fakeLeadAssessment();

      await transcribeRecording(dependencies(r2, fakeTranscriber(conversation), leadAssessment), recording.id);

      expect(await recordingRow(recording.id)).toMatchObject({ transcript_state: "Completed", transcript_failure_reason: null, lead_assessment_state: "Pending" });
      expect(leadAssessment.requests).toHaveLength(1);
    });
  });

  it("records an unexpected error with a generic reason that never includes its message", async () => {
    const r2 = fakeR2();
    const transcriber = fakeTranscriber(conversation);
    transcriber.failure = new Error("Bearer sk-secret Hi, I need a quote");
    const recording = await storedRecording(r2);

    await expect(transcribeRecording(dependencies(r2, transcriber, fakeLeadAssessment()), recording.id)).rejects.toBe(transcriber.failure);

    expect(await recordingRow(recording.id)).toMatchObject({ transcript_state: "Failed", transcript_failure_reason: "Transcription failed" });
  });

  it("fails without calling OpenAI when the WAV is missing, unsupported, or has a different channel count", async () => {
    const r2 = fakeR2();
    const transcriber = fakeTranscriber(conversation);
    const missing = await storedRecording(r2, { wav: null });
    const unsupported = await storedRecording(r2, { wav: new TextEncoder().encode("not audio") });
    const mismatched = await storedRecording(r2, { channels: 2, wav: pcmWav(1, 8000, 12) });

    await expect(transcribeRecording(dependencies(r2, transcriber, fakeLeadAssessment()), missing.id)).rejects.toThrow("Recording object is missing from R2");
    await expect(transcribeRecording(dependencies(r2, transcriber, fakeLeadAssessment()), unsupported.id)).rejects.toThrow("Recording audio is not a WAV file");
    await expect(transcribeRecording(dependencies(r2, transcriber, fakeLeadAssessment()), mismatched.id)).rejects.toThrow("Recording audio does not match the Recording channels");

    expect(transcriber.calls).toEqual([]);
    expect(await recordingRow(missing.id)).toMatchObject({ transcript_state: "Failed", transcript_failure_reason: "Recording object is missing from R2" });
    expect(await recordingRow(unsupported.id)).toMatchObject({ transcript_state: "Failed", transcript_failure_reason: "Recording audio is not a WAV file" });
    expect(await recordingRow(mismatched.id)).toMatchObject({ transcript_state: "Failed", transcript_failure_reason: "Recording audio does not match the Recording channels" });
  });

  it("does nothing on a rerun after the Transcript is Completed", async () => {
    const r2 = fakeR2();
    const transcriber = fakeTranscriber(conversation);
    const leadAssessment = fakeLeadAssessment();
    const recording = await storedRecording(r2);
    await transcribeRecording(dependencies(r2, transcriber, leadAssessment), recording.id);
    const before = await recordingRow(recording.id);

    await transcribeRecording(dependencies(r2, transcriber, leadAssessment), recording.id);

    expect(transcriber.calls).toHaveLength(2);
    expect(leadAssessment.requests).toHaveLength(1);
    expect(await recordingRow(recording.id)).toEqual(before);
  });

  it("never calls OpenAI for a Skipped, not Stored, expired, or missing Recording", async () => {
    const r2 = fakeR2();
    const transcriber = fakeTranscriber(conversation);
    const leadAssessment = fakeLeadAssessment();
    const disabled = await storedRecording(r2, { transcript: "Skipped", skipReason: "analysis_disabled" });
    const tooShort = await storedRecording(r2, { transcript: "Skipped", skipReason: "too_short" });
    const pendingTransfer = await storedRecording(r2, { transfer: "Pending" });
    const expired = await storedRecording(r2, { callStartedAt: new Date("2025-10-16T11:59:59.000Z") });
    const records = [disabled, tooShort, pendingTransfer, expired];
    const before = await Promise.all(records.map((recording) => recordingRow(recording.id)));

    for (const recording of records) await transcribeRecording(dependencies(r2, transcriber, leadAssessment), recording.id);
    await expect(transcribeRecording(dependencies(r2, transcriber, leadAssessment), randomUUID())).resolves.toBeUndefined();

    expect(r2.gets).toEqual([]);
    expect(transcriber.calls).toEqual([]);
    expect(leadAssessment.requests).toEqual([]);
    expect(await Promise.all(records.map((recording) => recordingRow(recording.id)))).toEqual(before);
    expect(before[0]).toMatchObject({ transcript_state: "Skipped", transcript_skip_reason: "analysis_disabled" });
  });

  it("never calls OpenAI for a Recording whose media an Operator purged", async () => {
    const r2 = fakeR2();
    const transcriber = fakeTranscriber(conversation);
    const leadAssessment = fakeLeadAssessment();
    const purged = await storedRecording(r2, { purgedAt: days(0) });
    const before = await recordingRow(purged.id);

    await expect(transcribeRecording(dependencies(r2, transcriber, leadAssessment), purged.id)).resolves.toBeUndefined();

    expect(r2.gets).toEqual([]);
    expect(transcriber.calls).toEqual([]);
    expect(leadAssessment.requests).toEqual([]);
    expect(await transcriptRow(purged.id)).toBeUndefined();
    expect(await recordingRow(purged.id)).toEqual(before);
  });

  it("writes no Transcript and requests no Lead Assessment when a purge commits while OpenAI transcribes", async () => {
    const r2 = fakeR2();
    const transcriber = fakeTranscriber(conversation);
    const leadAssessment = fakeLeadAssessment();
    const recording = await storedRecording(r2);
    transcriber.during = () => purge(recording.id, now);

    await expect(transcribeRecording(dependencies(r2, transcriber, leadAssessment), recording.id)).resolves.toBeUndefined();

    expect(await transcriptRow(recording.id)).toBeUndefined();
    expect(leadAssessment.requests).toEqual([]);
    expect(await recordingRow(recording.id)).toMatchObject({ transcript_state: "Pending", transcript_completed_at: null, lead_assessment_state: null });
  });

  it("ends cleanly without recording Failed when a purge deletes the WAV before the run reads it", async () => {
    const r2 = fakeR2();
    const transcriber = fakeTranscriber(conversation);
    const leadAssessment = fakeLeadAssessment();
    const recording = await storedRecording(r2);
    r2.beforeGet = async () => {
      await purge(recording.id, now);
      r2.objects.delete(recording.wavKey);
    };

    await expect(transcribeRecording(dependencies(r2, transcriber, leadAssessment), recording.id)).resolves.toBeUndefined();

    expect(transcriber.calls).toEqual([]);
    expect(await recordingRow(recording.id)).toMatchObject({ transcript_state: "Pending", transcript_failure_reason: null });
    await expect(database!.query("select 1 from call_event where call_id = $1 and kind = 'transcript_failed'", [recording.callId])).resolves.toMatchObject({ rowCount: 0 });
  });
});

describe("Recording transcription Call events", () => {
  async function callEvents(callId: string): Promise<{ kind: string; occurred_at: Date; detail: Record<string, unknown> }[]> {
    const result = await database!.query<{ kind: string; occurred_at: Date; detail: Record<string, unknown> }>("select kind, occurred_at, detail from call_event where call_id = $1 order by occurred_at, id", [callId]);
    return result.rows;
  }

  it("appends one Transcript failed across repeated failures and then Transcript completed after a successful retry", async () => {
    const r2 = fakeR2();
    const recording = await storedRecording(r2);
    const failing = fakeTranscriber(conversation);
    failing.failure = new OpenAIError("OpenAI request failed (HTTP 500)");
    const later = new Date(now.getTime() + 60_000);

    await expect(transcribeRecording(dependencies(r2, failing, fakeLeadAssessment()), recording.id)).rejects.toBe(failing.failure);
    await expect(transcribeRecording({ ...dependencies(r2, failing, fakeLeadAssessment()), now: () => later }, recording.id)).rejects.toBe(failing.failure);
    expect(await callEvents(recording.callId)).toEqual([{ kind: "transcript_failed", occurred_at: now, detail: {} }]);

    const completedAt = new Date(now.getTime() + 120_000);
    await transcribeRecording({ ...dependencies(r2, fakeTranscriber(conversation), fakeLeadAssessment()), now: () => completedAt }, recording.id);
    await transcribeRecording({ ...dependencies(r2, fakeTranscriber(conversation), fakeLeadAssessment()), now: () => completedAt }, recording.id);

    expect(await callEvents(recording.callId)).toEqual([
      { kind: "transcript_failed", occurred_at: now, detail: {} },
      { kind: "transcript_completed", occurred_at: completedAt, detail: {} },
    ]);
  });
});
