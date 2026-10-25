/**
 * -------------------------------------------------------------------------
 * @file   workspace.ts
 * @brief  Looks a Workspace up once per request for the shell.
 *
 * @description
 *  The Workspace layout and every Workspace page need the same readable
 *  Workspace for the route. The first caller runs the authorized lookup on
 *  the shared request runtime and every later caller in the same request
 *  gets the same answer, so a navigation pays for one Workspace query.
 *
 * @remarks
 *  Authorization stays in the lookup: a Workspace the actor cannot read
 *  resolves to null here just as it did when each page asked on its own.
 *
 * @see
 *  app/(app)/runtime.ts
 *  data/workspace-authorization.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cache } from "react";

import { resolveRequestActor } from "@/app/(app)/actor";
import { withRequestRuntime } from "@/app/(app)/runtime";
import { createReadableWorkspaces } from "@/data/workspace-authorization";
import type { WorkspaceRecord } from "@/data/workspaces";

export const findRequestWorkspace = cache(async (id: string): Promise<WorkspaceRecord | null> => {
  const actor = await resolveRequestActor();
  if (actor?.state !== "Active") return null;
  return withRequestRuntime(({ database }) => createReadableWorkspaces(database, actor).find(id));
});
