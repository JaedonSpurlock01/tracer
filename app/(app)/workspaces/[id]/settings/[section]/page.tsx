/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders one guarded Workspace Settings section page.
 *
 * @description
 *  Restricts Workspace settings to Active Operators, resolves a scoped
 *  Workspace, and renders the requested section behind the settings rail.
 *
 * @remarks
 *  Unknown section names return Not Found. Settings remain separate from
 *  provider integration mutation.
 *
 * @see
 *  components/tracer/workspace-settings-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import { workspaceSettingsSections } from "@/components/tracer/workspace-settings-sections";
import WorkspaceSettingsView from "@/components/tracer/workspace-settings-view";
import { isActiveOperatorActor } from "@/data/authorization";
import { createWorkspaces } from "@/data/workspaces";
import { withTracerRuntime } from "@/data/tracer-runtime";

export default async function WorkspaceSettingsSectionPage({ params }: { params: Promise<{ id: string; section: string }> }) {
  const actor = await resolveRequestActor();
  if (!isActiveOperatorActor(actor)) notFound();
  const { id, section } = await params;
  const match = workspaceSettingsSections.find((item) => item.slug === section);
  if (!match) notFound();
  const workspace = await withTracerRuntime(({ pool }) => createWorkspaces(pool, actor.organizationId).find(id));
  if (!workspace) notFound();
  return <WorkspaceSettingsView initialWorkspace={workspace} section={match.slug} />;
}
