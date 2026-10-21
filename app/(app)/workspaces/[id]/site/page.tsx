/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Workspace Site page.
 *
 * @description
 *  Resolves the readable Workspace, loads its linked Site, the Site's
 *  traffic summary over the range in the URL, the Call analytics summary
 *  over the same range for Calls and Visit-to-Call, the Search read model
 *  with the Search Visibility score, whether the Organization's
 *  Cloudflare account is connected, and for Operators this month's cost,
 *  revenue, profit, and open Deal, then renders the Site view. Client Viewers get the read-only response without hosting data
 *  or Cloudflare identifiers.
 *
 * @remarks
 *  The Site, its traffic, and the Call analytics load as separate regions
 *  so a failure in one renders that region's Retry while the rest still
 *  render. The Workspace lookup goes through the central authorization
 *  policy, so an ungranted Workspace renders Not Found.
 *
 * @see
 *  components/tracer/site-view.tsx
 *  data/sites.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import SiteView from "@/components/tracer/site-view";
import { createAnalytics } from "@/data/analytics";
import { analyticsRangeFromSearchParams } from "@/data/analytics-range";
import { createCloudflareConnection } from "@/data/cloudflare-connection";
import { createRuntimeCloudflareClient } from "@/data/cloudflare-runtime";
import { calendarMonth, createCostRevenue, monthLabel } from "@/data/cost-revenue";
import { siteSearch } from "@/data/site-search";
import { createSites, siteResponseForActor, summaryResponseForActor } from "@/data/sites";
import { withTracerRuntime } from "@/data/tracer-runtime";
import { canManageWorkspaces, createReadableWorkspaces } from "@/data/workspace-authorization";

function orNull<T>(promise: Promise<T>): Promise<T | null> {
  return promise.catch(() => null);
}

export default async function WorkspaceSitePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await resolveRequestActor();
  if (actor?.state !== "Active") notFound();
  const { id } = await params;
  const range = analyticsRangeFromSearchParams(await searchParams);
  const data = await withTracerRuntime(async (runtime) => {
    const workspace = await createReadableWorkspaces(runtime.pool, actor).find(id);
    if (!workspace) return null;
    const sites = createSites(runtime.pool, actor);
    const cloudflare = createCloudflareConnection({ pool: runtime.pool, organizationId: actor.organizationId, cloudflare: createRuntimeCloudflareClient(), masterKey: runtime.masterKey });
    const operator = canManageWorkspaces(actor);
    const month = calendarMonth(new Date(), workspace.reportingTimezone);
    const [site, analytics, connection, money] = await Promise.all([
      sites.findLinked(id).catch(() => undefined),
      orNull(createAnalytics(runtime.pool, actor).summary({ workspaceId: id, range })),
      orNull(cloudflare.getCloudflareConnection()),
      operator ? orNull(createCostRevenue(runtime.pool, actor).monthly([id], month).then((monthly) => (monthly[id] ? { ...monthly[id], month: monthLabel(month) } : null))) : undefined,
    ]);
    const [summary, search] = site
      ? await Promise.all([orNull(sites.summary(site.id, range, workspace.reportingTimezone)), orNull(siteSearch(runtime.pool, site.id, workspace.reportingTimezone))])
      : [null, undefined];
    return {
      workspace,
      site: site ? siteResponseForActor(actor, site) : site,
      summary: summary ? summaryResponseForActor(actor, summary) : null,
      search,
      analytics,
      cloudflareConnected: connection !== null,
      money,
    };
  });
  if (!data) notFound();
  return (
    <SiteView
      workspace={data.workspace}
      site={data.site}
      summary={data.summary}
      analytics={data.analytics}
      range={range}
      search={data.search}
      readOnly={!canManageWorkspaces(actor)}
      cloudflareConnected={data.cloudflareConnected}
      money={data.money}
    />
  );
}
