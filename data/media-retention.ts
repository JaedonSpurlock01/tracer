/**
 * -------------------------------------------------------------------------
 * @file   media-retention.ts
 * @brief  Deletes the content of expired or purged Recordings.
 *
 * @description
 *  Owns what removing a Recording's media means: its Transcript, the
 *  evidence quotes and rationale of its Lead Assessment, and its WAV,
 *  waveform peaks, and MP3 objects in R2. The Lead Assessment
 *  classification, score, summary, and usage, the Call and its events, the
 *  Recording metadata, Transcript usage and cost, and the Lead Review stay.
 *  The sweep selects up to 100 Stored Recordings, oldest first, whose media
 *  expired 12 months after the Call started or was purged by an Operator
 *  and whose cleanup has not finished, then for each deletes the database
 *  content in one transaction, deletes its R2 objects, and only when every
 *  delete succeeded records `media_deleted_at`.
 *
 * @remarks
 *  Database content goes first, so a later R2 failure never leaves readable
 *  Transcript text behind, and nothing is ever restored. Every step is
 *  idempotent: a missing row or object counts as already deleted, so a
 *  Recording whose R2 delete failed is retried whole on the next sweep. One
 *  Recording's failure is counted and never stops the batch. Object keys
 *  stay on the Recording as historical metadata. Recordings whose transfer
 *  is Pending or Failed may still have audio at Twilio and are left for the
 *  Twilio cleanup. The batch limit bounds R2 requests per sweep, and the
 *  rest are cleaned up on the next sweep. The runtime role may update only
 *  the Lead Assessment rationale, and a database trigger accepts only
 *  clearing it.
 *
 * @see
 *  data/recording-media.ts
 *  data/r2-objects.ts
 *  data/runtime-role.ts
 *  trigger/media-retention.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import type { ArtifactObjects } from "@/data/r2-objects";
import { recordingMediaExpiredSql } from "@/data/recording-media";

export const mediaRetentionBatchSize = 100;

export interface MediaRemovalDeps {
  pool: Pool;
  objects: Pick<ArtifactObjects, "delete">;
}

interface MediaRecording {
  id: string;
  r2_object_key: string | null;
  waveform_object_key: string | null;
  mp3_object_key: string | null;
}

async function deleteRecordingContent(pool: Pool, recordingId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("delete from transcript where recording_id = $1", [recordingId]);
    await client.query("delete from lead_assessment_evidence where lead_assessment_id in (select id from lead_assessment where recording_id = $1)", [recordingId]);
    await client.query("update lead_assessment set rationale = null where recording_id = $1 and rationale is not null", [recordingId]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function removeRecordingMedia(deps: MediaRemovalDeps, recording: MediaRecording, now: Date): Promise<void> {
  await deleteRecordingContent(deps.pool, recording.id);
  for (const key of [recording.r2_object_key, recording.waveform_object_key, recording.mp3_object_key]) {
    if (key) await deps.objects.delete(key);
  }
  await deps.pool.query("update recording set media_deleted_at = $2 where id = $1 and media_deleted_at is null", [recording.id, now]);
}

export async function sweepRecordingMedia(deps: MediaRemovalDeps, now: Date): Promise<{ selected: number; completed: number; failed: number }> {
  const due = await deps.pool.query<MediaRecording>(
    `select r.id, r.r2_object_key, r.waveform_object_key, r.mp3_object_key
       from recording r
       join call c on c.id = r.call_id
      where r.media_deleted_at is null and r.transfer_state = 'Stored'
        and (r.media_purged_at is not null or ${recordingMediaExpiredSql("c.started_at", "$1::timestamptz")})
      order by r.created_at, r.id
      limit $2`,
    [now, mediaRetentionBatchSize],
  );
  let failed = 0;
  for (const recording of due.rows) {
    try {
      await removeRecordingMedia(deps, recording, now);
    } catch {
      failed += 1;
    }
  }
  return { selected: due.rows.length, completed: due.rows.length - failed, failed };
}
