/**
 * -------------------------------------------------------------------------
 * @file   analysis-retry.ts
 * @brief  Requests a failed Transcript or Lead Assessment again for an Operator.
 *
 * @description
 *  Resolves the Workspace through the central Workspace authorization and
 *  selects the same Recording Call Detail shows. A Failed Transcript gets a
 *  transcription request, otherwise a Failed Lead Assessment gets a Lead
 *  Assessment request, each with its Recording-derived idempotency key.
 *  Anything else, including a Recording whose media expired, has nothing
 *  to retry.
 *
 * @remarks
 *  The state stays Failed when the request is made, because both tasks run
 *  from Failed and the recovery sweep still finds it if the run never
 *  starts. Reusing the idempotency key means a repeated Retry while a run is
 *  in progress does not start a second one. A failed request surfaces as a
 *  provider error without the Trigger.dev error, which could carry the
 *  request's credentials.
 *
 * @see
 *  data/call-details.ts
 *  data/recording-processing.ts
 *  data/recording-recovery.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import type { Actor } from "@/data/authorization";
import type { RecordingProcessing } from "@/data/recording";
import { recordingMediaExpiredSql } from "@/data/recording-media";
import { createReadableWorkspaces } from "@/data/workspace-authorization";

export type AnalysisRetryStage = "transcription" | "lead_assessment";

export type AnalysisRetryResult = { stage: AnalysisRetryStage } | "not_found" | "nothing_to_retry";

export class AnalysisRetryError extends Error {
  constructor() {
    super("provider_unavailable");
    this.name = "AnalysisRetryError";
  }
}

export interface AnalysisRetryRequests {
  transcription: RecordingProcessing | undefined;
  leadAssessment: RecordingProcessing | undefined;
}

export async function retryCallAnalysis(pool: Pool, actor: Actor, workspaceId: string, callId: string, requests: AnalysisRetryRequests): Promise<AnalysisRetryResult> {
  const workspace = await createReadableWorkspaces(pool, actor).find(workspaceId);
  if (!workspace) return "not_found";
  const result = await pool.query<{ recording_id: string | null; transcript_state: string | null; lead_assessment_state: string | null; expired: boolean | null }>(
    `select r.id as recording_id, r.transcript_state, r.lead_assessment_state, ${recordingMediaExpiredSql("c.started_at", "now()")} as expired
       from call c
       left join lateral (
         select id, transcript_state, lead_assessment_state from recording
          where call_id = c.id and organization_id = c.organization_id
          order by source = 'connected' desc, created_at
          limit 1
       ) r on true
      where c.id = $1 and c.organization_id = $2 and c.workspace_id = $3`,
    [callId, actor.organizationId, workspace.id],
  );
  const row = result.rows[0];
  if (!row) return "not_found";
  if (!row.recording_id || row.expired) return "nothing_to_retry";
  const stage: AnalysisRetryStage | null = row.transcript_state === "Failed" ? "transcription" : row.lead_assessment_state === "Failed" ? "lead_assessment" : null;
  if (!stage) return "nothing_to_retry";
  const processing = stage === "transcription" ? requests.transcription : requests.leadAssessment;
  const keyPrefix = stage === "transcription" ? "recording-transcription" : "recording-lead-assessment";
  if (!processing) throw new AnalysisRetryError();
  try {
    await processing.request({ id: row.recording_id, organizationId: actor.organizationId, idempotencyKey: `${keyPrefix}:${row.recording_id}` });
  } catch {
    throw new AnalysisRetryError();
  }
  return { stage };
}
