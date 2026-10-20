/**
 * -------------------------------------------------------------------------
 * @file   media-purge.ts
 * @brief  Purges a Call's Recording media early for an Operator.
 *
 * @description
 *  Resolves the Workspace through the central Workspace authorization and
 *  selects the same Recording Call Detail shows. In one transaction it marks
 *  that Recording purged with the time and the purging Operator, deletes
 *  the content media retention owns (the Transcript, the Lead Assessment
 *  evidence quotes, and its rationale), and appends a Media purged Call
 *  event. After the commit it deletes the WAV, waveform peaks, and MP3 from
 *  R2 and records the cleanup as finished. A Call without a Recording, one
 *  whose media already expired, and one already purged have nothing to
 *  purge.
 *
 * @remarks
 *  The purge marker is set by a conditional update, so of two concurrent
 *  purges exactly one commits and the other reads as already purged. The
 *  object keys and transfer state to delete come from that update, after
 *  it waited on any processing run holding the Recording row, so content
 *  stored just before the purge is deleted rather than orphaned. Media
 *  reads refuse a purged Recording from the moment the purge commits, so
 *  the R2 delete is best effort: a failure is logged and left to the daily
 *  media retention sweep, which finishes every purged Recording whose
 *  cleanup has not finished. A Recording whose transfer is Pending or
 *  Failed may be purged, which makes its content unreachable, but has no
 *  stored objects to delete here. The Call, its facts and outcome, the
 *  Recording metadata, the rest of the Lead Assessment, the Lead Review,
 *  and analytics stay.
 *
 * @see
 *  data/media-retention.ts
 *  data/recording-media.ts
 *  data/call-events.ts
 *  data/analysis-retry.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import type { Actor } from "@/data/authorization";
import { appendCallEvent } from "@/data/call-events";
import { deleteRecordingContent, deleteRecordingObjects, type MediaRecording, type MediaRemovalDeps } from "@/data/media-retention";
import { recordingMediaExpiredSql } from "@/data/recording-media";
import { createReadableWorkspaces } from "@/data/workspace-authorization";

export type MediaPurgeResult = { purgedAt: string } | "not_found" | "no_recording" | "media_expired" | "already_purged";

export interface MediaPurgeDeps {
  pool: Pool;
  objects?: MediaRemovalDeps["objects"];
}

type PurgeRow = { id: string | null; call_id: string; media_purged_at: Date | null; expired: boolean };

type PurgedRecording = MediaRecording & { transfer_state: string | null };

export async function purgeCallMedia(deps: MediaPurgeDeps, actor: Actor, workspaceId: string, callId: string, now: Date): Promise<MediaPurgeResult> {
  const workspace = await createReadableWorkspaces(deps.pool, actor).find(workspaceId);
  if (!workspace) return "not_found";
  const result = await deps.pool.query<PurgeRow>(
    `select c.id as call_id, r.id, r.media_purged_at,
            ${recordingMediaExpiredSql("c.started_at", "$4::timestamptz")} as expired
       from call c
       left join lateral (
         select id, media_purged_at from recording
          where call_id = c.id and organization_id = c.organization_id
          order by source = 'connected' desc, created_at
          limit 1
       ) r on true
      where c.id = $1 and c.organization_id = $2 and c.workspace_id = $3`,
    [callId, actor.organizationId, workspace.id, now],
  );
  const row = result.rows[0];
  if (!row) return "not_found";
  if (!row.id) return "no_recording";
  if (row.media_purged_at) return "already_purged";
  if (row.expired) return "media_expired";

  let purged: PurgedRecording | undefined;
  const client = await deps.pool.connect();
  try {
    await client.query("begin");
    const marked = await client.query<PurgedRecording>(
      `update recording set media_purged_at = $2, media_purged_by_user_id = $3 where id = $1 and media_purged_at is null
       returning id, transfer_state, r2_object_key, waveform_object_key, mp3_object_key`,
      [row.id, now, actor.userId],
    );
    purged = marked.rows[0];
    if (!purged) {
      await client.query("rollback");
      return "already_purged";
    }
    await deleteRecordingContent(client, row.id);
    await appendCallEvent(client, { callId: row.call_id, kind: "media_purged", key: `media_purged:${row.id}`, occurredAt: now, actorUserId: actor.userId });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  if (deps.objects && purged.transfer_state === "Stored") {
    try {
      await deleteRecordingObjects({ pool: deps.pool, objects: deps.objects }, purged, now);
    } catch (error) {
      console.error("Purged Recording media cleanup failed; the media retention sweep will retry it", error);
    }
  }
  return { purgedAt: now.toISOString() };
}
