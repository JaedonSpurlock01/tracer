/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Workspaces surface.
 *
 * @description
 *  Shows Operators the managed Workspace list with setup actions and shows
 *  Client Viewers a read-only list of their granted Workspaces.
 *
 * @remarks
 *  Workspace setup never activates Twilio routing.
 *
 * @see
 *  components/tracer/workspaces-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import WorkspacesView from "@/components/tracer/workspaces-view";
import { canManageWorkspaces } from "@/data/workspace-authorization";

export default async function WorkspacesPage() {
  const actor = await resolveRequestActor();
  if (actor?.state !== "Active") notFound();
  return <WorkspacesView initialTimezone={actor.timezone} readOnly={!canManageWorkspaces(actor)} />;
}
