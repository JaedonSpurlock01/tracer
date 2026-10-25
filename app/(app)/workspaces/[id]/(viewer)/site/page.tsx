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
import { findRequestWorkspace } from "@/app/(app)/workspace";
import { withRequestRuntime } from "@/app/(app)/runtime";
import SiteView from "@/components/tracer/site-view";
import { analyticsRangeFromSearchParams } from "@/data/analytics-range";
import { createRuntimeCloudflareClient } from "@/data/cloudflare-runtime";
import { loadSitePage } from "@/data/page-loaders";
import { canManageWorkspaces } from "@/data/workspace-authorization";

export default async function WorkspaceSitePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await resolveRequestActor();
  if (actor?.state !== "Active") notFound();
  const { id } = await params;
  const range = analyticsRangeFromSearchParams(await searchParams);
  const workspace = await findRequestWorkspace(id);
  if (!workspace) notFound();
  const data = await withRequestRuntime((runtime) => loadSitePage(runtime, actor, workspace, range, createRuntimeCloudflareClient()));
  return (
    <SiteView
      workspace={workspace}
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
