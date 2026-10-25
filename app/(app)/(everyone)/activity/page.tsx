/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded global Activity surface.
 *
 * @description
 *  Loads the first page of Activity for every Call the actor may read,
 *  filtered as the URL's search and Activity filter parameters ask, on the
 *  server so the timeline renders without a loading Skeleton, together with
 *  the readable Workspaces the Workspace filter offers.
 *
 * @remarks
 *  Operators see every Organization Workspace and Client Viewers only
 *  granted Workspaces; the Activity query enforces that scope. Days and
 *  times render in the user's timezone.
 *
 * @see
 *  data/activity.ts
 *  components/tracer/activity-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import ActivityView from "@/components/tracer/activity-view";
import { withRequestRuntime } from "@/app/(app)/runtime";
import { activityFiltersFromSearchParams } from "@/data/activity-query";
import { loadActivityPage } from "@/data/page-loaders";

export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await resolveRequestActor();
  if (actor?.state !== "Active") notFound();
  const filters = activityFiltersFromSearchParams(await searchParams);
  const { initialResult, workspaceOptions } = await withRequestRuntime((runtime) => loadActivityPage(runtime, actor, filters));
  return <ActivityView initialResult={initialResult} initialFilters={filters} workspaceOptions={workspaceOptions} />;
}
