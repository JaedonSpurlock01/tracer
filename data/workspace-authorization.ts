/**
 * -------------------------------------------------------------------------
 * @file   workspace-authorization.ts
 * @brief  Decides which Workspaces an authenticated actor may read or manage.
 *
 * @description
 *  Operators read and manage every Workspace in their Organization. Client
 *  Viewers read only Workspaces they hold a current direct Access Grant for,
 *  and only while those Workspaces are Active or Archived. Every page and
 *  server interface resolves Workspace reads through this module, and
 *  queries that span Workspaces, such as Calls, filter their `w` Workspace
 *  alias with its readable Workspace SQL condition.
 *
 * @remarks
 *  Grants are checked against the database on every request, so removing an
 *  Access Grant blocks the next read from an existing session.
 *
 * @see
 *  data/workspace-policy.ts
 *  CONTEXT.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */

import type { Queryable } from "@/data/database";
import { isActiveOperatorActor, type Actor } from "@/data/authorization";
import { accessGrantAuthorizesRead, workspaceStates } from "@/data/workspace-policy";
import { createWorkspaceReads, type Workspaces } from "@/data/workspaces";

export type ReadableWorkspaces = Pick<Workspaces, "list" | "find">;

export function canManageWorkspaces(actor: Actor | null): actor is Actor {
  return isActiveOperatorActor(actor);
}

export function createReadableWorkspaces(connection: Queryable, actor: Actor): ReadableWorkspaces {
  if (actor.state !== "Active") {
    throw new Error("Workspace reads require an Active actor");
  }
  if (actor.role === "Operator") {
    return createWorkspaceReads(connection, actor.organizationId);
  }
  return createWorkspaceReads(connection, actor.organizationId, {
    grantedToUserId: actor.userId,
    readableStates: workspaceStates.filter(accessGrantAuthorizesRead),
  });
}

export function readableWorkspaceSql(actor: Actor, values: unknown[]): string {
  if (actor.state !== "Active") {
    throw new Error("Workspace reads require an Active actor");
  }
  values.push(actor.organizationId);
  const organization = `w.organization_id = $${values.length}`;
  if (actor.role === "Operator") return organization;
  values.push(actor.userId, workspaceStates.filter(accessGrantAuthorizesRead));
  return `${organization}
    and exists (select 1 from access_grant g where g.workspace_id = w.id and g.organization_id = w.organization_id and g.user_id = $${values.length - 1})
    and w.state = any($${values.length}::text[])`;
}
