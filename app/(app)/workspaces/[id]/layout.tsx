/**
 * -------------------------------------------------------------------------
 * @file   layout.tsx
 * @brief  Registers the Workspace for the breadcrumbs and the Sidebar.
 *
 * @description
 *  Resolves the readable Workspace for the route, registers its name as
 *  the breadcrumb label for the id segment and its id, name, state, and
 *  the actor's Operator role for the Workspace Sidebar navigation, then
 *  renders the page.
 *
 * @remarks
 *  Authorization stays with each page, which still returns not found for
 *  a Workspace the actor cannot read; this layout only omits the label
 *  and the Sidebar registration in that case, so the global navigation
 *  stays. The lookup goes through the same actor-scoped repository.
 *
 * @see
 *  components/tracer/breadcrumbs.tsx
 *  components/tracer/workspace-nav.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { ReactNode } from "react";

import { resolveRequestActor } from "@/app/(app)/actor";
import { BreadcrumbLabel } from "@/components/tracer/breadcrumbs";
import { WorkspaceNav } from "@/components/tracer/workspace-nav";
import { canManageWorkspaces, createReadableWorkspaces } from "@/data/workspace-authorization";
import { withTracerRuntime } from "@/data/tracer-runtime";

export default async function WorkspaceLayout({ params, children }: { params: Promise<{ id: string }>; children: ReactNode }) {
  const [actor, { id }] = await Promise.all([resolveRequestActor(), params]);
  const workspace =
    actor?.state === "Active"
      ? await withTracerRuntime(({ pool }) => createReadableWorkspaces(pool, actor).find(id))
          .then((found) => (found ? { name: found.name, state: found.state } : null))
          .catch(() => null)
      : null;
  return (
    <>
      {workspace ? (
        <>
          <BreadcrumbLabel segment={id} label={workspace.name} />
          <WorkspaceNav id={id} name={workspace.name} state={workspace.state} operator={canManageWorkspaces(actor)} />
        </>
      ) : null}
      {children}
    </>
  );
}
