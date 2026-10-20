/**
 * -------------------------------------------------------------------------
 * @file   report-request.ts
 * @brief  Validates which Workspaces and timezone a requested report covers.
 *
 * @description
 *  Global Reports request one or more Workspaces from the actor's readable
 *  set, and Workspace Reports fix the scope to their one Workspace. Every
 *  selected Workspace must be readable, so one ungranted or unknown
 *  Workspace rejects the whole request rather than being dropped, and an
 *  empty selection is rejected. Repeated ids count once. A single-Workspace
 *  report uses the Workspace reporting timezone. A multi-Workspace report
 *  uses one document timezone, the selected IANA timezone or else the
 *  requester's account timezone.
 *
 * @remarks
 *  Readability comes from the readable Workspace helper, so Access Grant
 *  and Workspace State rules live in one place and a revoked grant blocks
 *  the next request. The caller passes the readable Workspaces for the
 *  actor so this module needs no database access of its own. A supplied
 *  document timezone is validated even when one Workspace makes it unused,
 *  so a malformed request never succeeds silently.
 *
 * @see
 *  data/workspace-authorization.ts
 *  data/report-period.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { isValidIanaTimezone } from "@/data/auth-policy";
import type { Actor } from "@/data/authorization";
import type { ReadableWorkspaces } from "@/data/workspace-authorization";
import type { WorkspaceRecord } from "@/data/workspaces";

export type ReportRequestErrorCode =
  | "invalid_period"
  | "invalid_timezone"
  | "empty_scope"
  | "empty_files"
  | "workspace_unavailable"
  | "no_matching_calls"
  | "no_recordings"
  | "export_too_large";

export class ReportRequestError extends Error {
  constructor(public readonly code: ReportRequestErrorCode) {
    super(code);
    this.name = "ReportRequestError";
  }
}

export type ReportScopeRequest =
  | { kind: "global"; workspaceIds: readonly string[]; timeZone?: string | null }
  | { kind: "workspace"; workspaceId: string };

export interface ReportScope {
  workspaces: Array<{ id: string; name: string }>;
  timeZone: string;
}

export async function resolveReportScope(readable: Pick<ReadableWorkspaces, "find">, actor: Actor, request: ReportScopeRequest): Promise<ReportScope> {
  const ids = request.kind === "workspace" ? [request.workspaceId] : [...new Set(request.workspaceIds)];
  if (ids.length === 0) throw new ReportRequestError("empty_scope");
  const documentTimeZone = request.kind === "global" ? request.timeZone?.trim() : undefined;
  if (documentTimeZone !== undefined && !isValidIanaTimezone(documentTimeZone)) throw new ReportRequestError("invalid_timezone");
  const workspaces = (await Promise.all(ids.map((id) => readable.find(id)))).filter((workspace): workspace is WorkspaceRecord => workspace !== null);
  if (workspaces.length !== ids.length) throw new ReportRequestError("workspace_unavailable");
  const timeZone = workspaces.length === 1 ? workspaces[0].reportingTimezone : documentTimeZone ?? actor.timezone;
  return { workspaces: workspaces.map(({ id, name }) => ({ id, name })), timeZone };
}
