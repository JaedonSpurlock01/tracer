/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Workspace Flow editor route.
 *
 * @description
 *  Resolves an Organization Workspace and its Call Flow state for an Active
 *  Operator before rendering the editor.
 *
 * @remarks
 *  Authorization and Organization scoping remain server boundaries.
 *
 * @see
 *  components/tracer/workspace-flow-editor.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import WorkspaceFlowEditor from "@/components/tracer/workspace-flow-editor";
import { isActiveOperatorActor } from "@/data/authorization";
import { createWorkspaceRoutingFromRuntime } from "@/data/workspace-routing-runtime";
import { createWorkspaces } from "@/data/workspaces";
import { withTracerRuntime } from "@/data/tracer-runtime";

export default async function WorkspaceFlowPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveRequestActor();
  if (!isActiveOperatorActor(actor)) notFound();
  const { id } = await params;
  const data = await withTracerRuntime(async (runtime) => {
    const workspaces = createWorkspaces(runtime.pool, actor.organizationId);
    const workspace = await workspaces.find(id);
    if (!workspace) return null;
    const flow = await createWorkspaceRoutingFromRuntime(runtime, actor.organizationId).getFlow(id);
    return { workspace, flow };
  });
  if (!data) notFound();
  return <WorkspaceFlowEditor workspace={data.workspace} initialFlow={data.flow} />;
}
