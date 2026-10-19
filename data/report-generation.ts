/**
 * -------------------------------------------------------------------------
 * @file   report-generation.ts
 * @brief  Generates a report or Calls export job's files into private R2.
 *
 * @description
 *  Marks a Queued job Generating, writes the files it asked for to private
 *  R2 under `reports/{jobId}/`, and completes it with their artifacts only
 *  once every requested file exists. The report PDF reads the analytics
 *  service for the combined scope and, for several Workspaces, each
 *  Workspace in name order, builds the document model, and renders it. The
 *  Calls CSV holds every matching Call, oldest first: for a report, every
 *  Call started in the job's stored period window, or every Call for All
 *  Time; for a Calls export, the Calls filter query or the one selected
 *  Call. Every selection is restricted to the job's Organization and
 *  Workspace ids, so a filter or Call id naming another Workspace matches
 *  nothing. Rows carry the Workspace name, start times in the job's report
 *  timezone, the canonical Call Outcome, Lead Review precedence in the
 *  effective Lead classification, and Recording and Transcript
 *  availability under the 12-month media expiry. A job that is already
 *  Completed or Failed is left as it is, so a rerun is a no-op. A failure
 *  that exhausts retries is recorded on the job with a concise reason.
 *
 * @remarks
 *  Trigger.dev delivers at least once. A rerun of a Generating job, after a
 *  failed or partial upload, rewrites the same object key, and completion
 *  only moves a Queued or Generating job, so artifacts are recorded once.
 *  Calls are read in keyset pages on start time and Call id, using the
 *  exact stored start time as the cursor, so a large job never loads every
 *  row at once. The R2 helper signs one PUT with the whole body's SHA-256,
 *  so the CSV is assembled in memory before upload; at a few hundred bytes
 *  a row that stays small, and the Recording ZIP slice adds a multipart
 *  upload. Rows reuse the Calls list source, row columns, filter compiler,
 *  and row mapping, so classification and availability rules exist once.
 *  The PDF is rendered in memory and uploaded the same way. The Recording
 *  ZIP is not built yet: a job that asks for it stays Generating rather
 *  than completing without it.
 *
 * @see
 *  data/report-csv.ts
 *  data/report-document.ts
 *  data/report-pdf.tsx
 *  data/analytics.ts
 *  data/report-jobs.ts
 *  data/calls.ts
 *  data/r2-objects.ts
 *  trigger/report-generation.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import { totalSecondsSql } from "@/data/call-details";
import { emptyCallFilters } from "@/data/call-list-query";
import { callListColumns, callListItem, callSource, filterConditions, type CallListRow } from "@/data/calls";
import { reportAnalyticsSummary } from "@/data/analytics";
import { R2ObjectError, sha256Hex, type RecordingObjects } from "@/data/r2-objects";
import { reportCsvHeader, reportCsvRows, type ReportCsvCall, type TranscriptAvailability } from "@/data/report-csv";
import { buildReportDocument, reportNotableGoodLeadLimit } from "@/data/report-document";
import { completeReportJob, failReportJob, startReportJob, type ReportArtifact, type ReportFileKind, type ReportJob } from "@/data/report-jobs";
import { renderReportPdf } from "@/data/report-pdf";

export interface ReportGenerationDependencies {
  pool: Pool;
  objects: RecordingObjects;
  now: () => Date;
  pageSize?: number;
}

export const reportCsvContentType = "text/csv; charset=utf-8";

const defaultPageSize = 500;

export const reportPdfContentType = "application/pdf";

export function reportCsvObjectKey(jobId: string): string {
  return `reports/${jobId}/calls.csv`;
}

export function reportPdfObjectKey(jobId: string): string {
  return `reports/${jobId}/report.pdf`;
}

type ReportCallRow = CallListRow & {
  tracking_number: string;
  total_seconds: number | null;
  transcript_state: "Pending" | "Completed" | "Failed" | "Skipped" | null;
  started_at_cursor: string;
};

function transcriptAvailability(row: ReportCallRow): TranscriptAvailability {
  if (!row.recording_id || !row.transcript_state) return "Unavailable";
  if (row.transcript_state === "Skipped") return "Skipped";
  if (row.expired) return "Expired";
  return row.transcript_state === "Completed" ? "Available" : row.transcript_state;
}

function reportCsvCall(row: ReportCallRow): ReportCsvCall {
  const item = callListItem(row);
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
  };
}

function selectionConditions(job: ReportJob, values: unknown[]): string[] {
  const scope = { scoped: false, timeZone: job.timeZone };
  if ("period" in job.parameters) {
    const window = job.parameters.window;
    return window ? filterConditions({ ...emptyCallFilters, startedFrom: window.from, startedTo: window.to }, values, scope) : [];
  }
  const selection = job.parameters.selection;
  if (selection.kind === "filters") return filterConditions(selection.filters, values, scope);
  values.push(selection.callId);
  return [`c.id = $${values.length}`];
}

export async function* reportJobCalls(pool: Pool, organizationId: string, job: ReportJob, pageSize = defaultPageSize): AsyncGenerator<ReportCsvCall[]> {
  const values: unknown[] = [organizationId, job.workspaceIds];
  const where = ["c.organization_id = $1", "c.workspace_id = any($2::text[])", ...selectionConditions(job, values)].join(" and ");
  let cursor: { startedAt: string; id: string } | null = null;
  for (;;) {
    const page = [...values];
    const after: string = cursor ? ` and (c.started_at, c.id) > ($${page.push(cursor.startedAt)}::timestamptz, $${page.push(cursor.id)})` : "";
    const rows: ReportCallRow[] = (await pool.query<ReportCallRow>(
      `select ${callListColumns}, c.tracking_number, ${totalSecondsSql} as total_seconds, r.transcript_state, c.started_at::text as started_at_cursor
         from ${callSource}
        where ${where}${after}
        order by c.started_at, c.id
        limit $${page.push(pageSize)}`,
      page,
    )).rows;
    if (rows.length > 0) yield rows.map(reportCsvCall);
    if (rows.length < pageSize) return;
    const last: ReportCallRow = rows[rows.length - 1];
    cursor = { startedAt: last.started_at_cursor, id: last.id };
  }
}

async function storeCallsCsv(deps: ReportGenerationDependencies, job: ReportJob, organizationId: string): Promise<ReportArtifact> {
  const encoder = new TextEncoder();
  const chunks = [encoder.encode(reportCsvHeader())];
  for await (const calls of reportJobCalls(deps.pool, organizationId, job, deps.pageSize)) chunks.push(encoder.encode(reportCsvRows(calls, job.timeZone)));
  const body = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  chunks.reduce((offset, chunk) => (body.set(chunk, offset), offset + chunk.byteLength), 0);
  const key = reportCsvObjectKey(job.id);
  await deps.objects.put(key, body, { sizeBytes: body.byteLength, sha256: await sha256Hex(body) }, reportCsvContentType);
  return { file: "csv", r2Key: key, byteSize: body.byteLength, contentType: reportCsvContentType };
}

async function storeReportPdf(deps: ReportGenerationDependencies, job: ReportJob, organizationId: string): Promise<ReportArtifact> {
  if (!("period" in job.parameters)) throw new Error("Only a report job has a PDF");
  const workspaces = (await deps.pool.query<{ id: string; name: string }>(
    "select id, name from workspace where organization_id = $1 and id = any($2::text[]) order by name, id",
    [organizationId, job.workspaceIds],
  )).rows;
  const generatedAt = deps.now();
  const scope = { organizationId, workspaceIds: job.workspaceIds, timeZone: job.timeZone, window: job.parameters.window };
  const options = { now: generatedAt, notableGoodLeadLimit: reportNotableGoodLeadLimit };
  const combined = await reportAnalyticsSummary(deps.pool, scope, options);
  const sections = [];
  if (workspaces.length > 1) {
    for (const workspace of workspaces) sections.push({ workspace, summary: await reportAnalyticsSummary(deps.pool, { ...scope, workspaceIds: [workspace.id] }, options) });
  }
  const body = await renderReportPdf(buildReportDocument({ generatedAt, timeZone: job.timeZone, period: job.parameters.period, workspaces, combined, sections }));
  const key = reportPdfObjectKey(job.id);
  await deps.objects.put(key, body, { sizeBytes: body.byteLength, sha256: await sha256Hex(body) }, reportPdfContentType);
  return { file: "pdf", r2Key: key, byteSize: body.byteLength, contentType: reportPdfContentType };
}

export async function generateReportJob(deps: ReportGenerationDependencies, jobId: string): Promise<void> {
  const started = await startReportJob(deps.pool, jobId);
  if (!started) return;
  const { job, organizationId } = started;
  const files: readonly ReportFileKind[] = job.parameters.files;
  const artifacts: ReportArtifact[] = [];
  if (files.includes("pdf")) artifacts.push(await storeReportPdf(deps, job, organizationId));
  if (files.includes("csv")) artifacts.push(await storeCallsCsv(deps, job, organizationId));
  // The Recording ZIP slice plugs in here, storing its file and pushing its artifact.
  if (artifacts.length < files.length) return;
  await completeReportJob(deps.pool, job.id, artifacts, deps.now());
}

export async function recordReportGenerationFailure(pool: Pool, jobId: string, error: unknown): Promise<void> {
  await failReportJob(pool, jobId, error instanceof R2ObjectError ? error.message : "Report generation failed");
}
