/**
 * -------------------------------------------------------------------------
 * @file   recording-waveform.ts
 * @brief  Derives a Recording's waveform peaks and stores them in R2.
 *
 * @description
 *  Reads a Stored Recording's WAV from R2, generates its peaks, and stores
 *  them as one JSON object beside the WAV, then records the waveform as
 *  Stored. The peaks are normalized into the compact shape the waveform
 *  player consumes: one lane per channel, Caller and Business for a
 *  dual-channel Recording and one Mixed lane otherwise, each a series of
 *  peak amplitudes between 0 and 1. A Recording that is not Stored, no
 *  longer exists, or whose media expired 12 months after its Call started
 *  or was purged is skipped, and its Call and Recording metadata are left
 *  as they are. A
 *  rerun skips a Stored waveform whose object exists and otherwise
 *  overwrites the same key.
 *
 * @remarks
 *  Twilio places the parent call leg, the caller, on the first channel of a
 *  dual-channel Dial recording and the dialed Business leg on the second,
 *  so the first lane is Caller and the second is Business. Peaks are
 *  rounded to two decimals to keep long Calls small. The workflow writes
 *  only waveform columns and takes no row lock while generating, so it can
 *  never hold up or fail the transfer or Twilio cleanup; a concurrent
 *  duplicate run would write identical peaks to the same key. A failure is
 *  recorded as Failed with a secret-free reason and rethrown for
 *  Trigger.dev to retry. The peaks key is derived from the Recording's own
 *  key, so a later purge can delete it without a lookup. Because a purge
 *  can commit while peaks are generated, the Stored update re-checks that
 *  the media is retained, and when it matches nothing the run deletes the
 *  peaks it just uploaded and ends cleanly. A failure is recorded only
 *  while the media is still retained; otherwise the run ends cleanly
 *  without a Failed state or a retry.
 *
 * @see
 *  data/audiowaveform.ts
 *  data/recording-media.ts
 *  data/recording-transfer.ts
 *  trigger/recording-waveform.ts
 *  https://www.twilio.com/docs/voice/twiml/dial#record
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Database } from "@/data/database";

import { AudiowaveformError, type AudiowaveformData, type WaveformPeakGenerator } from "@/data/audiowaveform";
import { R2ObjectError, sha256Hex, type ArtifactObjects, type RecordingObjects } from "@/data/r2-objects";
import { recordingMediaRetainedSql } from "@/data/recording-media";
import { recordingObjectKey } from "@/data/recording-transfer";

export interface RecordingWaveformDependencies {
  database: Database;
  objects: RecordingObjects & Pick<ArtifactObjects, "delete">;
  peaks: WaveformPeakGenerator;
  now: () => Date;
}

export type WaveformLane = "Caller" | "Business" | "Mixed";

export interface WaveformPeaks {
  version: 1;
  sampleRate: number;
  samplesPerPixel: number;
  pixelsPerSecond: number;
  durationSeconds: number;
  lanes: WaveformLane[];
  peaks: number[][];
}

export class RecordingWaveformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingWaveformError";
  }
}

export function normalizeWaveformPeaks(data: AudiowaveformData, channels: 1 | 2): WaveformPeaks {
  if (data.channels !== channels) throw new RecordingWaveformError("Waveform peaks do not match the Recording channels");
  const fullScale = 2 ** (data.bits - 1);
  const peaks = Array.from({ length: channels }, (_, channel) =>
    Array.from({ length: data.length }, (_, point) => {
      const offset = (point * channels + channel) * 2;
      const amplitude = Math.max(Math.abs(data.data[offset]), Math.abs(data.data[offset + 1]));
      return Math.round(Math.min(amplitude / fullScale, 1) * 100) / 100;
    }),
  );
  return {
    version: 1,
    sampleRate: data.sample_rate,
    samplesPerPixel: data.samples_per_pixel,
    pixelsPerSecond: data.sample_rate / data.samples_per_pixel,
    durationSeconds: Math.round((data.length * data.samples_per_pixel * 1000) / data.sample_rate) / 1000,
    lanes: channels === 2 ? ["Caller", "Business"] : ["Mixed"],
    peaks,
  };
}

export function waveformObjectKey(recording: { id: string; organizationId: string; workspaceId: string; callId: string }): string {
  return recordingObjectKey(recording).replace(/\.wav$/, ".peaks.json");
}

type WaveformRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  call_id: string;
  channels: 1 | 2;
  r2_object_key: string;
  waveform_state: string;
  media_retained: boolean;
};

function failureReason(error: unknown): string {
  return error instanceof AudiowaveformError || error instanceof R2ObjectError || error instanceof RecordingWaveformError ? error.message : "Waveform generation failed";
}

async function storePeaks(deps: RecordingWaveformDependencies, row: WaveformRow, key: string): Promise<void> {
  const wav = await deps.objects.get(row.r2_object_key);
  if (!wav) throw new RecordingWaveformError("Recording object is missing from R2");
  const peaks = normalizeWaveformPeaks(await deps.peaks.generate(wav, { splitChannels: row.channels === 2 }), row.channels);
  const body = new TextEncoder().encode(JSON.stringify(peaks));
  await deps.objects.put(key, body, { sizeBytes: body.byteLength, sha256: await sha256Hex(body) }, "application/json");
}

export async function generateRecordingWaveform(deps: RecordingWaveformDependencies, recordingId: string): Promise<void> {
  const result = await deps.database.query<WaveformRow>(
    `select r.id, r.organization_id, r.workspace_id, r.call_id, r.channels, r.r2_object_key, r.waveform_state,
            ${recordingMediaRetainedSql("r", "c.started_at", "$2")} as media_retained
       from recording r
       join call c on c.id = r.call_id
      where r.id = $1 and r.transfer_state = 'Stored'`,
    [recordingId, deps.now()],
  );
  const row = result.rows[0];
  if (!row?.media_retained) return;
  const key = waveformObjectKey({ id: row.id, organizationId: row.organization_id, workspaceId: row.workspace_id, callId: row.call_id });
  if (row.waveform_state === "Stored" && (await deps.objects.head(key))) return;
  try {
    await storePeaks(deps, row, key);
  } catch (error) {
    const failed = await deps.database.query(
      `update recording r set waveform_state = 'Failed', waveform_failure_reason = $2, updated_at = $3
         from call c
        where r.id = $1 and c.id = r.call_id and ${recordingMediaRetainedSql("r", "c.started_at", "$3")}`,
      [row.id, failureReason(error), deps.now()],
    );
    if (failed.rowCount === 0) return;
    throw error;
  }
  const now = deps.now();
  const stored = await deps.database.query(
    `update recording r
        set waveform_state = 'Stored', waveform_object_key = $2, waveform_generated_at = $3, waveform_failure_reason = null, updated_at = $3
       from call c
      where r.id = $1 and c.id = r.call_id and ${recordingMediaRetainedSql("r", "c.started_at", "$3")}`,
    [row.id, key, now],
  );
  if (stored.rowCount === 0) await deps.objects.delete(key);
}
