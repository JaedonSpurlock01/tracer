/**
 * -------------------------------------------------------------------------
 * @file   lead-reviews.ts
 * @brief  Saves and reads the one current Lead Review of a Call.
 *
 * @description
 *  Resolves the Workspace through the central Workspace authorization, then
 *  upserts the Call's single Lead Review with its classification, optional
 *  note, reviewer, and review time, so an update overwrites the previous
 *  review. Reads a Call's Lead Review with its reviewer's name for Call
 *  Detail.
 *
 * @remarks
 *  Only Operators reach the write; the handler refuses Client Viewers before
 *  any lookup. A Call outside the readable Workspace or Organization reads
 *  as Not Found, the same as Call Detail. The Lead Assessment is never
 *  touched, and review history waits for the M14 Activity log. Calls in
 *  Archived Workspaces stay reviewable because only live routing is frozen.
 *
 * @see
 *  data/lead-classification.ts
 *  data/call-details.ts
 *  data/workspace-authorization.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import type { Actor } from "@/data/authorization";
import type { LeadClassification, LeadReviewInput } from "@/data/lead-classification";
import { createReadableWorkspaces } from "@/data/workspace-authorization";
import { WorkspacesError } from "@/data/workspaces";

export interface LeadReview {
  classification: LeadClassification;
  note: string | null;
  reviewerName: string | null;
  reviewedAt: string;
}

type LeadReviewRow = { classification: LeadClassification; note: string | null; reviewer_name: string | null; reviewed_at: Date };

const reviewQuery = `select r.classification, r.note, u.name as reviewer_name, r.reviewed_at
   from lead_review r
   left join "user" u on u.id = r.reviewer_user_id
  where r.call_id = $1 and r.organization_id = $2`;

function toLeadReview(row: LeadReviewRow): LeadReview {
  return { classification: row.classification, note: row.note, reviewerName: row.reviewer_name, reviewedAt: row.reviewed_at.toISOString() };
}

export async function findLeadReview(pool: Pool, organizationId: string, callId: string): Promise<LeadReview | null> {
  const row = (await pool.query<LeadReviewRow>(reviewQuery, [callId, organizationId])).rows[0];
  return row ? toLeadReview(row) : null;
}

export async function saveLeadReview(pool: Pool, actor: Actor, workspaceId: string, callId: string, input: LeadReviewInput): Promise<LeadReview> {
  const workspace = await createReadableWorkspaces(pool, actor).find(workspaceId);
  if (!workspace) throw new WorkspacesError("not_found");
  const saved = await pool.query(
    `insert into lead_review (call_id, organization_id, classification, note, reviewer_user_id, reviewed_at)
     select c.id, c.organization_id, $4, $5, $6, $7 from call c
      where c.id = $1 and c.organization_id = $2 and c.workspace_id = $3
     on conflict (call_id) do update
        set classification = excluded.classification, note = excluded.note,
            reviewer_user_id = excluded.reviewer_user_id, reviewed_at = excluded.reviewed_at`,
    [callId, actor.organizationId, workspace.id, input.classification, input.note, actor.userId, new Date()],
  );
  if (!saved.rowCount) throw new WorkspacesError("not_found");
  const review = await findLeadReview(pool, actor.organizationId, callId);
  if (!review) throw new WorkspacesError("not_found");
  return review;
}
