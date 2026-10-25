/**
 * -------------------------------------------------------------------------
 * @file   report-selection.ts
 * @brief  Selects the Calls a report or Calls export covers and previews their Recordings.
 *
 * @description
 *  Builds the one Call selection every report and Calls export uses: the
 *  job's Organization and Workspace ids, narrowed by a report's stored
 *  period window, a Calls export's filter query, or the one selected
 *  Call, so a filter or Call id naming another Workspace matches nothing.
 *  Every selection is also frozen at the job's request time: only Calls
 *  started before it match, so an All Time report or an open-ended export
 *  generated later holds exactly what was previewed and the Recording ZIP
 *  limit checked at request time still holds.
 *  Reads the selection in keyset pages, oldest first, as CSV rows that
 *  also carry each Call's Recording export state and MP3 object. The
 *  preview counts the same selection: matched Calls, retained Recordings
 *  whose MP3 can be downloaded, media an Operator purged, expired media,
 *  Calls without a Recording,
 *  and Recordings still processing or failed, which together account for
 *  every matched Call. A global Calls export's stored scope is narrowed to
 *  the distinct Workspaces of the Calls its selection matches.
 *
 * @remarks
 *  A Recording is retained exactly when Download MP3 would offer it, so the
 *  export reuses that rule from Call Detail. Purged media wins over every
 *  other state, then expired media, as in Call Detail. A Recording whose transfer or MP3 failed is Failed; one
 *  still transferring or encoding is Processing. The preview groups the
 *  selection by those Recording fields in SQL and classifies each group
 *  with the same rule, so it costs one aggregate query however many Calls
 *  match and never pages through them in a Worker request. Pages use the
 *  exact stored start time as the cursor. Rows reuse the Calls list source,
 *  row columns, filter compiler, and row mapping, so classification and
 *  availability rules exist once.
 *
 * @see
 *  data/report-generation.ts
 *  data/report-jobs.ts
 *  data/calls.ts
 *  data/call-details.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Database } from "@/data/database";

import { downloadableMp3RecordingId, totalSecondsSql } from "@/data/call-details";
import { emptyCallFilters } from "@/data/call-list-query";
import { callListColumns, callListItem, callSource, filterConditions, type CallListRow } from "@/data/calls";
import type { ReportCsvCall, TranscriptAvailability } from "@/data/report-csv";
import type { ReportJob } from "@/data/report-jobs";

export type ReportSelection = Pick<ReportJob, "workspaceIds" | "timeZone" | "parameters" | "requestedAt">;

export type RecordingExportState = "Retained" | "Purged" | "Expired" | "No Recording" | "Processing" | "Failed";

export interface ReportSelectionCall extends ReportCsvCall {
  recordingExport: RecordingExportState;
  recordingId: string | null;
  mp3ObjectKey: string | null;
}

export interface ReportSelectionPreview {
  matchedCalls: number;
  retainedRecordings: number;
  purgedMedia: number;
  expiredMedia: number;
  callsWithoutRecording: number;
  processingRecordings: number;
  failedRecordings: number;
}

const defaultPageSize = 500;

type RecordingStateRow = Pick<CallListRow, "recording_id" | "expired" | "transfer_state" | "mp3_state"> & { purged: boolean };

type ReportCallRow = CallListRow & {
  tracking_number: string;
  total_seconds: number | null;
  transcript_state: "Pending" | "Completed" | "Failed" | "Skipped" | null;
  mp3_object_key: string | null;
  started_at_cursor: string;
};

function recordingExportState(row: RecordingStateRow): RecordingExportState {
  if (!row.recording_id) return "No Recording";
  if (row.purged) return "Purged";
  if (row.expired) return "Expired";
  if (downloadableMp3RecordingId({ id: row.recording_id, expired: row.expired, purged_at: null, transfer_state: row.transfer_state, mp3_state: row.mp3_state })) return "Retained";
  return row.transfer_state === "Failed" || row.mp3_state === "Failed" ? "Failed" : "Processing";
}

function transcriptAvailability(row: ReportCallRow): TranscriptAvailability {
  if (!row.recording_id || !row.transcript_state) return "Unavailable";
  if (row.transcript_state === "Skipped") return "Skipped";
  if (row.purged_at) return "Purged";
  if (row.expired) return "Expired";
  return row.transcript_state === "Completed" ? "Available" : row.transcript_state;
}

function reportSelectionCall(row: ReportCallRow): ReportSelectionCall {
  const item = callListItem(row);
  const recordingExport = recordingExportState({ ...row, purged: row.purged_at !== null });
  return {
    id: item.id,
    workspaceName: item.workspace.name,
    trackingNumber: row.tracking_number,
    callerNumber: item.callerNumber,
    startedAt: row.started_at,
    state: item.state,
    outcome: item.outcome,
    totalDurationSeconds: row.total_seconds,
    connectedDurationSeconds: item.connectedDurationSeconds,
    effectiveLeadClassification: item.effectiveLeadClassification,
    leadScore: item.leadScore,
    leadReview: row.review_classification !== null,
    recording: item.recording,
    transcript: transcriptAvailability(row),
    recordingExport,
    recordingId: row.recording_id,
    mp3ObjectKey: recordingExport === "Retained" ? row.mp3_object_key : null,
  };
}

function selectionConditions(selection: ReportSelection, values: unknown[]): string[] {
  const scope = { scoped: false, timeZone: selection.timeZone };
  if ("period" in selection.parameters) {
    const window = selection.parameters.window;
    return window ? filterConditions({ ...emptyCallFilters, startedFrom: window.from, startedTo: window.to }, values, scope) : [];
  }
  const chosen = selection.parameters.selection;
  if (chosen.kind === "filters") return filterConditions(chosen.filters, values, scope);
  values.push(chosen.callId);
  return [`c.id = $${values.length}`];
}

function selectionWhere(organizationId: string, selection: ReportSelection): { where: string; values: unknown[] } {
  const values: unknown[] = [organizationId, selection.workspaceIds, selection.requestedAt];
  return { where: ["c.organization_id = $1", "c.workspace_id = any($2::text[])", "c.started_at < $3", ...selectionConditions(selection, values)].join(" and "), values };
}

export async function previewReportSelection(database: Database, organizationId: string, selection: ReportSelection): Promise<ReportSelectionPreview> {
  const { where, values } = selectionWhere(organizationId, selection);
  const groups = await database.query<RecordingStateRow & { count: number }>(
    `select case when r.id is not null then 'recording' end as recording_id, coalesce(r.expired, false) as expired, r.media_purged_at is not null as purged,
            r.transfer_state, r.mp3_state, count(*)::int as count
       from ${callSource}
      where ${where}
      group by 1, 2, 3, 4, 5`,
    values,
  );
  const preview: ReportSelectionPreview = { matchedCalls: 0, retainedRecordings: 0, purgedMedia: 0, expiredMedia: 0, callsWithoutRecording: 0, processingRecordings: 0, failedRecordings: 0 };
  const counters: Record<RecordingExportState, keyof ReportSelectionPreview> = {
    Retained: "retainedRecordings",
    Purged: "purgedMedia",
    Expired: "expiredMedia",
    "No Recording": "callsWithoutRecording",
    Processing: "processingRecordings",
    Failed: "failedRecordings",
  };
  for (const group of groups.rows) {
    preview.matchedCalls += group.count;
    preview[counters[recordingExportState(group)]] += group.count;
  }
  return preview;
}

export async function reportSelectionWorkspaceIds(database: Database, organizationId: string, selection: ReportSelection): Promise<string[]> {
  const { where, values } = selectionWhere(organizationId, selection);
  const result = await database.query<{ workspace_id: string }>(`select distinct c.workspace_id from ${callSource} where ${where} order by 1`, values);
  return result.rows.map(({ workspace_id }) => workspace_id);
}

export async function* reportJobCalls(database: Database, organizationId: string, selection: ReportSelection, pageSize = defaultPageSize): AsyncGenerator<ReportSelectionCall[]> {
  const { where, values } = selectionWhere(organizationId, selection);
  let cursor: { startedAt: string; id: string } | null = null;
  for (;;) {
    const page = [...values];
    const after: string = cursor ? ` and (c.started_at, c.id) > ($${page.push(cursor.startedAt)}::timestamptz, $${page.push(cursor.id)})` : "";
    const rows: ReportCallRow[] = (await database.query<ReportCallRow>(
      `select ${callListColumns}, c.tracking_number, ${totalSecondsSql} as total_seconds, r.transcript_state, r.mp3_object_key, c.started_at::text as started_at_cursor
         from ${callSource}
        where ${where}${after}
        order by c.started_at, c.id
        limit $${page.push(pageSize)}`,
      page,
    )).rows;
    if (rows.length > 0) yield rows.map(reportSelectionCall);
    if (rows.length < pageSize) return;
    const last: ReportCallRow = rows[rows.length - 1];
    cursor = { startedAt: last.started_at_cursor, id: last.id };
  }
}
