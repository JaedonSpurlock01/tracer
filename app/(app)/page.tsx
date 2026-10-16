/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the authenticated Tracer Home surface.
 *
 * @description
 *  Provides the Operator landing page while operational dashboards are
 *  delivered by later milestones, and sends Client Viewers to their granted
 *  Workspaces.
 *
 * @remarks
 *  Home stays compact until Workspaces receive Calls. Until the scoped Home
 *  dashboard exists, a one-Workspace Client Viewer lands on that Workspace
 *  Overview and any other Client Viewer lands on the Workspaces list.
 *
 * @see
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { redirect } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import { canManageWorkspaces, createReadableWorkspaces } from "@/data/workspace-authorization";
import { withTracerRuntime } from "@/data/tracer-runtime";

export default async function Home() {
  const actor = await resolveRequestActor();
  if (actor?.state === "Active" && !canManageWorkspaces(actor)) {
    const granted = await withTracerRuntime(({ pool }) => createReadableWorkspaces(pool, actor).list({ pageSize: 2 }));
    redirect(granted.total === 1 ? `/workspaces/${granted.workspaces[0].id}` : "/workspaces");
  }

  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
      <p className="text-sm text-muted-foreground">Operational dashboards arrive once Workspaces receive Calls.</p>
    </div>
  );
}
