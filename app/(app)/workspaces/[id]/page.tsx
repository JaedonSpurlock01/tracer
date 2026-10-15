/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Workspace Overview route.
 *
 * @description
 *  Resolves one Organization Workspace for an Active Operator and renders the
 *  setup-aware overview stub.
 *
 * @remarks
 *  Organization scoping remains enforced by the Workspace service.
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
import { isActiveOperatorActor } from "@/data/authorization";
import { createWorkspaces } from "@/data/workspaces";
import { withTracerRuntime } from "@/data/tracer-runtime";

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveRequestActor();
  if (!isActiveOperatorActor(actor)) notFound();
  const { id } = await params;
  const workspace = await withTracerRuntime(({ pool }) => createWorkspaces(pool, actor.organizationId).find(id));
  if (!workspace) notFound();
  return <WorkspaceOverview workspace={workspace} />;
}
