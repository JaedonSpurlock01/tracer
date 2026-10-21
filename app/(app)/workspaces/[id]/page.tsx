/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Workspace Overview route.
 *
 * @description
 *  Resolves one Workspace the actor may read and renders the setup-aware
 *  overview with its analytics over the range in the URL, its linked Site
 *  with the Site's traffic over the same range, its routing health, its
 *  Recent Calls, and for Operators this month's cost and profit with the
 *  open Deal. Client Viewers see a read-only Overview of granted
 *  Workspaces without cost or Deal.
 *
 * @remarks
 *  Organization and Access Grant scoping are enforced by the central
 *  Workspace authorization policy, so ungranted Workspaces return not found.
 *  The analytics summary, routing health, Recent Calls, and the Site with
 *  its traffic load as separate regions, so a failure in one renders that
 *  region's Retry while the rest still render. The summary resolves the range in the Workspace reporting
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
import { calendarMonth, createCostRevenue, monthLabel } from "@/data/cost-revenue";
import { siteSearch } from "@/data/site-search";
import { createSites, siteResponseForActor, summaryResponseForActor } from "@/data/sites";
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
    const sites = createSites(runtime.pool, actor);
    const operator = canManageWorkspaces(actor);
    const month = calendarMonth(new Date(), workspace.reportingTimezone);
    const [flow, recentCalls, summary, routingHealth, site, money] = await Promise.all([
      routing.getFlow(id),
      orNull(createCallDetails(runtime.pool, actor).listRecent(id).then((calls) => calls ?? [])),
      orNull(analytics.summary({ workspaceId: id, range })),
      orNull(analytics.routingHealth(id)),
      orNull(
        sites.findLinked(id).then(async (linked) => ({
          record: linked ? siteResponseForActor(actor, linked) : null,
          summary: linked ? await orNull(sites.summary(linked.id, range, workspace.reportingTimezone).then((traffic) => summaryResponseForActor(actor, traffic))) : null,
          searchScore: linked ? await orNull(siteSearch(runtime.pool, linked.id, workspace.reportingTimezone).then((search) => search?.score ?? null)) : null,
        })),
      ),
      operator
        ? orNull(createCostRevenue(runtime.pool, actor).monthly([id], month).then((monthly) => {
            const row = monthly[id];
            return row ? { month: monthLabel(month), costCents: row.costCents, profitCents: row.profitCents, deal: row.deal } : null;
          }))
        : undefined,
    ]);
    return { workspace, flow, recentCalls, summary, routingHealth, site, money };
  });
  if (!data) notFound();
  return (
    <WorkspaceOverview
      workspace={data.workspace}
      flow={{ published: data.flow.published }}
      readOnly={!canManageWorkspaces(actor)}
      recentCalls={data.recentCalls}
      routingHealth={data.routingHealth}
      site={data.site}
      money={data.money}
      analytics={{
        range,
        summary: data.summary,
        callsHref: analyticsCallsHref(`/workspaces/${id}/calls`, range, calendarDateInTimeZone(new Date(), data.workspace.reportingTimezone)),
      }}
    />
  );
}
