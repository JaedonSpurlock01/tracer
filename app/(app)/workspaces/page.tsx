/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Workspaces surface.
 *
 * @description
 *  Shows Operators the managed Workspace list with setup actions and shows
 *  Client Viewers a read-only list of their granted Workspaces. The requested
 *  page of the list is loaded on the server from the URL's search, state, and
 *  page parameters so the list renders without a loading Skeleton.
 *
 * @remarks
 *  Workspace setup never activates Twilio routing. The list's default page
 *  size of 10 matches the client view.
 *
 * @see
 *  components/tracer/workspaces-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import WorkspacesView from "@/components/tracer/workspaces-view";
import { canManageWorkspaces, createReadableWorkspaces } from "@/data/workspace-authorization";
import { workspaceListQueryFromSearchParams } from "@/data/workspaces";
import { withTracerRuntime } from "@/data/tracer-runtime";

export default async function WorkspacesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await resolveRequestActor();
  if (actor?.state !== "Active") notFound();
  const query = workspaceListQueryFromSearchParams(await searchParams);
  const initialResult = await withTracerRuntime(({ pool }) => createReadableWorkspaces(pool, actor).list(query));
  return (
    <WorkspacesView
      initialTimezone={actor.timezone}
      initialResult={initialResult}
      initialQuery={query}
      readOnly={!canManageWorkspaces(actor)}
    />
  );
}
