/**
 * -------------------------------------------------------------------------
 * @file   recording-media.ts
 * @brief  Finds a Recording's available private media and serves its peaks and MP3.
 *
 * @description
 *  Owns the media expiry rule: Recording media counts as Expired 12 months
 *  after its Call started. States in one SQL predicate whether a
 *  Recording's media is still retained, neither purged nor expired, which
 *  every processing writer and the recovery sweep check before writing
 *  content. Loads a Recording scoped to its Organization and
 *  Workspace only while its WAV is Stored, its media has not expired, and
 *  an Operator has not purged it,
 *  returning the WAV and, once each is Stored, its peaks and MP3 objects.
 *  Serves the peaks JSON from the R2 binding as a private, uncached
 *  response, and the MP3 as a private, uncached attachment named
 *  `tracer-call-{callId}.mp3`. Callers authorize the Workspace first. Also states Recording
 *  availability in SQL so lists can filter on the same Ready, Processing,
 *  Failed, Unavailable, or Expired state that Call Detail derives.
 *
 * @remarks
 *  Expiry is derived from the Call's start rather than stored, so reads hide
 *  expired media at once, before the daily media retention sweep deletes
 *  its content; the Call, its facts, and the Recording metadata remain.
 *  A purged Recording is refused from the moment its purge commits, even
 *  while its R2 objects still wait for the sweep.
 *  Object keys never leave the server, and the
 *  download filename uses the Call's id rather than the caller's number so
 *  no personal data lands in a browser's download history. The SQL
 *  availability state follows the same precedence as `recordingAvailability`
 *  in data/call-details.ts: no Recording, then Expired, then a failed or
 *  pending transfer, then a pending waveform.
 *
 * @see
 *  data/recording-audio.ts
 *  data/recording-waveform.ts
 *  data/recording-mp3.ts
 *  data/workspaces-handler.ts
 *  data/call-details.ts
 *  data/media-retention.ts
 *  data/media-purge.ts
 *  data/recording-recovery.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

export interface RecordingMediaBucket {
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<{ body: ReadableStream } | null>;
  delete(key: string): Promise<void>;
}

export interface AvailableRecordingMedia {
  audio: { key: string; sizeBytes: number };
  peaksKey: string | null;
  mp3: { key: string; sizeBytes: number; callId: string } | null;
}

export function recordingMediaExpiresAtSql(callStartedAt: string): string {
  return `(${callStartedAt} + interval '12 months')`;
}

export function recordingMediaExpiredSql(callStartedAt: string, now: string): string {
  return `(${recordingMediaExpiresAtSql(callStartedAt)} <= ${now})`;
}

export function recordingMediaRetainedSql(recording: string, callStartedAt: string, now: string): string {
  return `(${recording}.media_purged_at is null and not ${recordingMediaExpiredSql(callStartedAt, now)})`;
}

export function recordingAvailabilitySql(recording: string, callStartedAt: string): string {
  return `case
    when ${recording}.id is null then 'Unavailable'
    when ${recordingMediaExpiredSql(callStartedAt, "now()")} then 'Expired'
    when ${recording}.transfer_state = 'Failed' then 'Failed'
    when ${recording}.transfer_state = 'Pending' or ${recording}.waveform_state = 'Pending' then 'Processing'
    else 'Ready'
  end`;
}

export async function findAvailableRecordingMedia(
  pool: Pool,
  scope: { organizationId: string; workspaceId: string; recordingId: string },
): Promise<AvailableRecordingMedia | null> {
  const result = await pool.query<{ r2_object_key: string; size_bytes: string; waveform_object_key: string | null; call_id: string; mp3_object_key: string | null; mp3_size_bytes: string | null }>(
    `select r.r2_object_key, r.size_bytes, case when r.waveform_state = 'Stored' then r.waveform_object_key end as waveform_object_key,
            r.call_id, case when r.mp3_state = 'Stored' then r.mp3_object_key end as mp3_object_key, r.mp3_size_bytes
       from recording r
       join call c on c.id = r.call_id
      where r.id = $1 and r.organization_id = $2 and r.workspace_id = $3 and r.transfer_state = 'Stored' and r.media_purged_at is null
        and not ${recordingMediaExpiredSql("c.started_at", "now()")}`,
    [scope.recordingId, scope.organizationId, scope.workspaceId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    audio: { key: row.r2_object_key, sizeBytes: Number(row.size_bytes) },
    peaksKey: row.waveform_object_key,
    mp3: row.mp3_object_key ? { key: row.mp3_object_key, sizeBytes: Number(row.mp3_size_bytes), callId: row.call_id } : null,
  };
}

export async function recordingPeaksResponse(bucket: RecordingMediaBucket, peaksKey: string): Promise<Response | null> {
  const object = await bucket.get(peaksKey);
  if (!object) return null;
  return new Response(object.body, { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
}

export async function recordingMp3Response(bucket: RecordingMediaBucket, mp3: NonNullable<AvailableRecordingMedia["mp3"]>): Promise<Response | null> {
  const object = await bucket.get(mp3.key);
  if (!object) return null;
  return new Response(object.body, {
    headers: {
      "content-type": "audio/mpeg",
      "content-length": String(mp3.sizeBytes),
      "content-disposition": `attachment; filename="tracer-call-${mp3.callId}.mp3"`,
      "cache-control": "private, no-store",
    },
  });
}
