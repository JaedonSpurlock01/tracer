/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Workspace Calls surface.
 *
 * @description
 *  Reuses the Calls Data Grid with the Workspace scope fixed, loading the
 *  requested page on the server from the URL's page, sort, search, and
 *  filter parameters. The Workspace filter is omitted because the scope is
 *  fixed.
 *
 * @remarks
 *  The Calls query resolves the Workspace through the central Workspace
 *  authorization, so an ungranted, missing, or other-Organization
 *  Workspace renders Not Found. Dates render in the Workspace reporting
 *  timezone.
 *
 * @see
 *  data/calls.ts
 *  components/tracer/calls-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import CallsView from "@/components/tracer/calls-view";
import { callListQueryFromSearchParams } from "@/data/call-list-query";
import { createCallList } from "@/data/calls";
import { withTracerRuntime } from "@/data/tracer-runtime";
import { canManageWorkspaces } from "@/data/workspace-authorization";

export default async function WorkspaceCallsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await resolveRequestActor();
  if (actor?.state !== "Active") notFound();
  const { id } = await params;
  const query = callListQueryFromSearchParams(await searchParams);
  const initialResult = await withTracerRuntime(({ pool }) => createCallList(pool, actor).list({ ...query, workspaceId: id }));
  if (!initialResult?.workspace) notFound();
  return <CallsView initialResult={initialResult} initialQuery={query} workspace={initialResult.workspace} operator={canManageWorkspaces(actor)} />;
}
