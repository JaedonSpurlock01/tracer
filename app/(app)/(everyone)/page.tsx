/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the authenticated Tracer Home dashboard.
 *
 * @description
 *  Loads the analytics summary for every Workspace the actor can read over
 *  the range in the URL, in the actor's timezone, and the five newest Calls
 *  in the same scope, and for Operators this calendar month's cost,
 *  revenue, and profit across those Workspaces in the actor's timezone,
 *  then renders the Home dashboard. A one-Workspace
 *  Client Viewer lands on that Workspace Overview instead; Operators and
 *  multi-Workspace Client Viewers get Home scoped to what they can read.
 *
 * @remarks
 *  The summary and Recent Calls load as separate regions, so a failure in
 *  one renders that region's Retry while the other still renders. Recent
 *  Calls read the first page of the global Calls list in its default
 *  order, the same list a Recent Calls row returns to. Generate Report
 *  offers the readable Workspaces with the actor's account timezone. View Calls carries
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
import { withRequestRuntime } from "@/app/(app)/runtime";
import HomeDashboard from "@/components/tracer/home-dashboard";
import { analyticsCallsHref, analyticsRangeFromSearchParams, calendarDateInTimeZone } from "@/data/analytics-range";
import { loadHomePage } from "@/data/page-loaders";
import { canManageWorkspaces } from "@/data/workspace-authorization";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await resolveRequestActor();
  if (actor?.state !== "Active") notFound();
  const operator = canManageWorkspaces(actor);
  const range = analyticsRangeFromSearchParams(await searchParams);
  const data = await withRequestRuntime((runtime) => loadHomePage(runtime, actor, range));
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
      reportScope={{ kind: "global", workspaces: data.workspaces, accountTimeZone: actor.timezone }}
      money={data.money}
    />
  );
}
