/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Workspace Forms page.
 *
 * @description
 *  Resolves the readable Workspace's Form Submissions through the
 *  authorized Form Submissions service and renders the Forms ledger.
 *  Client Viewers get the read-only list, which carries no Forwarding
 *  Recipients and shows no actions.
 *
 * @remarks
 *  The list goes through the central authorization policy, so an
 *  ungranted Workspace renders Not Found.
 *
 * @see
 *  components/tracer/forms-view.tsx
 *  data/form-submissions.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import FormsView from "@/components/tracer/forms-view";
import { createFormSubmissions } from "@/data/form-submissions";
import { withRequestRuntime } from "@/app/(app)/runtime";
import { canManageWorkspaces } from "@/data/workspace-authorization";

export default async function WorkspaceFormsPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveRequestActor();
  if (actor?.state !== "Active") notFound();
  const { id } = await params;
  const list = await withRequestRuntime((runtime) => createFormSubmissions(runtime.database, actor, runtime.email).list(id));
  if (!list) notFound();
  return <FormsView list={list} readOnly={!canManageWorkspaces(actor)} />;
}
