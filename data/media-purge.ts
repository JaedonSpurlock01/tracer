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
 *  event. The same transaction expires every unexpired Recording ZIP and
 *  Export Call artifact that holds that Recording, so its download is
 *  refused and Report history offers Regenerate. After the commit it
 *  removes every stored copy of the media, the WAV, waveform peaks, and
 *  MP3 in R2 and the Twilio copy while Twilio cleanup is not Deleted,
 *  records the cleanup as finished, and deletes the expired ZIP objects.
 *  A Call without a Recording, one whose media already expired, and one
 *  already purged have nothing to purge.
 *
 * @remarks
 *  The purge marker is set by a conditional update, so of two concurrent
 *  purges exactly one commits and the other reads as already purged. That
 *  update waits on any processing run holding the Recording row, and the
 *  stored copies are read after the commit, so content stored just before
 *  the purge is deleted rather than orphaned. Media reads and downloads
 *  refuse a purged Recording and its ZIPs from the moment the purge
 *  commits, so every delete afterwards is best effort: a failure is logged
 *  and left to the daily media retention sweep, which finishes every purged
 *  Recording whose cleanup has not finished, and to the report lifecycle
 *  sweep and the 7-day R2 lifecycle rule for ZIP objects. A ZIP records the
 *  Recordings it included; one completed before that was recorded is
 *  treated as holding the Recording when its Workspaces and request time
 *  could have matched the Call. A ZIP still generating when the purge
 *  commits re-checks each Recording and refuses to complete holding a
 *  purged one. The job is expired rather than its file, because Report
 *  history derives Expired from the job and a ZIP job has no other file.
 *  The Worker already holds the credential master key, so it calls Twilio
 *  directly; without it, the Twilio copy is left to the sweep. The Call,
 *  its facts and outcome, the Recording metadata, the rest of the Lead
 *  Assessment, the Lead Review, and analytics stay.
 *
 * @see
 *  data/media-retention.ts
 *  data/recording-media.ts
 *  data/call-events.ts
 *  data/analysis-retry.ts
 *  data/report-jobs.ts
 *  data/report-lifecycle.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import type { Actor } from "@/data/authorization";
import { appendCallEvent } from "@/data/call-events";
import { deleteRecordingContent, deleteRecordingCopies, type MediaRemovalDeps } from "@/data/media-retention";
import { recordingMediaExpiredSql } from "@/data/recording-media";
import { createReadableWorkspaces } from "@/data/workspace-authorization";

export type MediaPurgeResult = { purgedAt: string } | "not_found" | "no_recording" | "media_expired" | "already_purged";

export interface MediaPurgeDeps {
  pool: Pool;
  objects?: MediaRemovalDeps["objects"];
  twilio?: MediaRemovalDeps["twilio"];
  masterKey?: string;
}

type PurgeRow = { id: string | null; call_id: string; workspace_id: string; started_at: Date; media_purged_at: Date | null; expired: boolean };

export async function purgeCallMedia(deps: MediaPurgeDeps, actor: Actor, workspaceId: string, callId: string, now: Date): Promise<MediaPurgeResult> {
  const workspace = await createReadableWorkspaces(deps.pool, actor).find(workspaceId);
  if (!workspace) return "not_found";
  const result = await deps.pool.query<PurgeRow>(
    `select c.id as call_id, c.workspace_id, c.started_at, r.id, r.media_purged_at,
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

  let artifactKeys: string[] = [];
  const client = await deps.pool.connect();
  try {
    await client.query("begin");
    const marked = await client.query(
      "update recording set media_purged_at = $2, media_purged_by_user_id = $3 where id = $1 and media_purged_at is null",
      [row.id, now, actor.userId],
    );
    if (marked.rowCount === 0) {
      await client.query("rollback");
      return "already_purged";
    }
    await deleteRecordingContent(client, row.id);
    await appendCallEvent(client, { callId: row.call_id, kind: "media_purged", key: `media_purged:${row.id}`, occurredAt: now, actorUserId: actor.userId });
    const expired = await client.query<{ r2_key: string }>(
      `update report_job j set artifacts_expire_at = $2
         from report_artifact a
        where a.job_id = j.id and a.file_kind = 'zip' and j.organization_id = $3 and j.status = 'Completed' and j.artifacts_expire_at > $2
          and ($1 = any(a.included_recording_ids)
               or (a.included_recording_ids is null and $4 = any(j.workspace_ids) and j.requested_at > $5
                   and coalesce(j.parameters->'selection'->>'callId', $6) = $6))
       returning a.r2_key`,
      [row.id, now, actor.organizationId, row.workspace_id, row.started_at, row.call_id],
    );
    artifactKeys = expired.rows.map(({ r2_key }) => r2_key);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  if (deps.objects) {
    try {
      await deleteRecordingCopies({ pool: deps.pool, objects: deps.objects, twilio: deps.twilio, masterKey: deps.masterKey }, row.id, now);
    } catch (error) {
      console.error("Purged Recording media cleanup failed; the media retention sweep will retry it", error);
    }
    for (const key of artifactKeys) {
      await deps.objects.delete(key).catch((error: unknown) => console.error("Purged Recording export cleanup failed; the report lifecycle sweep will retry it", error));
    }
  }
  return { purgedAt: now.toISOString() };
}
