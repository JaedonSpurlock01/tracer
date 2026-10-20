/**
 * -------------------------------------------------------------------------
 * @file   layout.tsx
 * @brief  Names the Workspace segment in the header breadcrumbs.
 *
 * @description
 *  Resolves the readable Workspace for the route and registers its name as
 *  the breadcrumb label for the id segment, then renders the page.
 *
 * @remarks
 *  Authorization stays with each page, which still returns not found for
 *  a Workspace the actor cannot read; this layout only omits the label in
 *  that case. The lookup goes through the same actor-scoped repository.
 *
 * @see
 *  components/tracer/breadcrumbs.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { ReactNode } from "react";

import { resolveRequestActor } from "@/app/(app)/actor";
import { BreadcrumbLabel } from "@/components/tracer/breadcrumbs";
import { createReadableWorkspaces } from "@/data/workspace-authorization";
import { withTracerRuntime } from "@/data/tracer-runtime";

export default async function WorkspaceLayout({ params, children }: { params: Promise<{ id: string }>; children: ReactNode }) {
  const [actor, { id }] = await Promise.all([resolveRequestActor(), params]);
  const name =
    actor?.state === "Active"
      ? await withTracerRuntime(({ pool }) => createReadableWorkspaces(pool, actor).find(id))
          .then((workspace) => workspace?.name ?? null)
          .catch(() => null)
      : null;
  return (
    <>
      {name ? <BreadcrumbLabel segment={id} label={name} /> : null}
      {children}
    </>
  );
}
