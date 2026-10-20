/**
 * -------------------------------------------------------------------------
 * @file   recording-mp3.ts
 * @brief  Derives a Recording's downloadable MP3 and stores it in R2.
 *
 * @description
 *  Reads a Stored Recording's WAV from R2, encodes it as an MP3 that keeps
 *  its channels, stores the MP3 beside the WAV and its peaks, verifies the
 *  stored size and SHA-256 checksum, and records the MP3 as Stored with its
 *  size. A Recording that is not Stored, no longer exists, or whose media
 *  expired 12 months after its Call started is skipped without producing a
 *  file, and its Call and Recording metadata are left as they are. A rerun
 *  skips a Stored MP3 whose object exists at its recorded size and
 *  otherwise overwrites the same key.
 *
 * @remarks
 *  The WAV stays authoritative; the MP3 is a derived download copy, like
 *  the waveform peaks. The workflow writes only MP3 columns and takes no row
 *  lock while encoding, so it can never hold up or fail the transfer or
 *  Twilio cleanup; a concurrent duplicate run would write an identical MP3
 *  to the same key. The WAV and MP3 are buffered in memory, as for the
 *  waveform, while ffmpeg works on temporary files. A failure is recorded
 *  as Failed with a secret-free reason and rethrown for Trigger.dev to
 *  retry. The MP3 key is derived from the Recording's own key, so a later
 *  purge can delete it without a lookup.
 *
 * @see
 *  data/ffmpeg.ts
 *  data/recording-media.ts
 *  data/recording-waveform.ts
 *  trigger/recording-mp3.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import { FfmpegError, type Mp3Encoder } from "@/data/ffmpeg";
import { R2ObjectError, sha256Hex, type RecordingObjects } from "@/data/r2-objects";
import { recordingMediaExpiredSql } from "@/data/recording-media";
import { recordingObjectKey } from "@/data/recording-transfer";

export interface RecordingMp3Dependencies {
  pool: Pool;
  objects: RecordingObjects;
  encoder: Mp3Encoder;
  now: () => Date;
}

export function mp3ObjectKey(recording: { id: string; organizationId: string; workspaceId: string; callId: string }): string {
  return recordingObjectKey(recording).replace(/\.wav$/, ".mp3");
}

export class RecordingMp3Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingMp3Error";
  }
}

type Mp3Row = {
  id: string;
  organization_id: string;
  workspace_id: string;
  call_id: string;
  r2_object_key: string;
  mp3_state: string;
  mp3_size_bytes: string | null;
  media_expired: boolean;
};

function failureReason(error: unknown): string {
  return error instanceof FfmpegError || error instanceof R2ObjectError || error instanceof RecordingMp3Error ? error.message : "MP3 encoding failed";
}

async function storeMp3(deps: RecordingMp3Dependencies, row: Mp3Row, key: string): Promise<number> {
  const wav = await deps.objects.get(row.r2_object_key);
  if (!wav) throw new RecordingMp3Error("Recording object is missing from R2");
  const mp3 = await deps.encoder.encode(wav);
  const object = { sizeBytes: mp3.byteLength, sha256: await sha256Hex(mp3) };
  await deps.objects.put(key, mp3, object, "audio/mpeg");
  const stored = await deps.objects.head(key);
  if (stored?.sizeBytes !== object.sizeBytes || stored.sha256 !== object.sha256) throw new RecordingMp3Error("R2 MP3 object does not match the encoded MP3");
  return object.sizeBytes;
}

export async function generateRecordingMp3(deps: RecordingMp3Dependencies, recordingId: string): Promise<void> {
  const result = await deps.pool.query<Mp3Row>(
    `select r.id, r.organization_id, r.workspace_id, r.call_id, r.r2_object_key, r.mp3_state, r.mp3_size_bytes,
            ${recordingMediaExpiredSql("c.started_at", "$2")} as media_expired
       from recording r
       join call c on c.id = r.call_id
      where r.id = $1 and r.transfer_state = 'Stored'`,
    [recordingId, deps.now()],
  );
  const row = result.rows[0];
  if (!row || row.media_expired) return;
  const key = mp3ObjectKey({ id: row.id, organizationId: row.organization_id, workspaceId: row.workspace_id, callId: row.call_id });
  if (row.mp3_state === "Stored" && (await deps.objects.head(key))?.sizeBytes === Number(row.mp3_size_bytes)) return;
  let sizeBytes: number;
  try {
    sizeBytes = await storeMp3(deps, row, key);
  } catch (error) {
    await deps.pool.query("update recording set mp3_state = 'Failed', mp3_failure_reason = $2, updated_at = $3 where id = $1", [row.id, failureReason(error), deps.now()]);
    throw error;
  }
  const now = deps.now();
  await deps.pool.query(
    `update recording
        set mp3_state = 'Stored', mp3_object_key = $2, mp3_size_bytes = $3, mp3_generated_at = $4, mp3_failure_reason = null, updated_at = $4
      where id = $1`,
    [row.id, key, sizeBytes, now],
  );
}
