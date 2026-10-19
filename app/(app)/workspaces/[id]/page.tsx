/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Workspace Overview route.
 *
 * @description
 *  Resolves one Workspace the actor may read and renders the setup-aware
 *  overview with its analytics over the range in the URL, its routing
 *  health, and its Recent Calls. Client Viewers see a read-only Overview
 *  of granted Workspaces.
 *
 * @remarks
 *  Organization and Access Grant scoping are enforced by the central
 *  Workspace authorization policy, so ungranted Workspaces return not found.
 *  The analytics summary, routing health, and Recent Calls load as separate
 *  regions, so a failure in one renders that region's Retry while the rest
 *  still render. The summary resolves the range in the Workspace reporting
 *  timezone, and View Calls carries the same dates as the Started filter.
 *
 * @see
 *  components/tracer/workspace-overview.tsx
 *  data/analytics.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import WorkspaceOverview from "@/components/tracer/workspace-overview";
import { createAnalytics } from "@/data/analytics";
import { analyticsCallsHref, analyticsRangeFromSearchParams, calendarDateInTimeZone } from "@/data/analytics-range";
import { createCallDetails } from "@/data/call-details";
import { canManageWorkspaces, createReadableWorkspaces } from "@/data/workspace-authorization";
import { createWorkspaceRoutingFromRuntime } from "@/data/workspace-routing-runtime";
import { withTracerRuntime } from "@/data/tracer-runtime";

function orNull<T>(promise: Promise<T>): Promise<T | null> {
  return promise.catch(() => null);
}

export default async function WorkspacePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await resolveRequestActor();
  if (actor?.state !== "Active") notFound();
  const { id } = await params;
  const range = analyticsRangeFromSearchParams(await searchParams);
  const data = await withTracerRuntime(async (runtime) => {
    const workspace = await createReadableWorkspaces(runtime.pool, actor).find(id);
    if (!workspace) return null;
    const routing = createWorkspaceRoutingFromRuntime(runtime, actor.organizationId);
    const analytics = createAnalytics(runtime.pool, actor);
    const [flow, recentCalls, summary, routingHealth] = await Promise.all([
      routing.getFlow(id),
      orNull(createCallDetails(runtime.pool, actor).listRecent(id).then((calls) => calls ?? [])),
      orNull(analytics.summary({ workspaceId: id, range })),
      orNull(analytics.routingHealth(id)),
    ]);
    return { workspace, flow, recentCalls, summary, routingHealth };
  });
  if (!data) notFound();
  return (
    <WorkspaceOverview
      workspace={data.workspace}
      flow={{ published: data.flow.published }}
      readOnly={!canManageWorkspaces(actor)}
      recentCalls={data.recentCalls}
      routingHealth={data.routingHealth}
      analytics={{
        range,
        summary: data.summary,
        callsHref: analyticsCallsHref(`/workspaces/${id}/calls`, range, calendarDateInTimeZone(new Date(), data.workspace.reportingTimezone)),
      }}
    />
  );
}
