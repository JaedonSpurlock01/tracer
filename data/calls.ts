/**
 * -------------------------------------------------------------------------
 * @file   calls.ts
 * @brief  Lists one filtered, server-sorted page of the Calls an actor may read.
 *
 * @description
 *  Serves both global Calls and Workspace Calls with one query. Global
 *  Calls cover every Workspace the actor can read: all Organization
 *  Workspaces for an Operator and only granted Active or Archived
 *  Workspaces for a Client Viewer. Workspace Calls first resolve the
 *  Workspace through the central Workspace authorization and answer
 *  nothing for an ungranted one. Each row carries the canonical Call
 *  Outcome or In Progress state, the connected duration, the effective
 *  Lead classification, the Lead Score, and Recording availability, and
 *  the result names the timezone its dates render in: the user's for
 *  global Calls and the Workspace reporting timezone for Workspace Calls.
 *  The one Calls filter query narrows the page and its matched count by
 *  caller digits or Workspace name, Started dates resolved in that same
 *  timezone through the end of the last day, Workspaces (global only), Call
 *  Outcome, effective Lead classification, Lead Score, Recording
 *  availability, analysis status, and connected duration. The result also
 *  says whether the unfiltered scope has any Calls, so a view can tell no
 *  matches from no Calls. It also lists the readable Workspaces the global
 *  Workspace filter offers, and gives Call Detail the Calls on either side
 *  of one Call in that same scoped, filtered, sorted list, as ids with
 *  their Workspace ids, so previous and next Call can walk it.
 *
 * @remarks
 *  Authorization lives in the SQL conditions, never in UI filters. Sorting
 *  maps each allow-listed column to a fixed SQL expression, with Started
 *  descending and the Call id as tie-breakers so pages never overlap. The
 *  selected Recording, its Lead Assessment, the connected duration, the
 *  media expiry, and the Lead Review precedence reuse the Call Detail rules.
 *  Filters only add conditions beside the readable Workspace condition, so
 *  a filter naming an ungranted Workspace matches nothing, and every filter
 *  value is a bound parameter; LIKE wildcards in search are escaped, and
 *  Activity, which searches caller numbers only, asks for a caller-only
 *  search that Call Detail's neighbors from Activity repeat. Activity also
 *  reuses the scope source, row columns, and filter compiler here. Each
 *  filter field has one condition builder, used both for the flat filters
 *  and for the advanced tree, which compiles to a parenthesized And or Or
 *  expression joined by And outside the scope conditions, so an Or can
 *  never widen authorization. A Workspace condition adds nothing in
 *  Workspace Calls. Analysis
 *  status reads the selected Recording: Not applicable without a Recording
 *  or once a Recording ends without analysis state, Pending while its
 *  transfer, Transcript, or Lead Assessment is unfinished, Skipped, Failed
 *  when either stage failed, and Completed when both completed. The
 *  unfiltered existence check runs only when filters match nothing. The
 *  neighbors read builds the same scope, filter, and order SQL as the page
 *  and takes the rows beside the Call through lag and lead over that order,
 *  so a neighbor can never come from an unreadable Workspace, and a Call
 *  outside the list has none.
 *
 * @see
 *  data/call-list-query.ts
 *  data/call-details.ts
 *  data/lead-classification.ts
 *  data/workspace-authorization.ts
 *  data/recording-media.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import type { Actor } from "@/data/authorization";
import { connectedSecondsSql, downloadableMp3RecordingId, recordingAvailability, type CallDetail, type RecordingAvailability, type RecordingAvailabilityRow } from "@/data/call-details";
import type { OutcomeKind } from "@/data/call-flow";
import { callPageSize, flatCallFilterConditions, type CallFilterCondition, type CallFilterGroup, type CallFilters, type CallListQuery, type CallSortColumn } from "@/data/call-list-query";
import { effectiveLeadClassification, type EffectiveLeadClassification, type LeadClassification } from "@/data/lead-classification";
import { recordingAvailabilitySql, recordingMediaExpiredSql, recordingMediaExpiresAtSql } from "@/data/recording-media";
import { createReadableWorkspaces, readableWorkspaceSql } from "@/data/workspace-authorization";

export interface CallListItem {
  id: string;
  workspace: { id: string; name: string };
  callerNumber: string | null;
  state: CallDetail["state"];
  outcome: OutcomeKind | null;
  startedAt: string;
  connectedDurationSeconds: number | null;
  effectiveLeadClassification: EffectiveLeadClassification;
  leadScore: number | null;
  recording: RecordingAvailability["state"];
  mp3RecordingId: string | null;
}

export interface CallListResult {
  calls: CallListItem[];
  total: number;
  page: number;
  pageSize: number;
  timeZone: string;
  workspace: { id: string; name: string } | null;
  hasCalls: boolean;
}

export interface CallNeighbor {
  id: string;
  workspaceId: string;
}

export interface CallNeighbors {
  previous: CallNeighbor | null;
  next: CallNeighbor | null;
}

export type ScopedCallListQuery = CallListQuery & { workspaceId?: string; callerSearchOnly?: boolean };

export interface CallList {
  list(query: ScopedCallListQuery): Promise<CallListResult | null>;
  neighbors(query: ScopedCallListQuery, callId: string): Promise<CallNeighbors | null>;
  workspaceOptions(): Promise<{ id: string; name: string }[]>;
}

export type CallListRow = {
  id: string;
  workspace_id: string;
  workspace_name: string;
  caller_number: string | null;
  state: CallDetail["state"];
  outcome: OutcomeKind | null;
  started_at: Date;
  connected_seconds: number | null;
  recording_id: string | null;
  channels: 1 | 2;
  duration_seconds: number | null;
  transfer_state: RecordingAvailabilityRow["transfer_state"];
  waveform_state: RecordingAvailabilityRow["waveform_state"];
  mp3_state: RecordingAvailabilityRow["mp3_state"];
  expires_at: Date;
  expired: boolean;
  assessment_classification: LeadClassification | null;
  lead_score: number | null;
  review_classification: LeadClassification | null;
};

export const effectiveClassificationSql = "coalesce(lr.classification, la.classification)";

const sortExpressions: Readonly<Record<CallSortColumn, string>> = {
  startedAt: "c.started_at",
  callerNumber: "c.caller_number",
  workspace: "w.name",
  outcome: "c.outcome",
  connectedDuration: `(${connectedSecondsSql})`,
  leadClassification: effectiveClassificationSql,
  leadScore: "la.score",
};

export function callListItem(row: CallListRow): CallListItem {
  const recording: RecordingAvailabilityRow | undefined = row.recording_id
    ? { id: row.recording_id, channels: row.channels, duration_seconds: row.duration_seconds, transfer_state: row.transfer_state, waveform_state: row.waveform_state, mp3_state: row.mp3_state, expires_at: row.expires_at, expired: row.expired }
    : undefined;
  return {
    id: row.id,
    workspace: { id: row.workspace_id, name: row.workspace_name },
    callerNumber: row.caller_number,
    state: row.state,
    outcome: row.outcome,
    startedAt: row.started_at.toISOString(),
    connectedDurationSeconds: row.connected_seconds,
    effectiveLeadClassification: effectiveLeadClassification({ review: row.review_classification, assessment: row.assessment_classification }),
    leadScore: row.lead_score,
    recording: recordingAvailability(recording, null).state,
    mp3RecordingId: downloadableMp3RecordingId(recording),
  };
}

export const callSource = `call c
           join workspace w on w.id = c.workspace_id and w.organization_id = c.organization_id
           left join lateral (
             select r.id, r.channels, r.duration_seconds, r.transfer_state, r.waveform_state, r.mp3_state, r.transcript_state, r.lead_assessment_state,
                    ${recordingMediaExpiresAtSql("c.started_at")} as expires_at,
                    ${recordingMediaExpiredSql("c.started_at", "now()")} as expired
               from recording r
              where r.call_id = c.id and r.organization_id = c.organization_id
              order by r.source = 'connected' desc, r.created_at
              limit 1
           ) r on true
           left join lead_assessment la on la.recording_id = r.id and la.organization_id = c.organization_id
           left join lead_review lr on lr.call_id = c.id and lr.organization_id = c.organization_id`;

export const callListColumns = `c.id, c.workspace_id, w.name as workspace_name, c.caller_number, c.state, c.outcome, c.started_at,
                ${connectedSecondsSql} as connected_seconds,
                r.id as recording_id, r.channels, r.duration_seconds, r.transfer_state, r.waveform_state, r.mp3_state, r.expires_at, r.expired,
                la.classification as assessment_classification, la.score as lead_score,
                lr.classification as review_classification`;

const analysisStatusSql = `case
  when r.id is null then 'Not applicable'
  when r.transcript_state is null then case when r.transfer_state = 'Pending' then 'Pending' else 'Not applicable' end
  when r.transcript_state = 'Skipped' then 'Skipped'
  when r.transcript_state = 'Failed' or r.lead_assessment_state = 'Failed' then 'Failed'
  when r.transcript_state = 'Completed' and r.lead_assessment_state = 'Completed' then 'Completed'
  else 'Pending'
end`;

type Bind = (value: unknown) => string;

export interface FilterScope {
  scoped: boolean;
  timeZone: string;
  callerSearchOnly?: boolean;
}

function bounded(expression: string, min: number | null, max: number | null, bind: Bind): string {
  const bounds = [...(min !== null ? [`${expression} >= ${bind(min)}`] : []), ...(max !== null ? [`${expression} <= ${bind(max)}`] : [])];
  return `(${bounds.join(" and ")})`;
}

function conditionSql(condition: CallFilterCondition, bind: Bind, scope: FilterScope): string | null {
  switch (condition.field) {
    case "startedAt": {
      const timeZone = bind(scope.timeZone);
      const bounds = [
        ...(condition.from ? [`c.started_at >= (${bind(condition.from)}::date)::timestamp at time zone ${timeZone}`] : []),
        ...(condition.to ? [`c.started_at < (${bind(condition.to)}::date + 1)::timestamp at time zone ${timeZone}`] : []),
      ];
      return `(${bounds.join(" and ")})`;
    }
    case "workspace":
      return scope.scoped ? null : `c.workspace_id = any(${bind(condition.values)}::text[])`;
    case "outcome": {
      const inProgress = condition.values.includes("In Progress");
      return `(c.outcome = any(${bind(condition.values.filter((outcome) => outcome !== "In Progress"))}::text[])${inProgress ? " or c.state = 'In Progress'" : ""})`;
    }
    case "leadClassification": {
      const none = condition.values.includes("None");
      const classified = condition.values.filter((classification) => classification !== "None");
      return `(${effectiveClassificationSql} = any(${bind(classified)}::text[])${none ? ` or ${effectiveClassificationSql} is null` : ""})`;
    }
    case "leadScore":
      return bounded("la.score", condition.min, condition.max, bind);
    case "connectedDuration":
      return bounded(`(${connectedSecondsSql})`, condition.min, condition.max, bind);
    case "recording":
      return `${recordingAvailabilitySql("r", "c.started_at")} = any(${bind(condition.values)}::text[])`;
    case "analysis":
      return `${analysisStatusSql} = any(${bind(condition.values)}::text[])`;
  }
}

function groupSql(group: CallFilterGroup, bind: Bind, scope: FilterScope): string | null {
  const parts = group.rules
    .map((node) => ("rules" in node ? groupSql(node, bind, scope) : conditionSql(node, bind, scope)))
    .filter((part): part is string => part !== null);
  return parts.length > 0 ? `(${parts.join(` ${group.combinator} `)})` : null;
}

export function filterConditions(filters: CallFilters, values: unknown[], scope: FilterScope): string[] {
  const bind: Bind = (value) => {
    values.push(value);
    return `$${values.length}`;
  };
  const conditions: string[] = [];
  if (filters.search) {
    const digits = filters.search.replace(/\D/g, "");
    const phoneShaped = digits.length > 0 && /^[\d\s()+.-]+$/.test(filters.search);
    const name = () => `w.name ilike '%' || ${bind(filters.search.replace(/[\\%_]/g, "\\$&"))} || '%' escape '\\'`;
    const caller = () => `regexp_replace(coalesce(c.caller_number, ''), '\\D', '', 'g') like '%' || ${bind(digits)} || '%'`;
    if (scope.callerSearchOnly) conditions.push(phoneShaped ? caller() : "false");
    else conditions.push(phoneShaped ? `(${name()} or ${caller()})` : name());
  }
  const flat = groupSql({ combinator: "and", rules: [...flatCallFilterConditions(filters), ...(filters.advanced ? [filters.advanced] : [])] }, bind, scope);
  return flat ? [...conditions, flat] : conditions;
}

export function createCallList(pool: Pool, actor: Actor): CallList {
  const workspaces = createReadableWorkspaces(pool, actor);

  async function scopedQuery(query: ScopedCallListQuery) {
    const workspace = query.workspaceId === undefined ? null : await workspaces.find(query.workspaceId);
    if (query.workspaceId !== undefined && !workspace) return null;
    const values: unknown[] = [];
    const conditions = [readableWorkspaceSql(actor, values)];
    if (workspace) {
      values.push(workspace.id);
      conditions.push(`c.workspace_id = $${values.length}`);
    }
    const timeZone = workspace?.reportingTimezone ?? actor.timezone;
    const scopeWhere = conditions.join(" and ");
    const scopeValues = [...values];
    const filters = filterConditions(query.filters, values, { scoped: workspace !== null, timeZone, callerSearchOnly: query.callerSearchOnly });
    const where = [...conditions, ...filters].join(" and ");
    const direction = query.sort.direction === "asc" ? "asc" : "desc";
    const orderBy = `${sortExpressions[query.sort.column]} ${direction} nulls last, c.started_at desc, c.id`;
    return { workspace, timeZone, values, scopeWhere, scopeValues, filters, where, orderBy };
  }

  return {
    async list(query) {
      const scoped = await scopedQuery(query);
      if (!scoped) return null;
      const { workspace, timeZone, values, scopeWhere, scopeValues, filters, where, orderBy } = scoped;
      const count = await pool.query<{ count: number }>(`select count(*)::int as count from ${callSource} where ${where}`, values);
      const total = count.rows[0]?.count ?? 0;
      const hasCalls = total > 0 || (filters.length > 0 && (await pool.query<{ exists: boolean }>(
        `select exists (select 1 from call c join workspace w on w.id = c.workspace_id and w.organization_id = c.organization_id where ${scopeWhere}) as exists`,
        scopeValues,
      )).rows[0].exists);
      values.push((query.page - 1) * callPageSize, callPageSize);
      const rows = await pool.query<CallListRow>(
        `select ${callListColumns}
           from ${callSource}
          where ${where}
          order by ${orderBy}
         offset $${values.length - 1} limit $${values.length}`,
        values,
      );
      return {
        calls: rows.rows.map(callListItem),
        total,
        page: query.page,
        pageSize: callPageSize,
        timeZone,
        workspace: workspace ? { id: workspace.id, name: workspace.name } : null,
        hasCalls,
      };
    },
    async neighbors(query, callId) {
      const scoped = await scopedQuery(query);
      if (!scoped) return null;
      const { values, where, orderBy } = scoped;
      values.push(callId);
      const rows = await pool.query<{ previous_id: string | null; previous_workspace_id: string | null; next_id: string | null; next_workspace_id: string | null }>(
        `select previous_id, previous_workspace_id, next_id, next_workspace_id
           from (select c.id,
                        lag(c.id) over ordered as previous_id, lag(c.workspace_id) over ordered as previous_workspace_id,
                        lead(c.id) over ordered as next_id, lead(c.workspace_id) over ordered as next_workspace_id
                   from ${callSource}
                  where ${where}
                 window ordered as (order by ${orderBy})) listed
          where listed.id = $${values.length}`,
        values,
      );
      const row = rows.rows[0];
      return {
        previous: row?.previous_id && row.previous_workspace_id ? { id: row.previous_id, workspaceId: row.previous_workspace_id } : null,
        next: row?.next_id && row.next_workspace_id ? { id: row.next_id, workspaceId: row.next_workspace_id } : null,
      };
    },
    async workspaceOptions() {
      const values: unknown[] = [];
      const rows = await pool.query<{ id: string; name: string }>(`select w.id, w.name from workspace w where ${readableWorkspaceSql(actor, values)} order by w.name, w.id`, values);
      return rows.rows;
    },
  };
}
