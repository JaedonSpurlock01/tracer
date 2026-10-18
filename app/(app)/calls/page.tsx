/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded global Calls surface.
 *
 * @description
 *  Loads the requested page of every Call the actor may read, sorted and
 *  filtered as the URL's page, sort, search, and filter parameters ask, on
 *  the server so the Calls Data Grid renders without a loading Skeleton,
 *  together with the readable Workspaces the Workspace filter offers.
 *
 * @remarks
 *  Operators see every Organization Workspace and Client Viewers only
 *  granted Workspaces; the Calls query enforces that scope. Dates render in
 *  the user's timezone.
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

export default async function CallsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await resolveRequestActor();
  if (actor?.state !== "Active") notFound();
  const query = callListQueryFromSearchParams(await searchParams);
  const [initialResult, workspaceOptions] = await withTracerRuntime(({ pool }) => {
    const calls = createCallList(pool, actor);
    return Promise.all([calls.list(query), calls.workspaceOptions()]);
  });
  if (!initialResult) notFound();
  return <CallsView initialResult={initialResult} initialQuery={query} workspaceOptions={workspaceOptions} />;
}
