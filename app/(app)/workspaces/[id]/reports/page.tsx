/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the Workspace Reports page.
 *
 * @description
 *  Reuses Reports with the scope fixed to this Workspace and its reporting
 *  timezone. A Workspace the actor cannot read renders Not Found.
 *
 * @remarks
 *  Every role sees this page. The Reports API authorizes each request
 *  against the Workspace again.
 *
 * @see
 *  components/tracer/reports-view.tsx
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import ReportsView from "@/components/tracer/reports-view";
import { withTracerRuntime } from "@/data/tracer-runtime";
import { createReadableWorkspaces } from "@/data/workspace-authorization";

export default async function WorkspaceReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveRequestActor();
  if (actor?.state !== "Active") notFound();
  const { id } = await params;
  const workspace = await withTracerRuntime(({ pool }) => createReadableWorkspaces(pool, actor).find(id));
  if (!workspace) notFound();
  return <ReportsView scope={{ kind: "workspace", workspace: { id: workspace.id, name: workspace.name, reportingTimezone: workspace.reportingTimezone } }} />;
}
