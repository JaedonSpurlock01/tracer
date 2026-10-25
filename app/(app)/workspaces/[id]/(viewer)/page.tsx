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
import { findRequestWorkspace } from "@/app/(app)/workspace";
import { withRequestRuntime } from "@/app/(app)/runtime";
import WorkspaceOverview from "@/components/tracer/workspace-overview";
import { analyticsCallsHref, analyticsRangeFromSearchParams, calendarDateInTimeZone } from "@/data/analytics-range";
import { loadWorkspaceOverviewPage } from "@/data/page-loaders";
import { createRuntimeTwilioClient } from "@/data/twilio-runtime";
import { canManageWorkspaces } from "@/data/workspace-authorization";

export default async function WorkspacePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await resolveRequestActor();
  if (actor?.state !== "Active") notFound();
  const { id } = await params;
  const range = analyticsRangeFromSearchParams(await searchParams);
  const workspace = await findRequestWorkspace(id);
  if (!workspace) notFound();
  const data = await withRequestRuntime((runtime) => loadWorkspaceOverviewPage(runtime, actor, workspace, range, createRuntimeTwilioClient()));
  return (
    <WorkspaceOverview
      workspace={workspace}
      flow={data.flow}
      readOnly={!canManageWorkspaces(actor)}
      recentCalls={data.recentCalls}
      routingHealth={data.routingHealth}
      site={data.site}
      money={data.money}
      analytics={{
        range,
        summary: data.summary,
        callsHref: analyticsCallsHref(`/workspaces/${id}/calls`, range, calendarDateInTimeZone(new Date(), workspace.reportingTimezone)),
      }}
    />
  );
}
