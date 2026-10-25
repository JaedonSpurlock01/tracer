/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the global Reports page.
 *
 * @description
 *  Loads the Workspaces the actor can read, for the Generate Report
 *  Workspace multi-select, and renders Reports with the actor's account
 *  timezone as the default document timezone and the history timezone.
 *
 * @remarks
 *  Report history loads on the client from the Reports API through the
 *  shell's shared jobs provider, which only ever lists the requester's own
 *  jobs. The Reports API rechecks every Workspace on each request.
 *
 * @see
 *  components/tracer/reports-view.tsx
 *  data/reports-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import ReportsView from "@/components/tracer/reports-view";
import { createCallList } from "@/data/calls";
import { withRequestRuntime } from "@/app/(app)/runtime";

export default async function ReportsPage() {
  const actor = await resolveRequestActor();
  if (actor?.state !== "Active") notFound();
  const workspaces = await withRequestRuntime(({ database }) => createCallList(database, actor).workspaceOptions());
  return <ReportsView scope={{ kind: "global", workspaces, accountTimeZone: actor.timezone }} />;
}
