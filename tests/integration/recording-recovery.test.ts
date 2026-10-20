/**
 * -------------------------------------------------------------------------
 * @file   recording-recovery.test.ts
 * @brief  Verifies the Recording recovery sweep.
 *
 * @description
 *  Seeds Recordings in every transfer, cleanup, and waveform state against
 *  a real PostgreSQL database and checks that the sweep re-requests
 *  processing for unfinished transfers and waveform generation for
 *  transferred Recordings without Stored peaks, transcription for Stored
 *  Recordings whose Transcript is Pending or Failed, and the Lead Assessment
 *  for Completed Transcripts whose Lead Assessment is Pending or Failed,
 *  only when idle for over an hour and created within the last 7 days, and
 *  that one failed request does not stop the rest.
 *
 * @remarks
 *  Recording processing, waveform, transcription, and Lead Assessment
 *  requests are fakes at the Trigger.dev boundary that record each request.
 *
 * @see
 *  data/recording-recovery.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { generateInitialCallFlow } from "@/data/call-flow";
import { migrateDatabase } from "@/data/migrate";
import type { RecordingProcessing, RecordingProcessingRequest } from "@/data/recording";
import { sweepStuckRecordings } from "@/data/recording-recovery";

const now = new Date("2026-10-16T12:00:00.000Z");
const hours = (count: number) => new Date(now.getTime() - count * 60 * 60 * 1000);

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let organizationId = "";
let sequence = 0;

async function recording(state: {
  transfer: string;
  cleanup: string;
  waveform?: string;
  transcript?: string;
  leadAssessment?: string;
  mp3?: string;
  callId?: string;
  createdAt: Date;
  updatedAt: Date;
}): Promise<string> {
  sequence += 1;
  const id = randomUUID();
  const stored = state.transfer === "Stored";
  const waveformStored = state.waveform === "Stored";
  const mp3 = state.mp3 ?? (stored ? "Stored" : "Pending");
  await pool!.query(
    `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, transfer_state, twilio_cleanup_state,
                            r2_object_key, size_bytes, sha256, stored_at, waveform_state, waveform_object_key, waveform_generated_at,
                            mp3_state, mp3_object_key, mp3_size_bytes, mp3_generated_at, created_at, updated_at)
     values ($1, $2, 'recovery-workspace', $15, $3, 'voicemail', 1, $4, $5, $6, $7, $8, $9, $12, $13, $14, $16, $17, $18, $19, $10, $11)`,
    [
      id,
      organizationId,
      `RE${String(sequence).padStart(32, "0")}`,
      state.transfer,
      state.cleanup,
      stored ? `recordings/${id}.wav` : null,
      stored ? 128 : null,
      stored ? "a".repeat(64) : null,
      stored ? state.updatedAt : null,
      state.createdAt,
      state.updatedAt,
      state.waveform ?? "Pending",
      waveformStored ? `recordings/${id}.peaks.json` : null,
      waveformStored ? state.updatedAt : null,
      state.callId ?? "recovery-call",
      mp3,
      mp3 === "Stored" ? `recordings/${id}.mp3` : null,
      mp3 === "Stored" ? 64 : null,
      mp3 === "Stored" ? state.updatedAt : null,
    ],
  );
  if (state.transcript) {
    const completed = state.transcript === "Completed";
    await pool!.query(
      `update recording set transcript_state = $2, transcript_failure_reason = $3, transcript_audio_ms = $4, transcript_cost_usd = $5, transcript_completed_at = $6,
                            lead_assessment_state = $7, transcript_skip_reason = $8
        where id = $1`,
      [
        id,
        state.transcript,
        state.transcript === "Failed" ? "OpenAI request failed (HTTP 500)" : null,
        completed ? 60_000 : null,
        completed ? 0.006 : null,
        completed ? state.updatedAt : null,
        state.leadAssessment ?? null,
        state.transcript === "Skipped" ? "too_short" : null,
      ],
    );
  }
  return id;
}

function sweep(
  processing: RecordingProcessing,
  waveform: RecordingProcessing = recordingProcessing(),
  transcription: RecordingProcessing = recordingProcessing(),
  leadAssessment: RecordingProcessing = recordingProcessing(),
  mp3: RecordingProcessing = recordingProcessing(),
) {
  return sweepStuckRecordings(
    { pool: pool!, recordingProcessing: processing, recordingWaveform: waveform, recordingTranscription: transcription, recordingLeadAssessment: leadAssessment, recordingMp3: mp3 },
    now,
  );
}

function recordingProcessing(failingId: string | null = null): RecordingProcessing & { requests: RecordingProcessingRequest[] } {
  const requests: RecordingProcessingRequest[] = [];
  return {
    requests,
    async request(request) {
      requests.push(request);
      if (request.id === failingId) throw new Error("Trigger.dev unavailable");
    },
  };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrateDatabase(container.getConnectionUri());
  const operator = await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "Recovery Operator", timezone: "UTC" });
  organizationId = operator.organizationId;
  await pool.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ('recovery-number', $1, 'PNeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', '+14155550112', 'Recovery Number', true, now(), now(), now(), now())`,
    [organizationId],
  );
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, destination_number, created_at, updated_at)
     values ('recovery-workspace', $1, 'Recovery Workspace', 'UTC', 'Active', '+14155550199', now(), now())`,
    [organizationId],
  );
  await pool.query(
    `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at)
     values ('recovery-assignment', $1, 'recovery-workspace', 'recovery-number', '+14155550112', now(), now())`,
    [organizationId],
  );
  const graph = generateInitialCallFlow({ destinationNumber: "+14155550199", recordingEnabled: false, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });
  await pool.query(
    `insert into flow_version (id, organization_id, workspace_id, version, graph, published_by_user_id, published_at)
     values ('recovery-flow-version', $1, 'recovery-workspace', 1, $2, $3, now())`,
    [organizationId, JSON.stringify(graph), operator.userId],
  );
  await pool.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, started_at, created_at, updated_at)
     values ('recovery-call', $1, 'recovery-workspace', 'recovery-assignment', 'recovery-flow-version', 'CArecovery', '+14155550112', $2, $2, $2),
            ('recovery-expired-call', $1, 'recovery-workspace', 'recovery-assignment', 'recovery-flow-version', 'CArecoveryexpired', '+14155550112', $3, $3, $3)`,
    [organizationId, hours(24 * 60), new Date("2025-10-16T11:59:59.000Z")],
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

beforeEach(async () => {
  await pool!.query("delete from recording");
});

describe("Recording recovery sweep", () => {
  it("re-requests every unfinished Recording idle for over an hour with its Recording-derived idempotency key", async () => {
    const pending = await recording({ transfer: "Pending", cleanup: "Pending", createdAt: hours(30), updatedAt: hours(2) });
    const failed = await recording({ transfer: "Failed", cleanup: "Pending", createdAt: hours(20), updatedAt: hours(2) });
    const cleanupPending = await recording({ transfer: "Stored", cleanup: "Pending", createdAt: hours(10), updatedAt: hours(2) });
    const cleanupFailed = await recording({ transfer: "Stored", cleanup: "Failed", createdAt: hours(5), updatedAt: hours(2) });
    const processing = recordingProcessing();
    const waveform = recordingProcessing();

    await expect(sweep(processing, waveform)).resolves.toEqual({ requested: 4, failed: 0 });

    expect(processing.requests).toEqual([pending, failed, cleanupPending, cleanupFailed].map((id) => ({ id, organizationId, idempotencyKey: `recording-processing:${id}` })));
    expect(waveform.requests).toEqual([]);
  });

  it("re-requests waveform generation for transferred Recordings whose waveform is Pending or Failed and idle for over an hour", async () => {
    const waveformPending = await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Pending", createdAt: hours(30), updatedAt: hours(2) });
    const waveformFailed = await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Failed", createdAt: hours(20), updatedAt: hours(2) });
    const processing = recordingProcessing();
    const waveform = recordingProcessing();

    await expect(sweep(processing, waveform)).resolves.toEqual({ requested: 2, failed: 0 });

    expect(waveform.requests).toEqual([waveformPending, waveformFailed].map((id) => ({ id, organizationId, idempotencyKey: `recording-waveform:${id}` })));
    expect(processing.requests).toEqual([]);
  });

  it("skips fresh, older than 7 days, and fully processed Recordings", async () => {
    await recording({ transfer: "Pending", cleanup: "Pending", createdAt: hours(1), updatedAt: hours(0.5) });
    await recording({ transfer: "Failed", cleanup: "Pending", createdAt: hours(7 * 24 + 1), updatedAt: hours(7 * 24) });
    await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", createdAt: hours(30), updatedAt: hours(2) });
    await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Failed", createdAt: hours(3), updatedAt: hours(0.5) });
    await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Failed", createdAt: hours(7 * 24 + 1), updatedAt: hours(7 * 24) });
    const processing = recordingProcessing();
    const waveform = recordingProcessing();

    await expect(sweep(processing, waveform)).resolves.toEqual({ requested: 0, failed: 0 });

    expect(processing.requests).toEqual([]);
    expect(waveform.requests).toEqual([]);
  });

  it("re-requests transcription for Stored Recordings whose Transcript is Pending or Failed and idle for over an hour", async () => {
    const transcriptPending = await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", transcript: "Pending", createdAt: hours(30), updatedAt: hours(2) });
    const transcriptFailed = await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", transcript: "Failed", createdAt: hours(20), updatedAt: hours(2) });
    await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", transcript: "Skipped", createdAt: hours(10), updatedAt: hours(2) });
    const processing = recordingProcessing();
    const transcription = recordingProcessing();
    const leadAssessment = recordingProcessing();

    await expect(sweep(processing, recordingProcessing(), transcription, leadAssessment)).resolves.toEqual({ requested: 2, failed: 0 });

    expect(transcription.requests).toEqual([transcriptPending, transcriptFailed].map((id) => ({ id, organizationId, idempotencyKey: `recording-transcription:${id}` })));
    expect(processing.requests).toEqual([]);
    expect(leadAssessment.requests).toEqual([]);
  });

  it("re-requests the Lead Assessment for Completed Transcripts whose Lead Assessment is Pending or Failed and idle for over an hour", async () => {
    const assessmentPending = await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", transcript: "Completed", leadAssessment: "Pending", createdAt: hours(30), updatedAt: hours(2) });
    const assessmentFailed = await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", transcript: "Completed", leadAssessment: "Failed", createdAt: hours(20), updatedAt: hours(2) });
    await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", transcript: "Completed", leadAssessment: "Completed", createdAt: hours(10), updatedAt: hours(2) });
    const transcription = recordingProcessing();
    const leadAssessment = recordingProcessing();

    await expect(sweep(recordingProcessing(), recordingProcessing(), transcription, leadAssessment)).resolves.toEqual({ requested: 2, failed: 0 });

    expect(leadAssessment.requests).toEqual([assessmentPending, assessmentFailed].map((id) => ({ id, organizationId, idempotencyKey: `recording-lead-assessment:${id}` })));
    expect(transcription.requests).toEqual([]);
  });

  it("requests both a stalled waveform and a stalled Transcript for one transferred Recording", async () => {
    const id = await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Failed", transcript: "Failed", createdAt: hours(30), updatedAt: hours(2) });
    const waveform = recordingProcessing();
    const transcription = recordingProcessing();

    await expect(sweep(recordingProcessing(), waveform, transcription)).resolves.toEqual({ requested: 2, failed: 0 });

    expect(waveform.requests.map((request) => request.id)).toEqual([id]);
    expect(transcription.requests.map((request) => request.id)).toEqual([id]);
  });

  it("skips fresh and older than 7 days Transcripts and Lead Assessments", async () => {
    await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", transcript: "Failed", createdAt: hours(3), updatedAt: hours(0.5) });
    await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", transcript: "Pending", createdAt: hours(7 * 24 + 1), updatedAt: hours(7 * 24) });
    await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", transcript: "Completed", leadAssessment: "Failed", createdAt: hours(3), updatedAt: hours(0.5) });
    await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", transcript: "Completed", leadAssessment: "Pending", createdAt: hours(7 * 24 + 1), updatedAt: hours(7 * 24) });
    const transcription = recordingProcessing();
    const leadAssessment = recordingProcessing();

    await expect(sweep(recordingProcessing(), recordingProcessing(), transcription, leadAssessment)).resolves.toEqual({ requested: 0, failed: 0 });

    expect(transcription.requests).toEqual([]);
    expect(leadAssessment.requests).toEqual([]);
  });

  it("keeps requesting the remaining Transcripts and Lead Assessments when one request fails", async () => {
    const first = await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", transcript: "Failed", createdAt: hours(30), updatedAt: hours(2) });
    const second = await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", transcript: "Pending", createdAt: hours(25), updatedAt: hours(2) });
    const third = await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", transcript: "Completed", leadAssessment: "Failed", createdAt: hours(20), updatedAt: hours(2) });
    const transcription = recordingProcessing(first);
    const leadAssessment = recordingProcessing();

    await expect(sweep(recordingProcessing(), recordingProcessing(), transcription, leadAssessment)).resolves.toEqual({ requested: 2, failed: 1 });

    expect(transcription.requests.map((request) => request.id)).toEqual([first, second]);
    expect(leadAssessment.requests.map((request) => request.id)).toEqual([third]);
  });

  it("keeps requesting the remaining Recordings when one request fails", async () => {
    const first = await recording({ transfer: "Pending", cleanup: "Pending", createdAt: hours(30), updatedAt: hours(2) });
    const second = await recording({ transfer: "Failed", cleanup: "Pending", createdAt: hours(20), updatedAt: hours(2) });
    const processing = recordingProcessing(first);

    await expect(sweep(processing)).resolves.toEqual({ requested: 1, failed: 1 });

    expect(processing.requests.map((request) => request.id)).toEqual([first, second]);
  });

  it("keeps requesting the remaining waveforms when one waveform request fails", async () => {
    const first = await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Failed", createdAt: hours(30), updatedAt: hours(2) });
    const second = await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Pending", createdAt: hours(20), updatedAt: hours(2) });
    const waveform = recordingProcessing(first);

    await expect(sweep(recordingProcessing(), waveform)).resolves.toEqual({ requested: 1, failed: 1 });

    expect(waveform.requests.map((request) => request.id)).toEqual([first, second]);
  });

  it("backfills MP3s for Stored Recordings of any age within media retention whose MP3 is Pending, and retries recent Failed MP3s", async () => {
    const backfill = await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", mp3: "Pending", createdAt: hours(24 * 50), updatedAt: hours(24 * 50) });
    const pending = await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", mp3: "Pending", createdAt: hours(30), updatedAt: hours(2) });
    const failed = await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", mp3: "Failed", createdAt: hours(20), updatedAt: hours(2) });
    const processing = recordingProcessing();
    const waveform = recordingProcessing();
    const mp3 = recordingProcessing();

    await expect(sweep(processing, waveform, recordingProcessing(), recordingProcessing(), mp3)).resolves.toEqual({ requested: 3, failed: 0 });

    expect(mp3.requests).toEqual([backfill, pending, failed].map((id) => ({ id, organizationId, idempotencyKey: `recording-mp3:${id}` })));
    expect(processing.requests).toEqual([]);
    expect(waveform.requests).toEqual([]);
  });

  it("skips MP3s that are fresh, Stored, Failed for over 7 days, past media retention, or whose Recording is not Stored", async () => {
    await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", mp3: "Pending", createdAt: hours(3), updatedAt: hours(0.5) });
    await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", mp3: "Stored", createdAt: hours(24 * 50), updatedAt: hours(24 * 50) });
    await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", mp3: "Failed", createdAt: hours(7 * 24 + 1), updatedAt: hours(7 * 24) });
    await recording({ transfer: "Stored", cleanup: "Deleted", waveform: "Stored", mp3: "Pending", callId: "recovery-expired-call", createdAt: hours(24 * 300), updatedAt: hours(24 * 300) });
    await recording({ transfer: "Failed", cleanup: "Pending", mp3: "Pending", createdAt: hours(24 * 50), updatedAt: hours(24 * 50) });
    const processing = recordingProcessing();
    const mp3 = recordingProcessing();

    await expect(sweep(processing, recordingProcessing(), recordingProcessing(), recordingProcessing(), mp3)).resolves.toEqual({ requested: 0, failed: 0 });

    expect(mp3.requests).toEqual([]);
    expect(processing.requests).toEqual([]);
  });

  it("backfills only the MP3 for a Recording older than 7 days whose other stages also stalled", async () => {
    const id = await recording({ transfer: "Stored", cleanup: "Failed", waveform: "Failed", transcript: "Failed", mp3: "Pending", createdAt: hours(24 * 50), updatedAt: hours(24 * 50) });
    const processing = recordingProcessing();
    const waveform = recordingProcessing();
    const transcription = recordingProcessing();
    const mp3 = recordingProcessing();

    await expect(sweep(processing, waveform, transcription, recordingProcessing(), mp3)).resolves.toEqual({ requested: 1, failed: 0 });

    expect(mp3.requests.map((request) => request.id)).toEqual([id]);
    expect([...processing.requests, ...waveform.requests, ...transcription.requests]).toEqual([]);
  });
});
