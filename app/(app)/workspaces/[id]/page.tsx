/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Workspace Overview route.
 *
 * @description
 *  Resolves one Workspace the actor may read and renders the setup-aware
 *  overview. Client Viewers see a read-only Overview of granted Workspaces.
 *
 * @remarks
 *  Organization and Access Grant scoping are enforced by the central
 *  Workspace authorization policy, so ungranted Workspaces return not found.
 *
 * @see
 *  components/tracer/workspace-overview.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import WorkspaceOverview from "@/components/tracer/workspace-overview";
import { canManageWorkspaces, createReadableWorkspaces } from "@/data/workspace-authorization";
import { createWorkspaceRoutingFromRuntime } from "@/data/workspace-routing-runtime";
import { withTracerRuntime } from "@/data/tracer-runtime";

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveRequestActor();
  if (actor?.state !== "Active") notFound();
  const { id } = await params;
  const data = await withTracerRuntime(async (runtime) => {
    const workspace = await createReadableWorkspaces(runtime.pool, actor).find(id);
    if (!workspace) return null;
    const routing = createWorkspaceRoutingFromRuntime(runtime, actor.organizationId);
    return { workspace, flow: await routing.getFlow(id) };
  });
  if (!data) notFound();
  return (
    <WorkspaceOverview
      workspace={data.workspace}
      flow={{ published: data.flow.published }}
      readOnly={!canManageWorkspaces(actor)}
    />
  );
}
