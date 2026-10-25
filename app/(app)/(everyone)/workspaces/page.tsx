/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Workspaces surface.
 *
 * @description
 *  Shows Operators the managed Workspace list with setup actions and shows
 *  Client Viewers a read-only list of their granted Workspaces. The requested
 *  page of the list is loaded on the server from the URL's search, state, and
 *  page parameters so the list renders without a loading Skeleton, and
 *  Operators also learn whether Cloudflare is connected so the wizard's
 *  Site step can offer the picker or explain the missing connection, with
 *  each listed Workspace's 30-day Calls, Good Leads, last Call, and
 *  integration health from the analytics service.
 *
 * @remarks
 *  Workspace setup never activates Twilio routing. The list's default page
 *  size of 10 matches the client view.
 *
 * @see
 *  components/tracer/workspaces-view.tsx
 *  data/analytics.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import { withRequestRuntime } from "@/app/(app)/runtime";
import WorkspacesView from "@/components/tracer/workspaces-view";
import { createRuntimeCloudflareClient } from "@/data/cloudflare-runtime";
import { loadWorkspacesPage } from "@/data/page-loaders";
import { canManageWorkspaces } from "@/data/workspace-authorization";
import { workspaceListQueryFromSearchParams } from "@/data/workspaces";

export default async function WorkspacesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await resolveRequestActor();
  if (actor?.state !== "Active") notFound();
  const query = workspaceListQueryFromSearchParams(await searchParams);
  const operator = canManageWorkspaces(actor);
  const { initialResult, cloudflareConnected } = await withRequestRuntime((runtime) => loadWorkspacesPage(runtime, actor, query, createRuntimeCloudflareClient()));
  return (
    <WorkspacesView
      initialTimezone={actor.timezone}
      initialResult={initialResult}
      initialQuery={query}
      readOnly={!operator}
      cloudflareConnected={cloudflareConnected}
    />
  );
}
