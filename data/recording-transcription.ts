/**
 * -------------------------------------------------------------------------
 * @file   recording-transcription.ts
 * @brief  Transcribes a Stored Recording into a normalized speaker Transcript.
 *
 * @description
 *  Reads an analysis-eligible Recording's WAV from R2, splits it into Caller
 *  and Business mono chunks limited to the first 3 hours, transcribes each
 *  chunk through OpenAI, and merges the segments into timestamped speaker
 *  turns. The Transcript, its Completed state, the transcribed audio length
 *  and cost, and a Pending Lead Assessment are committed together, and only
 *  then is the Lead Assessment task requested. A Recording whose Transcript
 *  is not Pending or Failed, whose transfer is not Stored, whose media
 *  expired 12 months after its Call started or was purged, or that no
 *  longer exists is left untouched without calling OpenAI.
 *
 * @remarks
 *  The Recording row is locked only to commit the result, never while R2 or
 *  OpenAI is working, because the transfer task takes the same row lock
 *  with NOWAIT for Twilio cleanup; the commit re-checks the state and that
 *  the media is still retained under the lock, so neither a concurrent
 *  duplicate run nor a purge that committed meanwhile lets a Transcript
 *  land, and a failure after a purge or expiry ends cleanly without a
 *  Failed state, event, or retry. Only
 *  Transcript and Lead Assessment columns are written, so playback and the
 *  waveform are never affected. Usage is stored on the Recording rather
 *  than the Transcript because purge deletes the Transcript row while cost
 *  reporting must survive it. The Lead Assessment becomes Pending in the
 *  same commit so a crash before the request still leaves it for recovery,
 *  and a failed request is ignored for the same reason. A failure is
 *  recorded as Failed with a secret-free reason, never an unexpected
 *  error's message, and rethrown for Trigger.dev to retry. The Completed
 *  commit and the Failed update each append their Call event atomically,
 *  and a repeated failure keeps its single Transcript failed event.
 *
 * @see
 *  data/recording-wav.ts
 *  data/openai-client.ts
 *  data/transcript.ts
 *  data/recording-lead-assessment.ts
 *  trigger/recording-transcription.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Database } from "@/data/database";

import { appendCallEvent } from "@/data/call-events";
import { OpenAIError, transcriptionModel, type AudioTranscriber } from "@/data/openai-client";
import { R2ObjectError, type RecordingObjects } from "@/data/r2-objects";
import type { RecordingProcessing } from "@/data/recording";
import { recordingMediaRetainedSql } from "@/data/recording-media";
import { readRecordingAudio, RecordingAudioError } from "@/data/recording-wav";
import { normalizeTranscript, parseTranscriptTurns, TranscriptError, transcriptionCostUsd, type TranscribedChunk, type TranscriptTurn } from "@/data/transcript";

export interface RecordingTranscriptionDependencies {
  database: Database;
  objects: RecordingObjects;
  transcriber: AudioTranscriber;
  leadAssessment: RecordingProcessing;
  now: () => Date;
}

export class RecordingTranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingTranscriptionError";
  }
}

type TranscriptionRow = {
  id: string;
  organization_id: string;
  call_id: string;
  channels: 1 | 2;
  r2_object_key: string;
  transcript_state: string | null;
  media_retained: boolean;
};

const runnableStates = ["Pending", "Failed"];

function failureReason(error: unknown): string {
  const known = [OpenAIError, R2ObjectError, RecordingAudioError, TranscriptError, RecordingTranscriptionError];
  return known.some((type) => error instanceof type) ? (error as Error).message : "Transcription failed";
}

async function transcribe(deps: RecordingTranscriptionDependencies, row: TranscriptionRow): Promise<{ turns: TranscriptTurn[]; audioMs: number }> {
  const wav = await deps.objects.get(row.r2_object_key);
  if (!wav) throw new RecordingTranscriptionError("Recording object is missing from R2");
  const audio = readRecordingAudio(wav);
  if (audio.channels !== row.channels) throw new RecordingTranscriptionError("Recording audio does not match the Recording channels");
  const chunks: TranscribedChunk[] = [];
  let audioMs = 0;
  for (const chunk of audio.chunks()) {
    chunks.push({ speaker: chunk.speaker, offsetMs: chunk.offsetMs, segments: await deps.transcriber.transcribe(chunk.wav) });
    audioMs += chunk.durationMs;
  }
  return { turns: parseTranscriptTurns(normalizeTranscript(chunks)), audioMs };
}

async function complete(deps: RecordingTranscriptionDependencies, row: TranscriptionRow, result: { turns: TranscriptTurn[]; audioMs: number }): Promise<boolean> {
  return await deps.database.transaction(async (client) => {
    const now = deps.now();
    const locked = await client.query<{ transcript_state: string | null; media_retained: boolean }>(
      `select r.transcript_state, ${recordingMediaRetainedSql("r", "c.started_at", "$2")} as media_retained
         from recording r
         join call c on c.id = r.call_id
        where r.id = $1
          for update of r`,
      [row.id, now],
    );
    const current = locked.rows[0];
    if (!current?.media_retained || !runnableStates.includes(current.transcript_state ?? "")) {
      return false;
    }
    await client.query(
      "insert into transcript (recording_id, organization_id, call_id, turns, model, created_at) values ($1, $2, $3, $4, $5, $6)",
      [row.id, row.organization_id, row.call_id, JSON.stringify(result.turns), transcriptionModel, now],
    );
    await client.query(
      `update recording
          set transcript_state = 'Completed', transcript_failure_reason = null, transcript_audio_ms = $2, transcript_cost_usd = $3, transcript_completed_at = $4,
              lead_assessment_state = 'Pending', lead_assessment_failure_reason = null, updated_at = $4
        where id = $1`,
      [row.id, result.audioMs, transcriptionCostUsd(result.audioMs), now],
    );
    await appendCallEvent(client, { callId: row.call_id, kind: "transcript_completed", key: `transcript_completed:${row.id}`, occurredAt: now });
    return true;
  });
}

export async function transcribeRecording(deps: RecordingTranscriptionDependencies, recordingId: string): Promise<void> {
  const result = await deps.database.query<TranscriptionRow>(
    `select r.id, r.organization_id, r.call_id, r.channels, r.r2_object_key, r.transcript_state,
            ${recordingMediaRetainedSql("r", "c.started_at", "$2")} as media_retained
       from recording r
       join call c on c.id = r.call_id
      where r.id = $1 and r.transfer_state = 'Stored'`,
    [recordingId, deps.now()],
  );
  const row = result.rows[0];
  if (!row?.media_retained || !runnableStates.includes(row.transcript_state ?? "")) return;
  let completed: boolean;
  try {
    completed = await complete(deps, row, await transcribe(deps, row));
  } catch (error) {
    const failed = await deps.database.query<{ media_retained: boolean }>(
      `with failed as (
         update recording r set transcript_state = 'Failed', transcript_failure_reason = $2, updated_at = $3
           from call c
          where r.id = $1 and c.id = r.call_id and r.transcript_state in ('Pending', 'Failed') and ${recordingMediaRetainedSql("r", "c.started_at", "$3")}
          returning r.organization_id, r.workspace_id, r.call_id
       ), event as (
         insert into call_event (organization_id, workspace_id, call_id, kind, occurred_at, idempotency_key)
         select organization_id, workspace_id, call_id, 'transcript_failed', $3, 'transcript_failed:' || $1 from failed
         on conflict (organization_id, idempotency_key) do nothing
       )
       select ${recordingMediaRetainedSql("r", "c.started_at", "$3")} as media_retained
         from recording r
         join call c on c.id = r.call_id
        where r.id = $1`,
      [row.id, failureReason(error), deps.now()],
    );
    if (!failed.rows[0]?.media_retained) return;
    throw error;
  }
  if (completed) {
    await deps.leadAssessment.request({ id: row.id, organizationId: row.organization_id, idempotencyKey: `recording-lead-assessment:${row.id}` }).catch(() => undefined);
  }
}
