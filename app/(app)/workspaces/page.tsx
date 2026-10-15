/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Operator Workspaces surface.
 *
 * @description
 *  Restricts Workspace management to Active Operators and passes the account
 *  timezone into the initial Workspace setup form.
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
import { isActiveOperatorActor } from "@/data/authorization";

export default async function WorkspacesPage() {
  const actor = await resolveRequestActor();
  if (!isActiveOperatorActor(actor)) notFound();
  return <WorkspacesView initialTimezone={actor.timezone} />;
}
