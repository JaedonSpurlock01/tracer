/**
 * -------------------------------------------------------------------------
 * @file   recording-media.ts
 * @brief  Finds a Recording's available private media and serves its peaks.
 *
 * @description
 *  Owns the media expiry rule: Recording media counts as Expired 12 months
 *  after its Call started. Loads a Recording scoped to its Organization and
 *  Workspace only while its WAV is Stored and its media has not expired,
 *  returning the WAV and, once the waveform is Stored, its peaks object.
 *  Serves the peaks JSON from the R2 binding as a private, uncached
 *  response. Callers authorize the Workspace first.
 *
 * @remarks
 *  Expiry is derived from the Call's start rather than stored, so no row is
 *  written or deleted when media expires; the Call, its facts, and the
 *  Recording metadata remain. Object keys never leave the server.
 *
 * @see
 *  data/recording-audio.ts
 *  data/recording-waveform.ts
 *  data/workspaces-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

export interface RecordingMediaBucket {
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<{ body: ReadableStream } | null>;
}

export interface AvailableRecordingMedia {
  audio: { key: string; sizeBytes: number };
  peaksKey: string | null;
}

export function recordingMediaExpiresAtSql(callStartedAt: string): string {
  return `(${callStartedAt} + interval '12 months')`;
}

export function recordingMediaExpiredSql(callStartedAt: string, now: string): string {
  return `(${recordingMediaExpiresAtSql(callStartedAt)} <= ${now})`;
}

export async function findAvailableRecordingMedia(
  pool: Pool,
  scope: { organizationId: string; workspaceId: string; recordingId: string },
): Promise<AvailableRecordingMedia | null> {
  const result = await pool.query<{ r2_object_key: string; size_bytes: string; waveform_object_key: string | null }>(
    `select r.r2_object_key, r.size_bytes, case when r.waveform_state = 'Stored' then r.waveform_object_key end as waveform_object_key
       from recording r
       join call c on c.id = r.call_id
      where r.id = $1 and r.organization_id = $2 and r.workspace_id = $3 and r.transfer_state = 'Stored'
        and not ${recordingMediaExpiredSql("c.started_at", "now()")}`,
    [scope.recordingId, scope.organizationId, scope.workspaceId],
  );
  const row = result.rows[0];
  return row ? { audio: { key: row.r2_object_key, sizeBytes: Number(row.size_bytes) }, peaksKey: row.waveform_object_key } : null;
}

export async function recordingPeaksResponse(bucket: RecordingMediaBucket, peaksKey: string): Promise<Response | null> {
  const object = await bucket.get(peaksKey);
  if (!object) return null;
  return new Response(object.body, { headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
}
