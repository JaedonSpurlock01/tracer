/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the authenticated Tracer Home dashboard.
 *
 * @description
 *  Loads the analytics summary for every Workspace the actor can read over
 *  the range in the URL, in the actor's timezone, and the five newest Calls
 *  in the same scope, then renders the Home dashboard. A one-Workspace
 *  Client Viewer lands on that Workspace Overview instead; Operators and
 *  multi-Workspace Client Viewers get Home scoped to what they can read.
 *
 * @remarks
 *  The summary and Recent Calls load as separate regions, so a failure in
 *  one renders that region's Retry while the other still renders. Recent
 *  Calls read the first page of the global Calls list in its default
 *  order, the same list a Recent Calls row returns to. View Calls carries
 *  the range as the Calls Started filter, resolved against today in the
 *  actor's timezone like the summary.
 *
 * @see
 *  components/tracer/home-dashboard.tsx
 *  data/analytics.ts
 *  data/calls.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound, redirect } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import HomeDashboard from "@/components/tracer/home-dashboard";
import { createAnalytics } from "@/data/analytics";
import { analyticsCallsHref, analyticsRangeFromSearchParams, calendarDateInTimeZone } from "@/data/analytics-range";
import { defaultCallSort, emptyCallFilters } from "@/data/call-list-query";
import { createCallList } from "@/data/calls";
import { canManageWorkspaces, createReadableWorkspaces } from "@/data/workspace-authorization";
import { withTracerRuntime } from "@/data/tracer-runtime";

function orNull<T>(promise: Promise<T>): Promise<T | null> {
  return promise.catch(() => null);
}

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await resolveRequestActor();
  if (actor?.state !== "Active") notFound();
  const operator = canManageWorkspaces(actor);
  const range = analyticsRangeFromSearchParams(await searchParams);
  const data = await withTracerRuntime(async ({ pool }) => {
    const readable = await createReadableWorkspaces(pool, actor).list({ pageSize: 2 });
    if (!operator && readable.total === 1) return { onlyWorkspaceId: readable.workspaces[0].id };
    if (!operator && readable.total === 0) return { noWorkspaces: true as const };
    if (readable.total === 0) return { workspaceCount: 0, summary: null, recentCalls: null };
    const [summary, recentCalls] = await Promise.all([
      orNull(createAnalytics(pool, actor).summary({ range })),
      orNull(createCallList(pool, actor).list({ page: 1, sort: defaultCallSort, filters: emptyCallFilters })),
    ]);
    return { workspaceCount: readable.total, summary, recentCalls };
  });
  if ("onlyWorkspaceId" in data) redirect(`/workspaces/${data.onlyWorkspaceId}`);
  if ("noWorkspaces" in data) redirect("/workspaces");

  return (
    <HomeDashboard
      operator={operator}
      workspaceCount={data.workspaceCount}
      range={range}
      summary={data.summary}
      recentCalls={data.recentCalls}
      callsHref={analyticsCallsHref("/calls", range, calendarDateInTimeZone(new Date(), actor.timezone))}
    />
  );
}
