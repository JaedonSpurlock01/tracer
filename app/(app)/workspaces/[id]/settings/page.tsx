/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Workspace Settings route.
 *
 * @description
 *  Restricts Workspace settings to Active Operators and resolves a scoped
 *  Workspace before rendering its General and lifecycle settings.
 *
 * @remarks
 *  Settings remain separate from provider integration mutation.
 *
 * @see
 *  components/tracer/workspace-settings-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import WorkspaceSettingsView from "@/components/tracer/workspace-settings-view";
import { isActiveOperatorActor } from "@/data/authorization";
import { createWorkspaces } from "@/data/workspaces";
import { withTracerRuntime } from "@/data/tracer-runtime";

export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveRequestActor();
  if (!isActiveOperatorActor(actor)) notFound();
  const { id } = await params;
  const workspace = await withTracerRuntime(({ pool }) => createWorkspaces(pool, actor.organizationId).find(id));
  if (!workspace) notFound();
  return <WorkspaceSettingsView initialWorkspace={workspace} />;
}
