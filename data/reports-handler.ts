/**
 * -------------------------------------------------------------------------
 * @file   reports-handler.ts
 * @brief  Exposes the authenticated Reports and Calls export HTTP routes.
 *
 * @description
 *  Resolves an Active actor for every route under `/api/reports`:
 *  `POST /api/reports/preview` counts what a report or Calls export would
 *  cover, `POST /api/reports` requests the job (201 when new, 200 with the
 *  existing job for a duplicate), `GET /api/reports` lists the requester's
 *  Report history, `GET /api/reports/{jobId}/files/{pdf|csv|zip}` streams
 *  one artifact, and `POST /api/reports/{jobId}/regenerate` requests a new
 *  job from a Failed or expired job's stored parameters, which is also
 *  Retry. A report names its Workspaces, period, document timezone, and
 *  files; a Calls export names global or Workspace scope with the Calls
 *  filter query string exactly as the Calls page writes it, or one Call
 *  for Export Call, and a CSV or Recording ZIP file. A global Calls export
 *  selects from every Workspace the actor can read, as global Calls does,
 *  and the job keeps only the Workspaces of the Calls it matches.
 *
 * @remarks
 *  Request bodies are checked for shape here and the report request rules
 *  validate their values, each answering a stable error code. An
 *  ungranted, unknown, or other-Organization Workspace, another user's
 *  job, and a refused download all answer the same Not Found. A request
 *  is refused with 503 before any job is recorded when Trigger.dev is not
 *  configured, so no job sits Queued without a run. Regenerate copies the
 *  stored scope, timezone, and parameters and pins a report's period to
 *  its stored calendar window as a Custom Range, so a Previous Week report
 *  regenerated later covers the same week; All Time and Calls filter
 *  selections are repeated as stored, frozen at the new request time. It
 *  rechecks current access to every Workspace in scope. History is one
 *  indexed query plus one Workspace name query, cheap enough for the
 *  notification popover to poll every 30 seconds while the tab is
 *  visible, like Activity. A Workspace the requester can no longer read
 *  is listed without its name, and its job offers neither download nor
 *  Regenerate. Downloads stream from R2 through the Worker instead of a
 *  pre-signed URL, so authorization is rechecked on every download.
 *  Responses are private and never cached.
 *
 * @see
 *  data/report-jobs.ts
 *  data/report-request.ts
 *  data/report-download.ts
 *  data/call-list-query.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import { AuthorizationError, requireActiveActor, type Actor } from "@/data/authorization";
import { callListQueryFromSearchParams } from "@/data/call-list-query";
import { reportDownloadResponse, type ReportArtifactBucket } from "@/data/report-download";
import {
  authorizeReportDownload,
  listReportJobs,
  previewReportJob,
  recordingExportLimit,
  regenerateReportJob,
  ReportGenerationUnavailableError,
  reportJobRegenerable,
  requestReportJob,
  type ReportFileKind,
  type ReportGeneration,
  type ReportJob,
  type ReportJobRequest,
} from "@/data/report-jobs";
import type { ReportPeriod } from "@/data/report-period";
import { ReportRequestError, type ReportScopeRequest } from "@/data/report-request";
import { schema } from "@/data/schema";
import type { TracerAuth } from "@/data/tracer-auth";
import { createReadableWorkspaces, readableWorkspaceSql } from "@/data/workspace-authorization";

export interface ReportsHandlerOptions {
  auth: TracerAuth;
  database: NodePgDatabase<typeof schema>;
  pool: Pool;
  reportBucket?: ReportArtifactBucket;
  reportGeneration?: ReportGeneration;
}

const privateHeaders = { "cache-control": "private, no-store" };

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: privateHeaders });
}

class InvalidReportInput extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body)) throw new InvalidReportInput();
  return body;
}

function reportScope(value: unknown): ReportScopeRequest {
  if (isRecord(value) && value.kind === "workspace" && typeof value.workspaceId === "string") return { kind: "workspace", workspaceId: value.workspaceId };
  if (isRecord(value) && value.kind === "global" && isStringArray(value.workspaceIds) && (value.timeZone === undefined || value.timeZone === null || typeof value.timeZone === "string")) {
    return { kind: "global", workspaceIds: value.workspaceIds, timeZone: value.timeZone ?? null };
  }
  throw new InvalidReportInput();
}

function reportPeriod(value: unknown): ReportPeriod {
  if (!isRecord(value)) throw new InvalidReportInput();
  if (value.kind === "previousWeek" || value.kind === "previousMonth" || value.kind === "all") return { kind: value.kind };
  if (value.kind === "custom" && typeof value.from === "string" && typeof value.to === "string") return { kind: "custom", from: value.from, to: value.to };
  throw new InvalidReportInput();
}

function reportFiles(value: unknown): Array<"pdf" | "csv"> {
  if (!Array.isArray(value) || !value.every((file) => file === "pdf" || file === "csv")) throw new InvalidReportInput();
  return value;
}

const maxCallsQueryLength = 8000;

async function readableWorkspaceIds(pool: Pool, actor: Actor): Promise<string[]> {
  const values: unknown[] = [];
  const result = await pool.query<{ id: string }>(`select w.id from workspace w where ${readableWorkspaceSql(actor, values)}`, values);
  return result.rows.map(({ id }) => id);
}

async function callExportRequest(pool: Pool, actor: Actor, body: Record<string, unknown>): Promise<ReportJobRequest> {
  const { scope, file, callId, query } = body;
  if (file !== "csv" && file !== "zip") throw new InvalidReportInput();
  const workspaceId = isRecord(scope) && scope.kind === "workspace" && typeof scope.workspaceId === "string" ? scope.workspaceId : null;
  if (workspaceId === null && !(isRecord(scope) && scope.kind === "global")) throw new InvalidReportInput();
  if (callId !== undefined) {
    if (typeof callId !== "string" || workspaceId === null || query !== undefined) throw new InvalidReportInput();
    return { kind: "call_export", scope: { kind: "workspace", workspaceId }, selection: { kind: "call", callId }, file };
  }
  if (typeof query !== "string" || query.length > maxCallsQueryLength) throw new InvalidReportInput();
  return {
    kind: "call_export",
    scope: workspaceId !== null ? { kind: "workspace", workspaceId } : { kind: "global", workspaceIds: await readableWorkspaceIds(pool, actor) },
    selection: { kind: "filters", filters: callListQueryFromSearchParams(new URLSearchParams(query)).filters },
    file,
  };
}

async function reportJobRequest(pool: Pool, actor: Actor, body: Record<string, unknown>): Promise<ReportJobRequest> {
  if (body.kind === "report") return { kind: "report", scope: reportScope(body.scope), period: reportPeriod(body.period), files: reportFiles(body.files) };
  if (body.kind === "call_export") return callExportRequest(pool, actor, body);
  throw new InvalidReportInput();
}

export interface ReportHistoryItem {
  id: string;
  kind: ReportJob["kind"];
  status: ReportJob["status"];
  failureReason: string | null;
  requestedAt: Date;
  requestedBy: string;
  scope: Array<{ id: string; name: string | null }>;
  timeZone: string;
  parameters: ReportJob["parameters"];
  files: Array<{ file: ReportFileKind; downloadable: boolean; href: string | null }>;
  expiresAt: Date | null;
  canRegenerate: boolean;
}

async function readableWorkspaceNames(pool: Pool, actor: Actor, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const values: unknown[] = [ids];
  const result = await pool.query<{ id: string; name: string }>(`select w.id, w.name from workspace w where w.id = any($1::text[]) and ${readableWorkspaceSql(actor, values)}`, values);
  return new Map(result.rows.map(({ id, name }) => [id, name]));
}

async function reportHistoryItems(pool: Pool, actor: Actor, jobs: ReportJob[], now: Date): Promise<ReportHistoryItem[]> {
  const names = await readableWorkspaceNames(pool, actor, [...new Set(jobs.flatMap(({ workspaceIds }) => workspaceIds))]);
  return jobs.map((job) => {
    const accessible = job.workspaceIds.every((id) => names.has(id));
    const downloadable = accessible && job.status === "Completed" && job.artifactsExpireAt !== null && job.artifactsExpireAt > now;
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      failureReason: job.failureReason,
      requestedAt: job.requestedAt,
      requestedBy: actor.name,
      scope: job.workspaceIds.map((id) => ({ id, name: names.get(id) ?? null })),
      timeZone: job.timeZone,
      parameters: job.parameters,
      files: job.parameters.files.map((file) => ({ file, downloadable, href: downloadable ? `/api/reports/${job.id}/files/${file}` : null })),
      expiresAt: job.artifactsExpireAt,
      canRegenerate: accessible && reportJobRegenerable(job, now),
    };
  });
}

const requestErrorStatus: Record<ReportRequestError["code"], number> = {
  invalid_period: 400,
  invalid_timezone: 400,
  empty_scope: 400,
  empty_files: 400,
  workspace_unavailable: 404,
  no_matching_calls: 422,
  no_recordings: 422,
  export_too_large: 422,
};

function errorResponse(error: unknown): Response {
  if (error instanceof AuthorizationError) return response({ error: error.status === 401 ? "unauthenticated" : "forbidden" }, error.status);
  if (error instanceof InvalidReportInput) return response({ error: "invalid_input" }, 400);
  if (error instanceof ReportGenerationUnavailableError) return response({ error: "provider_unavailable" }, 502);
  if (error instanceof ReportRequestError) {
    return response({ error: error.code === "workspace_unavailable" ? "not_found" : error.code }, requestErrorStatus[error.code]);
  }
  throw error;
}

export function createReportsHandler(options: ReportsHandlerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const actor = await requireActiveActor(options.auth, options.database, request.headers);
      const route = new URL(request.url).pathname.replace(/^\/api\/reports\/?/, "");
      const readable = createReadableWorkspaces(options.pool, actor);
      const now = new Date();
      if (request.method === "GET" && route === "") {
        return response({ jobs: await reportHistoryItems(options.pool, actor, await listReportJobs(options.pool, actor, now), now) });
      }
      const downloadMatch = route.match(/^([^/]+)\/files\/(pdf|csv|zip)$/);
      if (request.method === "GET" && downloadMatch) {
        const download = await authorizeReportDownload(options.pool, actor, readable, downloadMatch[1], downloadMatch[2] as ReportFileKind, now);
        const served = download && options.reportBucket ? await reportDownloadResponse(options.reportBucket, download) : null;
        return served ?? response({ error: "not_found" }, 404);
      }
      const regenerateMatch = route.match(/^([^/]+)\/regenerate$/);
      if (request.method === "POST" && regenerateMatch) {
        const generation = options.reportGeneration;
        if (!generation) return response({ error: "generation_unavailable" }, 503);
        const result = await regenerateReportJob(options.pool, actor, readable, regenerateMatch[1], now, generation);
        if (typeof result === "string") return response({ error: result }, result === "not_found" ? 404 : 409);
        return response({ job: (await reportHistoryItems(options.pool, actor, [result.job], now))[0] }, result.created ? 201 : 200);
      }
      if (request.method === "POST" && route === "preview") {
        const preview = await previewReportJob(options.pool, actor, readable, await reportJobRequest(options.pool, actor, await readBody(request)), now);
        return response({ preview, recordingExportLimit });
      }
      if (request.method === "POST" && route === "") {
        const generation = options.reportGeneration;
        if (!generation) return response({ error: "generation_unavailable" }, 503);
        const input = await reportJobRequest(options.pool, actor, await readBody(request));
        const { job, created } = await requestReportJob(options.pool, actor, readable, input, now, generation);
        return response({ job: (await reportHistoryItems(options.pool, actor, [job], now))[0] }, created ? 201 : 200);
      }
      return response({ error: "not_found" }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
