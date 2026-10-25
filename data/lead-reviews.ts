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
 *  touched. Each add or update also appends its own Lead Review added Call
 *  event in the same statement, so the Call event log keeps the review
 *  history the single row overwrites. Calls in Archived Workspaces stay
 *  reviewable because only live routing is frozen.
 *
 * @see
 *  data/lead-classification.ts
 *  data/call-details.ts
 *  data/workspace-authorization.ts
 *  data/call-events.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Database } from "@/data/database";

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

export async function findLeadReview(database: Database, organizationId: string, callId: string): Promise<LeadReview | null> {
  const row = (await database.query<LeadReviewRow>(reviewQuery, [callId, organizationId])).rows[0];
  return row ? toLeadReview(row) : null;
}

export async function saveLeadReview(database: Database, actor: Actor, workspaceId: string, callId: string, input: LeadReviewInput): Promise<LeadReview> {
  const workspace = await createReadableWorkspaces(database, actor).find(workspaceId);
  if (!workspace) throw new WorkspacesError("not_found");
  const saved = await database.query(
    `with saved as (
       insert into lead_review (call_id, organization_id, classification, note, reviewer_user_id, reviewed_at)
       select c.id, c.organization_id, $4, $5, $6, $7 from call c
        where c.id = $1 and c.organization_id = $2 and c.workspace_id = $3
       on conflict (call_id) do update
          set classification = excluded.classification, note = excluded.note,
              reviewer_user_id = excluded.reviewer_user_id, reviewed_at = excluded.reviewed_at
       returning call_id, organization_id, classification, reviewer_user_id, reviewed_at
     )
     insert into call_event (organization_id, workspace_id, call_id, kind, occurred_at, detail, actor_user_id, idempotency_key)
     select saved.organization_id, $3, saved.call_id, 'lead_review_added', saved.reviewed_at, jsonb_build_object('classification', saved.classification), saved.reviewer_user_id, $8
       from saved`,
    [callId, actor.organizationId, workspace.id, input.classification, input.note, actor.userId, new Date(), `lead_review_added:${callId}:${randomUUID()}`],
  );
  if (!saved.rowCount) throw new WorkspacesError("not_found");
  const review = await findLeadReview(database, actor.organizationId, callId);
  if (!review) throw new WorkspacesError("not_found");
  return review;
}
