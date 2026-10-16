/**
 * -------------------------------------------------------------------------
 * @file   workspace-authorization.ts
 * @brief  Decides which Workspaces an authenticated actor may read or manage.
 *
 * @description
 *  Operators read and manage every Workspace in their Organization. Client
 *  Viewers read only Workspaces they hold a current direct Access Grant for,
 *  and only while those Workspaces are Active or Archived. Every page and
 *  server interface resolves Workspace reads through this module.
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
import type { Pool } from "pg";

import { isActiveOperatorActor, type Actor } from "@/data/authorization";
import { accessGrantAuthorizesRead, workspaceStates } from "@/data/workspace-policy";
import { createWorkspaces, type Workspaces } from "@/data/workspaces";

export type ReadableWorkspaces = Pick<Workspaces, "list" | "find">;

export function canManageWorkspaces(actor: Actor | null): actor is Actor {
  return isActiveOperatorActor(actor);
}

export function createReadableWorkspaces(pool: Pool, actor: Actor): ReadableWorkspaces {
  if (actor.state !== "Active") {
    throw new Error("Workspace reads require an Active actor");
  }
  if (actor.role === "Operator") {
    return createWorkspaces(pool, actor.organizationId);
  }
  return createWorkspaces(pool, actor.organizationId, {
    grantedToUserId: actor.userId,
    readableStates: workspaceStates.filter(accessGrantAuthorizesRead),
  });
}
