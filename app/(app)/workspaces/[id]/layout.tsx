/**
 * -------------------------------------------------------------------------
 * @file   layout.tsx
 * @brief  Refuses an unreadable Workspace and registers a readable one for the shell.
 *
 * @description
 *  Resolves the readable Workspace for the route once, answers Not Found
 *  when the actor cannot read it, and otherwise registers its name as the
 *  breadcrumb label for the id segment and its id, name, state, and the
 *  actor's Operator role for the Workspace Sidebar navigation, then renders
 *  the page.
 *
 * @remarks
 *  The refusal lives here, above the (viewer) and (operator) route groups
 *  and their loading boundaries, so an ungranted Workspace URL answers with
 *  a real 404 status before anything streams; each page keeps its own check
 *  as well. The lookup is the request's one Workspace lookup, shared with
 *  the page through findRequestWorkspace.
 *
 * @see
 *  components/tracer/breadcrumbs.tsx
 *  components/tracer/workspace-nav.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { resolveRequestActor } from "@/app/(app)/actor";
import { findRequestWorkspace } from "@/app/(app)/workspace";
import { BreadcrumbLabel } from "@/components/tracer/breadcrumbs";
import { WorkspaceNav } from "@/components/tracer/workspace-nav";
import { canManageWorkspaces } from "@/data/workspace-authorization";

export default async function WorkspaceLayout({ params, children }: { params: Promise<{ id: string }>; children: ReactNode }) {
  const [actor, { id }] = await Promise.all([resolveRequestActor(), params]);
  const workspace = await findRequestWorkspace(id);
  if (!workspace) notFound();
  return (
    <>
      <BreadcrumbLabel segment={id} label={workspace.name} />
      <WorkspaceNav id={id} name={workspace.name} state={workspace.state} operator={canManageWorkspaces(actor)} />
      {children}
    </>
  );
}
