/**
 * -------------------------------------------------------------------------
 * @file   media-retention.ts
 * @brief  Deletes the content of expired or purged Recordings.
 *
 * @description
 *  Owns what removing a Recording's media means: its Transcript, the
 *  evidence quotes and rationale of its Lead Assessment, and its WAV,
 *  waveform peaks, and MP3 objects in R2, and the copy of its audio still
 *  at Twilio. The Lead Assessment classification, score, summary, and
 *  usage, the Call and its events, the Recording metadata, Transcript
 *  usage and cost, and the Lead Review stay. The sweep is the one cleanup
 *  owner: it selects up to 100 Recordings, oldest first, whose media
 *  expired 12 months after the Call started or was purged by an Operator
 *  and whose cleanup has not finished, whatever their transfer state, then
 *  for each deletes the database content in one transaction and removes
 *  every stored copy: the R2 objects it has keys for and, while Twilio
 *  cleanup is not Deleted, the Twilio Recording with the Organization's
 *  credential, recording Twilio cleanup Deleted with its time. Only when
 *  every copy is gone does it record `media_deleted_at`. The content step
 *  runs inside a caller's transaction and the stored copies step runs on
 *  its own, so the Operator Purge Media service removes exactly the same
 *  content.
 *
 * @remarks
 *  Database content goes first, so a later R2 or Twilio failure never
 *  leaves readable Transcript text behind, and nothing is ever restored.
 *  Every step is idempotent: a missing row or object, and a Twilio
 *  Recording Twilio no longer has, counts as already deleted, so a
 *  Recording whose delete failed is retried whole on the next sweep. One
 *  Recording's failure is counted and never stops the batch. The stored
 *  copies step reads the Recording itself and acts only when its media is
 *  purged or expired, so it can never delete the Twilio copy of retained
 *  media. A caller without Twilio access, such as a Worker missing the
 *  credential master key, still deletes the R2 objects and leaves the
 *  Twilio copy and the finished marker to the sweep. Object keys stay on
 *  the Recording as historical metadata. A Twilio cleanup failure recorded
 *  by the transfer is cleared with it, while a transfer failure stays. The
 *  batch limit bounds R2 and Twilio requests per sweep, and the rest are
 *  cleaned up on the next sweep. The runtime role may update only the Lead
 *  Assessment rationale, and a database trigger accepts only clearing it.
 *
 * @see
 *  data/recording-media.ts
 *  data/media-purge.ts
 *  data/r2-objects.ts
 *  data/twilio-client.ts
 *  data/recording-transfer.ts
 *  data/runtime-role.ts
 *  trigger/media-retention.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool, PoolClient } from "pg";

import { decryptSecret } from "@/data/credential-encryption";
import type { ArtifactObjects } from "@/data/r2-objects";
import { recordingMediaExpiredSql, recordingMediaRetainedSql } from "@/data/recording-media";
import type { TwilioRecordingMedia } from "@/data/twilio-client";

export const mediaRetentionBatchSize = 100;

export interface MediaRemovalDeps {
  pool: Pool;
  objects: Pick<ArtifactObjects, "delete">;
  twilio: Pick<TwilioRecordingMedia, "deleteRecording">;
  masterKey: string;
}

type RecordingCopies = {
  r2_object_key: string | null;
  waveform_object_key: string | null;
  mp3_object_key: string | null;
  twilio_recording_sid: string;
  twilio_cleanup_state: string;
  account_sid: string | null;
  api_key_sid: string | null;
  api_key_secret_ciphertext: string | null;
};

export async function deleteRecordingContent(client: Pick<PoolClient, "query">, recordingId: string): Promise<void> {
  await client.query("delete from transcript where recording_id = $1", [recordingId]);
  await client.query("delete from lead_assessment_evidence where lead_assessment_id in (select id from lead_assessment where recording_id = $1)", [recordingId]);
  await client.query("update lead_assessment set rationale = null where recording_id = $1 and rationale is not null", [recordingId]);
}

async function deleteTwilioCopy(deps: Pick<MediaRemovalDeps, "pool" | "twilio" | "masterKey">, recordingId: string, copies: RecordingCopies, now: Date): Promise<void> {
  if (!copies.account_sid || !copies.api_key_sid || !copies.api_key_secret_ciphertext) throw new Error("Twilio is not connected");
  const credential = { accountSid: copies.account_sid, apiKeySid: copies.api_key_sid, apiKeySecret: await decryptSecret(deps.masterKey, copies.api_key_secret_ciphertext) };
  await deps.twilio.deleteRecording(credential, copies.twilio_recording_sid);
  await deps.pool.query(
    `update recording
        set twilio_cleanup_state = 'Deleted', twilio_deleted_at = $2, updated_at = $2,
            failure_stage = case when failure_stage = 'cleanup' then null else failure_stage end,
            failure_reason = case when failure_stage = 'cleanup' then null else failure_reason end
      where id = $1 and twilio_cleanup_state <> 'Deleted'`,
    [recordingId, now],
  );
}

export async function deleteRecordingCopies(
  deps: Pick<MediaRemovalDeps, "pool" | "objects"> & Partial<Pick<MediaRemovalDeps, "twilio" | "masterKey">>,
  recordingId: string,
  now: Date,
): Promise<void> {
  const copies = (await deps.pool.query<RecordingCopies>(
    `select r.r2_object_key, r.waveform_object_key, r.mp3_object_key, r.twilio_recording_sid, r.twilio_cleanup_state,
            t.account_sid, t.api_key_sid, t.api_key_secret_ciphertext
       from recording r
       join call c on c.id = r.call_id
       left join twilio_connection t on t.organization_id = r.organization_id
      where r.id = $1 and r.media_deleted_at is null and not ${recordingMediaRetainedSql("r", "c.started_at", "$2::timestamptz")}`,
    [recordingId, now],
  )).rows[0];
  if (!copies) return;
  for (const key of [copies.r2_object_key, copies.waveform_object_key, copies.mp3_object_key]) {
    if (key) await deps.objects.delete(key);
  }
  if (copies.twilio_cleanup_state !== "Deleted") {
    if (!deps.twilio || !deps.masterKey) return;
    await deleteTwilioCopy({ pool: deps.pool, twilio: deps.twilio, masterKey: deps.masterKey }, recordingId, copies, now);
  }
  await deps.pool.query("update recording set media_deleted_at = $2 where id = $1 and media_deleted_at is null", [recordingId, now]);
}

async function removeRecordingMedia(deps: MediaRemovalDeps, recordingId: string, now: Date): Promise<void> {
  const client = await deps.pool.connect();
  try {
    await client.query("begin");
    await deleteRecordingContent(client, recordingId);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  await deleteRecordingCopies(deps, recordingId, now);
}

export async function sweepRecordingMedia(deps: MediaRemovalDeps, now: Date): Promise<{ selected: number; completed: number; failed: number }> {
  const due = await deps.pool.query<{ id: string }>(
    `select r.id
       from recording r
       join call c on c.id = r.call_id
      where r.media_deleted_at is null
        and (r.media_purged_at is not null or ${recordingMediaExpiredSql("c.started_at", "$1::timestamptz")})
      order by r.created_at, r.id
      limit $2`,
    [now, mediaRetentionBatchSize],
  );
  let failed = 0;
  for (const recording of due.rows) {
    try {
      await removeRecordingMedia(deps, recording.id, now);
    } catch {
      failed += 1;
    }
  }
  return { selected: due.rows.length, completed: due.rows.length - failed, failed };
}
