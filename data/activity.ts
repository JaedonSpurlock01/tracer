/**
 * -------------------------------------------------------------------------
 * @file   activity.ts
 * @brief  Lists the Activity entries an actor may read, one per Call.
 *
 * @description
 *  Activity covers every Workspace the actor can read: all Organization
 *  Workspaces for an Operator and only granted Active or Archived
 *  Workspaces for a Client Viewer. Each entry is one Call, Started
 *  descending, carrying the Calls row fields, the calendar day it started
 *  in the user's timezone, a cursor, and its steps. Without a date filter
 *  the first page starts at local midnight six days back, so it covers the
 *  last 7 calendar days; Load more asks for the Calls before the oldest
 *  loaded one with no lower bound, and a refresh asks for every Call
 *  through it.
 *
 * @remarks
 *  Authorization and filtering reuse the Calls readable Workspace condition
 *  and filter compiler, so a filter can only narrow the readable scope.
 *  Paging is keyset over start time and id, both descending, so Calls
 *  arriving at the top never shift a later page. A page reads its Calls in
 *  one query and all their Call events in a second, never one query per
 *  Call, plus two existence checks for Load more and for no Activity at
 *  all. Steps are the events that occurred, in occurrence order with the
 *  event id breaking ties; only the latest Call completed is kept, because
 *  a later one corrects the outcome. Steps carry only display-safe facts:
 *  the outcome, the classification, and the Lead Review reviewer's name,
 *  which Call Detail also shows to Client Viewers. Two kinds of step come
 *  from the selected Recording's state at read time rather than from an
 *  event: Transcript expired once its media expires 12 months after the
 *  Call started with a completed Transcript, and one neutral pending step
 *  for the first unfinished stage of Recording transfer, Transcript, or
 *  Lead Assessment. A refresh rereads at most 250 Calls.
 *
 * @see
 *  data/calls.ts
 *  data/activity-query.ts
 *  data/call-events.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import type { ActivityCursor } from "@/data/activity-query";
import type { Actor } from "@/data/authorization";
import type { CallEventKind } from "@/data/call-events";
import type { OutcomeKind } from "@/data/call-flow";
import type { CallFilters } from "@/data/call-list-query";
import { callListColumns, callListItem, callSource, filterConditions, type CallListItem, type CallListRow } from "@/data/calls";
import type { LeadClassification } from "@/data/lead-classification";
import { readableWorkspaceSql } from "@/data/workspace-authorization";

export const activityPageSize = 25;
export const activityRefreshLimit = 250;

export const derivedActivityStepKinds = ["transcript_expired", "recording_pending", "transcript_pending", "lead_assessment_pending"] as const;

export type ActivityStepKind = CallEventKind | (typeof derivedActivityStepKinds)[number];

export interface ActivityStep {
  id: string;
  kind: ActivityStepKind;
  occurredAt: string | null;
  outcome?: OutcomeKind;
  classification?: LeadClassification;
  reviewerName?: string | null;
}

export interface ActivityEntry extends Omit<CallListItem, "leadScore" | "recording" | "mp3RecordingId"> {
  day: string;
  cursor: string;
  steps: ActivityStep[];
}

export interface ActivityResult {
  entries: ActivityEntry[];
  hasMore: boolean;
  hasCalls: boolean;
  timeZone: string;
}

export interface ActivityQuery {
  filters: CallFilters;
  before?: ActivityCursor | null;
  through?: ActivityCursor | null;
}

type ActivityRow = CallListRow & { day: string; cursor_at: string; transcript_state: string | null; lead_assessment_state: string | null };

type EventRow = { id: string; call_id: string; kind: CallEventKind; occurred_at: Date; outcome: OutcomeKind | null; classification: LeadClassification | null; reviewer_name: string | null };

function eventStep(event: EventRow): ActivityStep {
  const step: ActivityStep = { id: event.id, kind: event.kind, occurredAt: event.occurred_at.toISOString() };
  if (event.kind === "call_completed" && event.outcome) step.outcome = event.outcome;
  if ((event.kind === "lead_assessment_completed" || event.kind === "lead_review_added") && event.classification) step.classification = event.classification;
  if (event.kind === "lead_review_added") step.reviewerName = event.reviewer_name;
  return step;
}

function derivedSteps(row: ActivityRow): ActivityStep[] {
  if (!row.recording_id) return [];
  if (row.expired) return row.transcript_state === "Completed" ? [{ id: "transcript_expired", kind: "transcript_expired", occurredAt: row.expires_at.toISOString() }] : [];
  const pending = (kind: ActivityStepKind): ActivityStep => ({ id: kind, kind, occurredAt: null });
  if (row.transfer_state === "Pending") return [pending("recording_pending")];
  if (row.transcript_state === "Pending") return [pending("transcript_pending")];
  return row.lead_assessment_state === "Pending" ? [pending("lead_assessment_pending")] : [];
}

function callSteps(row: ActivityRow, events: EventRow[]): ActivityStep[] {
  const latestCompleted = events.findLast((event) => event.kind === "call_completed");
  const steps = events.filter((event) => event.kind !== "call_completed" || event === latestCompleted).map(eventStep);
  const derived = derivedSteps(row);
  const timed = derived.filter((step) => step.occurredAt !== null);
  const merged = [...steps, ...timed].sort((a, b) => Date.parse(a.occurredAt!) - Date.parse(b.occurredAt!));
  return [...merged, ...derived.filter((step) => step.occurredAt === null)];
}

type Bind = (value: unknown) => string;

export function createActivity(pool: Pool, actor: Actor) {
  const timeZone = actor.timezone;

  function scoped(filters: CallFilters | null) {
    const values: unknown[] = [];
    const bind: Bind = (value) => {
      values.push(value);
      return `$${values.length}`;
    };
    const conditions = [readableWorkspaceSql(actor, values), ...(filters ? filterConditions(filters, values, { scoped: false, timeZone, callerSearchOnly: true }) : [])];
    return { values, bind, conditions };
  }

  const windowStart = (bind: Bind) => `((now() at time zone ${bind(timeZone)})::date - 6)::timestamp at time zone ${bind(timeZone)}`;
  const olderThan = (bind: Bind, cursor: ActivityCursor) => `(c.started_at, c.id) < (${bind(cursor.startedAt)}::timestamptz, ${bind(cursor.id)})`;

  async function exists(where: string, values: unknown[]): Promise<boolean> {
    return (await pool.query<{ exists: boolean }>(`select exists (select 1 from ${callSource} where ${where}) as exists`, values)).rows[0].exists;
  }

  return {
    async list(query: ActivityQuery): Promise<ActivityResult> {
      const dated = query.filters.startedFrom !== null || query.filters.startedTo !== null;
      const page = scoped(query.filters);
      if (query.before) page.conditions.push(olderThan(page.bind, query.before));
      else if (query.through) page.conditions.push(`(c.started_at, c.id) >= (${page.bind(query.through.startedAt)}::timestamptz, ${page.bind(query.through.id)})`);
      else if (!dated) page.conditions.push(`c.started_at >= ${windowStart(page.bind)}`);
      const rows = await pool.query<ActivityRow>(
        `select ${callListColumns},
                to_char(c.started_at at time zone ${page.bind(timeZone)}, 'YYYY-MM-DD') as day,
                to_char(c.started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at,
                r.transcript_state, r.lead_assessment_state
           from ${callSource}
          where ${page.conditions.join(" and ")}
          order by c.started_at desc, c.id desc
          limit ${page.bind(query.through ? activityRefreshLimit : activityPageSize)}`,
        page.values,
      );
      const last = rows.rows.at(-1);
      const cutoff = last ? { startedAt: last.cursor_at, id: last.id } : (query.before ?? query.through ?? null);
      const older = scoped(query.filters);
      const hasMore = cutoff
        ? await exists([...older.conditions, olderThan(older.bind, cutoff)].join(" and "), older.values)
        : !dated && (await exists([...older.conditions, `c.started_at < ${windowStart(older.bind)}`].join(" and "), older.values));
      const unfiltered = scoped(null);
      const hasCalls = rows.rows.length > 0 || hasMore || (await exists(unfiltered.conditions.join(" and "), unfiltered.values));
      const events = rows.rows.length === 0
        ? []
        : (
            await pool.query<EventRow>(
              `select e.id::text as id, e.call_id, e.kind, e.occurred_at, e.detail->>'outcome' as outcome, e.detail->>'classification' as classification, u.name as reviewer_name
                 from call_event e
                 left join "user" u on u.id = e.actor_user_id
                where e.organization_id = $1 and e.call_id = any($2::text[])
                order by e.occurred_at, e.id`,
              [actor.organizationId, rows.rows.map((row) => row.id)],
            )
          ).rows;
      const eventsByCall = Map.groupBy(events, (event) => event.call_id);
      const entries = rows.rows.map((row): ActivityEntry => {
        const item = callListItem(row);
        return {
          id: item.id,
          workspace: item.workspace,
          callerNumber: item.callerNumber,
          state: item.state,
          outcome: item.outcome,
          startedAt: item.startedAt,
          connectedDurationSeconds: item.connectedDurationSeconds,
          effectiveLeadClassification: item.effectiveLeadClassification,
          day: row.day,
          cursor: `${row.cursor_at},${row.id}`,
          steps: callSteps(row, eventsByCall.get(row.id) ?? []),
        };
      });
      return { entries, hasMore, hasCalls, timeZone };
    },
  };
}
