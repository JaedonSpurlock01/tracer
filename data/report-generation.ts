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
 *  availability under the 12-month media expiry. The Recording ZIP holds
 *  `manifest.csv`, the CSV columns plus each Call's file path and
 *  Recording export outcome, and one MP3 per retained Recording at
 *  `recordings/{yyyymmdd-hhmmss}_{callId}.mp3`, named from the start time
 *  in the job's timezone so names sort by time and never collide or carry
 *  a caller number. A Recording that is purged, expired, missing,
 *  processing, or failed is omitted and its reason recorded in the
 *  manifest, including one whose media is purged or expires or whose MP3
 *  disappears while the export runs, because each Recording's media is
 *  re-checked just before its MP3 is read, so the job still completes. The
 *  ZIP artifact records which Recordings it included, so Purge Media can
 *  expire exactly the ZIPs that hold a Recording. A single-Call Export Call adds
 *  `transcript.txt` and `lead-assessment.json` beside an included MP3. A
 *  job that is already Completed or Failed is left as it is, so a rerun is
 *  a no-op. A failure that exhausts retries is recorded on the job with a
 *  concise reason.
 *
 * @remarks
 *  Trigger.dev delivers at least once. A rerun of a Generating job, after a
 *  failed or partial upload, rewrites the same object key, and completion
 *  only moves a Queued or Generating job, so artifacts are recorded once.
 *  Completion refuses a ZIP holding a Recording purged or expired after its
 *  MP3 was read, so the run retries and the rerun omits it.
 *  Calls are read in keyset pages on start time and Call id, using the
 *  exact stored start time as the cursor, so a large job never loads every
 *  row at once. The R2 helper signs one PUT with the whole body's SHA-256,
 *  so the CSV is assembled in memory before upload; at a few hundred bytes
 *  a row that stays small. The PDF is rendered in memory and uploaded the
 *  same way. The Recording ZIP can pass several gigabytes, so it streams
 *  through the STORE-mode ZIP writer into a multipart upload, holding one
 *  MP3 and one part at a time; only the manifest text is kept until the
 *  end, where it is written last because it records each MP3's outcome. A
 *  rerun aborts any unfinished upload of the same key and starts again,
 *  and a failure aborts the upload it began before rethrowing, so no
 *  partial archive is ever completed.
 *
 * @see
 *  data/report-csv.ts
 *  data/report-document.ts
 *  data/report-pdf.tsx
 *  data/analytics.ts
 *  data/report-jobs.ts
 *  data/report-selection.ts
 *  data/call-export-documents.ts
 *  data/zip-writer.ts
 *  data/r2-objects.ts
 *  trigger/report-generation.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import { reportAnalyticsSummary } from "@/data/analytics";
import { callExportDocuments } from "@/data/call-export-documents";
import { R2ObjectError, sha256Hex, type ArtifactObjects } from "@/data/r2-objects";
import { recordingMediaExpiredSql } from "@/data/recording-media";
import { reportCsvObjectKey, reportPdfObjectKey, reportZipObjectKey } from "@/data/report-artifact-lifecycle";
import { isoInTimeZone, reportCsvHeader, reportCsvRows, reportManifestHeader, reportManifestRows, type RecordingExportOutcome, type ReportManifestCall } from "@/data/report-csv";
import { buildReportDocument, reportNotableGoodLeadLimit } from "@/data/report-document";
import { completeReportJob, failReportJob, startReportJob, type ReportArtifact, type ReportFileKind, type ReportJob } from "@/data/report-jobs";
import { renderReportPdf } from "@/data/report-pdf";
import { reportJobCalls, type ReportSelectionCall } from "@/data/report-selection";
import { createZipWriter, type ZipWriter } from "@/data/zip-writer";

export interface ReportGenerationDependencies {
  pool: Pool;
  objects: ArtifactObjects;
  now: () => Date;
  pageSize?: number;
}

export const reportCsvContentType = "text/csv; charset=utf-8";

export const reportPdfContentType = "application/pdf";

export const reportZipContentType = "application/zip";

function recordingFileName(call: ReportSelectionCall, timeZone: string): string {
  const local = isoInTimeZone(call.startedAt, timeZone).slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  return `recordings/${local}_${call.id}.mp3`;
}

const omittedOutcomes: Readonly<Record<Exclude<ReportSelectionCall["recordingExport"], "Retained">, RecordingExportOutcome>> = {
  Purged: "Purged",
  Expired: "Expired",
  "No Recording": "No Recording",
  Processing: "Processing",
  Failed: "Failed",
};

async function removedMedia(deps: ReportGenerationDependencies, recordingId: string): Promise<"Purged" | "Expired" | null> {
  const row = (await deps.pool.query<{ purged: boolean; expired: boolean }>(
    `select r.media_purged_at is not null as purged, ${recordingMediaExpiredSql("c.started_at", "$2::timestamptz")} as expired
       from recording r
       join call c on c.id = r.call_id
      where r.id = $1`,
    [recordingId, deps.now()],
  )).rows[0];
  return row.purged ? "Purged" : row.expired ? "Expired" : null;
}

async function addRecording(deps: ReportGenerationDependencies, zip: ZipWriter, call: ReportSelectionCall, timeZone: string, modifiedAt: Date): Promise<ReportManifestCall> {
  if (call.recordingExport !== "Retained" || !call.mp3ObjectKey) return { ...call, recordingFile: null, recordingExport: call.recordingExport === "Retained" ? "Missing" : omittedOutcomes[call.recordingExport] };
  const removed = await removedMedia(deps, call.recordingId!);
  if (removed) return { ...call, recordingFile: null, recordingExport: removed };
  const mp3 = await deps.objects.get(call.mp3ObjectKey);
  if (!mp3) return { ...call, recordingFile: null, recordingExport: "Missing" };
  const recordingFile = recordingFileName(call, timeZone);
  await zip.addFile(recordingFile, mp3, modifiedAt);
  return { ...call, recordingFile, recordingExport: "Included" };
}

async function storeRecordingZip(deps: ReportGenerationDependencies, job: ReportJob, organizationId: string): Promise<ReportArtifact> {
  const key = reportZipObjectKey(job.id);
  await deps.objects.abortMultipartUploads(key);
  const upload = await deps.objects.createMultipartUpload(key, reportZipContentType);
  try {
    const zip = createZipWriter(upload);
    const modifiedAt = deps.now();
    const manifest = [reportManifestHeader()];
    const singleCall = "selection" in job.parameters && job.parameters.selection.kind === "call";
    let exportCall: { id: string; recordingId: string } | undefined;
    const includedRecordingIds: string[] = [];
    for await (const calls of reportJobCalls(deps.pool, organizationId, job, deps.pageSize)) {
      const rows: ReportManifestCall[] = [];
      for (const call of calls) {
        const row = await addRecording(deps, zip, call, job.timeZone, modifiedAt);
        if (row.recordingExport === "Included" && call.recordingId) includedRecordingIds.push(call.recordingId);
        if (singleCall && row.recordingExport === "Included" && call.recordingId) exportCall = { id: call.id, recordingId: call.recordingId };
        rows.push(row);
      }
      manifest.push(reportManifestRows(rows, job.timeZone));
    }
    if (exportCall) {
      for (const document of await callExportDocuments(deps.pool, organizationId, exportCall)) await zip.addFile(document.name, document.bytes, modifiedAt);
    }
    await zip.addFile("manifest.csv", new TextEncoder().encode(manifest.join("")), modifiedAt);
    await zip.finish();
    const { sizeBytes } = await upload.complete();
    return { file: "zip", r2Key: key, byteSize: sizeBytes, contentType: reportZipContentType, includedRecordingIds };
  } catch (error) {
    await upload.abort().catch(() => undefined);
    throw error;
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
  if (files.includes("zip")) artifacts.push(await storeRecordingZip(deps, job, organizationId));
  await completeReportJob(deps.pool, job.id, artifacts, deps.now());
}

export async function recordReportGenerationFailure(pool: Pool, jobId: string, error: unknown): Promise<void> {
  await failReportJob(pool, jobId, error instanceof R2ObjectError ? error.message : "Report generation failed");
}
