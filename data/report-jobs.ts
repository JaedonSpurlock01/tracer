/**
 * -------------------------------------------------------------------------
 * @file   report-jobs.ts
 * @brief  Records report and Calls export jobs and authorizes their downloads.
 *
 * @description
 *  A report job builds a PDF, CSV detail, or both, and a Calls export job
 *  builds either a full-detail Calls CSV or a Recording ZIP with its CSV
 *  manifest, from the Calls filters or for one Call. Creating a job
 *  resolves its Workspace scope and timezone through the report request
 *  rules, except that a global Calls export uses the requester's account
 *  timezone, as global Calls does, so its Started-date filters and start
 *  times match the page it came from, and its stored scope is only the
 *  readable Workspaces of the Calls it matches, so losing access to an
 *  unrelated Workspace never blocks its download. It resolves a report's period in
 *  that timezone, rejects a report that selects no files, then previews the
 *  selection and rejects a report or export matching no Calls as
 *  `no_matching_calls`, and a Recording ZIP with no retained Recording as
 *  `no_recordings` or with more than 500 as `export_too_large`, before it
 *  queues the job with metadata kept for 90 days. The same preview,
 *  counting matched Calls, retained Recordings, expired media, Calls
 *  without a Recording, and Recordings still processing or failed, backs
 *  the export confirmation. A Calls CSV is not capped. A duplicate submission by the same
 *  requester with the same normalized parameters, the sorted Workspace
 *  ids, timezone, kind, period or selection, and files, returns the existing job while it is Queued, Generating, or
 *  Completed with unexpired artifacts; a Failed or expired job does not
 *  block a new one. Completion stores the artifacts, which expire 7 days
 *  later, with the Recording ids a ZIP included, and refuses a ZIP holding
 *  a Recording whose media was purged or expired after it was read; it
 *  first takes a share lock on those Recordings, so a purge committing at
 *  the same time either finds the completed ZIP and expires it or makes
 *  the generation run retry. A purge expires a ZIP early by moving its
 *  job's artifact expiry to the purge time. Requesting a job creates it and triggers its Trigger.dev
 *  generation run only when it is new, so a duplicate submission never
 *  starts a second run; a run that cannot be started records the job
 *  Failed so a resubmission queues a fresh one. Generation moves only a
 *  Queued or Generating job to Generating, so a late rerun of a Completed
 *  or Failed job finds nothing to do. Regenerating a Failed job, or a
 *  Completed job whose artifacts expired, requests a new job for its
 *  requester from the stored scope, timezone, and parameters, with a
 *  report's period pinned to its stored window as a Custom Range, while
 *  the requester can still read every Workspace in its scope; it follows
 *  the same limits, duplicate rule, and generation request as a new
 *  submission. Report history lists only the
 *  requester's jobs within metadata retention, newest first. A download
 *  is authorized only for the
 *  requester of a Completed job with unexpired artifacts who can still
 *  read every Workspace in its scope, so losing any one blocks the whole
 *  artifact.
 *
 * @remarks
 *  The duplicate check and insert run in one transaction under an advisory
 *  lock on the requester and parameters fingerprint, so concurrent
 *  duplicate submissions serialize into one job. A unique index cannot
 *  express artifact expiry, which depends on the current time. The
 *  generation run is requested through the Trigger.dev REST API, like
 *  Recording processing, with the idempotency key `report-generation:{jobId}`,
 *  after the job commits so the run always finds it. The preview runs
 *  before the transaction, as one aggregate query over the shared
 *  selection, which only counts Calls started before the request time, so
 *  generation, which uses the stored request time, covers the same Calls. A refused download
 *  returns null whether or not the job exists, so other users learn
 *  nothing about it. Artifacts live in their own table keyed by job and
 *  file kind, because a report holds one or two files and an export one.
 *
 * @see
 *  data/report-request.ts
 *  data/report-period.ts
 *  data/workspace-authorization.ts
 *  data/report-generation.ts
 *  data/report-selection.ts
 *  data/recording-processing.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Database } from "@/data/database";

import { calendarDateInTimeZone, type AnalyticsWindow } from "@/data/analytics-range";
import type { Actor } from "@/data/authorization";
import type { CallFilters } from "@/data/call-list-query";
import { recordingMediaRetainedSql } from "@/data/recording-media";
import { triggerTaskRun, type TriggerTaskRequestOptions } from "@/data/recording-processing";
import { resolveReportPeriod, type ReportPeriod } from "@/data/report-period";
import { ReportRequestError, resolveReportScope, type ReportScopeRequest } from "@/data/report-request";
import { previewReportSelection, reportSelectionWorkspaceIds, type ReportSelection, type ReportSelectionPreview } from "@/data/report-selection";
import type { ReadableWorkspaces } from "@/data/workspace-authorization";

export type ReportFileKind = "pdf" | "csv" | "zip";

export type CallExportSelection = { kind: "call"; callId: string } | { kind: "filters"; filters: CallFilters };

export type ReportJobRequest =
  | { kind: "report"; scope: ReportScopeRequest; period: ReportPeriod; files: ReadonlyArray<"pdf" | "csv"> }
  | { kind: "call_export"; scope: ReportScopeRequest; selection: CallExportSelection; file: "csv" | "zip" };

export type ReportJobParameters =
  | { period: ReportPeriod; window: AnalyticsWindow | null; files: Array<"pdf" | "csv"> }
  | { selection: CallExportSelection; files: ["csv" | "zip"] };

export type ReportJobStatus = "Queued" | "Generating" | "Completed" | "Failed";

export interface ReportJob {
  id: string;
  kind: ReportJobRequest["kind"];
  workspaceIds: string[];
  timeZone: string;
  parameters: ReportJobParameters;
  status: ReportJobStatus;
  failureReason: string | null;
  requestedAt: Date;
  completedAt: Date | null;
  artifactsExpireAt: Date | null;
  metadataExpireAt: Date;
}

type ReportJobRow = {
  id: string;
  kind: ReportJob["kind"];
  workspace_ids: string[];
  time_zone: string;
  parameters: ReportJobParameters;
  status: ReportJobStatus;
  failure_reason: string | null;
  requested_at: Date;
  completed_at: Date | null;
  artifacts_expire_at: Date | null;
  metadata_expire_at: Date;
};

const dayMs = 24 * 60 * 60 * 1000;

const artifactRetentionMs = 7 * dayMs;

const metadataRetentionMs = 90 * dayMs;

const jobColumns = "id, kind, workspace_ids, time_zone, parameters, status, failure_reason, requested_at, completed_at, artifacts_expire_at, metadata_expire_at";

function toReportJob(row: ReportJobRow): ReportJob {
  return {
    id: row.id,
    kind: row.kind,
    workspaceIds: row.workspace_ids,
    timeZone: row.time_zone,
    parameters: row.parameters,
    status: row.status,
    failureReason: row.failure_reason,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    artifactsExpireAt: row.artifacts_expire_at,
    metadataExpireAt: row.metadata_expire_at,
  };
}

function jobParameters(request: ReportJobRequest, timeZone: string, now: Date): ReportJobParameters {
  if (request.kind === "call_export") return { selection: request.selection, files: [request.file] };
  const files = (["pdf", "csv"] as const).filter((file) => request.files.includes(file));
  if (files.length === 0) throw new ReportRequestError("empty_files");
  return { period: request.period, window: resolveReportPeriod(request.period, timeZone, now)?.window ?? null, files };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function parametersFingerprint(input: { kind: ReportJob["kind"]; workspaceIds: string[]; timeZone: string; parameters: ReportJobParameters }): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(input)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const reportGenerationTaskId = "report-generation";

export class ReportGenerationUnavailableError extends Error {
  constructor() {
    super("provider_unavailable");
    this.name = "ReportGenerationUnavailableError";
  }
}

export interface ReportGeneration {
  request(job: Pick<ReportJob, "id">): Promise<void>;
}

export function createTriggerReportGeneration(options: TriggerTaskRequestOptions): ReportGeneration {
  return {
    async request(job) {
      await triggerTaskRun(options, reportGenerationTaskId, { jobId: job.id }, `report-generation:${job.id}`);
    },
  };
}

async function resolveReportSelection(actor: Actor, readable: Pick<ReadableWorkspaces, "find">, request: ReportJobRequest, now: Date): Promise<ReportSelection> {
  const scope = await resolveReportScope(readable, actor, request.scope);
  const workspaceIds = scope.workspaces.map(({ id }) => id).sort();
  const timeZone = request.kind === "call_export" && request.scope.kind === "global" ? actor.timezone : scope.timeZone;
  return { workspaceIds, timeZone, parameters: jobParameters(request, timeZone, now), requestedAt: now };
}

export type ReportJobPreview = ReportSelectionPreview;

export const recordingExportLimit = 500;

function enforceSelectionLimits(parameters: ReportJobParameters, preview: ReportJobPreview): void {
  if (preview.matchedCalls === 0) throw new ReportRequestError("no_matching_calls");
  if (parameters.files[0] !== "zip") return;
  if (preview.retainedRecordings === 0) throw new ReportRequestError("no_recordings");
  if (preview.retainedRecordings > recordingExportLimit) throw new ReportRequestError("export_too_large");
}

export async function previewReportJob(
  database: Database,
  actor: Actor,
  readable: Pick<ReadableWorkspaces, "find">,
  request: ReportJobRequest,
  now: Date,
): Promise<ReportJobPreview> {
  return previewReportSelection(database, actor.organizationId, await resolveReportSelection(actor, readable, request, now));
}

async function insertReportJob(database: Database, actor: Actor, kind: ReportJob["kind"], selection: ReportSelection): Promise<{ job: ReportJob; created: boolean }> {
  const { workspaceIds, timeZone, parameters, requestedAt: now } = selection;
  enforceSelectionLimits(parameters, await previewReportSelection(database, actor.organizationId, selection));
  const fingerprint = await parametersFingerprint({ kind, workspaceIds, timeZone, parameters });
  return await database.transaction(async (client) => {
    const existing = (await client.query<ReportJobRow>(
      `select ${jobColumns} from report_job
        where organization_id = $1 and requester_user_id = $2 and fingerprint = $3
          and (status in ('Queued', 'Generating') or (status = 'Completed' and artifacts_expire_at > $4))
        order by requested_at desc
        limit 1`,
      [actor.organizationId, actor.userId, fingerprint, now],
    )).rows[0];
    const row = existing ?? (await client.query<ReportJobRow>(
      `insert into report_job (id, organization_id, requester_user_id, kind, workspace_ids, time_zone, parameters, fingerprint, requested_at, metadata_expire_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning ${jobColumns}`,
      [randomUUID(), actor.organizationId, actor.userId, kind, workspaceIds, timeZone, JSON.stringify(parameters), fingerprint, now, new Date(now.getTime() + metadataRetentionMs)],
    )).rows[0];
    return { job: toReportJob(row), created: !existing };
  }, { lock: `tracer:report-job:${actor.organizationId}:${actor.userId}:${fingerprint}` });
}

export async function createReportJob(
  database: Database,
  actor: Actor,
  readable: Pick<ReadableWorkspaces, "find">,
  request: ReportJobRequest,
  now: Date,
): Promise<{ job: ReportJob; created: boolean }> {
  const selection = await resolveReportSelection(actor, readable, request, now);
  const scoped = request.kind === "call_export" && request.scope.kind === "global" ? { ...selection, workspaceIds: await reportSelectionWorkspaceIds(database, actor.organizationId, selection) } : selection;
  return insertReportJob(database, actor, request.kind, scoped);
}

async function startReportGeneration(database: Database, result: { job: ReportJob; created: boolean }, generation: ReportGeneration): Promise<{ job: ReportJob; created: boolean }> {
  if (!result.created) return result;
  try {
    await generation.request(result.job);
  } catch {
    await failReportJob(database, result.job.id, "Report generation could not be started");
    throw new ReportGenerationUnavailableError();
  }
  return result;
}

export async function requestReportJob(
  database: Database,
  actor: Actor,
  readable: Pick<ReadableWorkspaces, "find">,
  request: ReportJobRequest,
  now: Date,
  generation: ReportGeneration,
): Promise<{ job: ReportJob; created: boolean }> {
  return startReportGeneration(database, await createReportJob(database, actor, readable, request, now), generation);
}

export async function regenerateReportJob(
  database: Database,
  actor: Actor,
  readable: Pick<ReadableWorkspaces, "find">,
  jobId: string,
  now: Date,
  generation: ReportGeneration,
): Promise<{ job: ReportJob; created: boolean } | "not_found" | "not_regenerable"> {
  const row = (await database.query<ReportJobRow>(
    `select ${jobColumns} from report_job where id = $1 and organization_id = $2 and requester_user_id = $3 and metadata_expire_at > $4`,
    [jobId, actor.organizationId, actor.userId, now],
  )).rows[0];
  if (!row) return "not_found";
  const source = toReportJob(row);
  if ((await Promise.all(source.workspaceIds.map((id) => readable.find(id)))).includes(null)) return "not_found";
  if (!reportJobRegenerable(source, now)) return "not_regenerable";
  const parameters: ReportJobParameters =
    "period" in source.parameters && source.parameters.window ? { ...source.parameters, period: { kind: "custom", ...source.parameters.window } } : source.parameters;
  const selection = { workspaceIds: source.workspaceIds, timeZone: source.timeZone, parameters, requestedAt: now };
  return startReportGeneration(database, await insertReportJob(database, actor, source.kind, selection), generation);
}

export interface ReportArtifact {
  file: ReportFileKind;
  r2Key: string;
  byteSize: number;
  contentType: string;
  includedRecordingIds?: string[];
}

export class ReportMediaRemovedError extends Error {
  constructor() {
    super("Recording media was removed while the export ran");
    this.name = "ReportMediaRemovedError";
  }
}

export async function startReportJob(database: Database, jobId: string): Promise<{ job: ReportJob; organizationId: string } | null> {
  const row = (await database.query<ReportJobRow & { organization_id: string }>(
    `update report_job set status = 'Generating' where id = $1 and status in ('Queued', 'Generating') returning ${jobColumns}, organization_id`,
    [jobId],
  )).rows[0];
  return row ? { job: toReportJob(row), organizationId: row.organization_id } : null;
}

export async function completeReportJob(database: Database, jobId: string, artifacts: readonly ReportArtifact[], now: Date): Promise<void> {
  const includedRecordingIds = artifacts.find(({ file }) => file === "zip")?.includedRecordingIds ?? null;
  await database.transaction(async (client) => {
    if (includedRecordingIds?.length) {
      const removed = await client.query(
        `select r.id from recording r join call c on c.id = r.call_id
          where r.id = any($1::text[]) and not ${recordingMediaRetainedSql("r", "c.started_at", "$2::timestamptz")}
            for share of r`,
        [includedRecordingIds, now],
      );
      if (removed.rowCount) throw new ReportMediaRemovedError();
    }
    await client.query(
      `with completed as (
         update report_job set status = 'Completed', completed_at = $2, artifacts_expire_at = $3
          where id = $1 and status in ('Queued', 'Generating')
         returning id
       )
       insert into report_artifact (job_id, file_kind, r2_key, byte_size, content_type, included_recording_ids)
       select completed.id, a.file_kind, a.r2_key, a.byte_size, a.content_type, case when a.file_kind = 'zip' then $8::text[] end
         from completed, unnest($4::text[], $5::text[], $6::bigint[], $7::text[]) as a(file_kind, r2_key, byte_size, content_type)`,
      [jobId, now, new Date(now.getTime() + artifactRetentionMs), artifacts.map(({ file }) => file), artifacts.map(({ r2Key }) => r2Key), artifacts.map(({ byteSize }) => byteSize), artifacts.map(({ contentType }) => contentType), includedRecordingIds],
    );
  });
}

export async function failReportJob(database: Database, jobId: string, reason: string): Promise<void> {
  await database.query("update report_job set status = 'Failed', failure_reason = $2 where id = $1 and status in ('Queued', 'Generating')", [jobId, reason]);
}

export async function listReportJobs(database: Database, actor: Actor, now: Date): Promise<ReportJob[]> {
  const result = await database.query<ReportJobRow>(
    `select ${jobColumns} from report_job
      where organization_id = $1 and requester_user_id = $2 and metadata_expire_at > $3
      order by requested_at desc, id`,
    [actor.organizationId, actor.userId, now],
  );
  return result.rows.map(toReportJob);
}

export function reportJobRegenerable(job: Pick<ReportJob, "status" | "artifactsExpireAt">, now: Date): boolean {
  return job.status === "Failed" || (job.status === "Completed" && job.artifactsExpireAt !== null && job.artifactsExpireAt <= now);
}

export interface ReportDownload {
  r2Key: string;
  contentType: string;
  filename: string;
}

export async function authorizeReportDownload(
  database: Database,
  actor: Actor,
  readable: Pick<ReadableWorkspaces, "find">,
  jobId: string,
  file: ReportFileKind,
  now: Date,
): Promise<ReportDownload | null> {
  const row = (await database.query<{ kind: ReportJob["kind"]; workspace_ids: string[]; time_zone: string; requested_at: Date; r2_key: string; content_type: string }>(
    `select j.kind, j.workspace_ids, j.time_zone, j.requested_at, a.r2_key, a.content_type
       from report_job j
       join report_artifact a on a.job_id = j.id and a.file_kind = $3
      where j.id = $1 and j.organization_id = $2 and j.requester_user_id = $5 and j.status = 'Completed' and j.artifacts_expire_at > $4`,
    [jobId, actor.organizationId, file, now, actor.userId],
  )).rows[0];
  if (!row) return null;
  const readableWorkspaces = await Promise.all(row.workspace_ids.map((id) => readable.find(id)));
  if (readableWorkspaces.includes(null)) return null;
  const name = row.kind === "report" ? "tracer-report" : file === "zip" ? "tracer-recordings" : "tracer-calls";
  return { r2Key: row.r2_key, contentType: row.content_type, filename: `${name}-${calendarDateInTimeZone(row.requested_at, row.time_zone)}.${file}` };
}
