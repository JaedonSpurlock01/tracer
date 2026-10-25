/**
 * -------------------------------------------------------------------------
 * @file   page-loaders.ts
 * @brief  Loads the data each authenticated page renders, as plain functions.
 *
 * @description
 *  Every server page under the shell hands its runtime, actor, and URL
 *  parameters to one loader here and renders what comes back. The loaders
 *  own the order queries run in: independent reads go out together, and a
 *  read that depends on another waits only for that one. The page budget
 *  tests run these same functions against a database and hold each to a
 *  ceiling of sequential waves and total queries, so a loader that starts
 *  awaiting in a chain fails a test before it slows a page.
 *
 * @remarks
 *  Loaders take the runtime pieces they need rather than the whole Tracer
 *  runtime so a test can build them from a pool. Provider clients come in
 *  as arguments for the same reason. A loader never calls notFound or
 *  redirect; it returns what it found and the page decides.
 *
 * @see
 *  app/(app)/runtime.ts
 *  data/request-log.ts
 *  tests/integration/page-budgets.test.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import type { Database } from "@/data/database";
import { createActivity } from "@/data/activity";
import { createAnalytics, withWorkspaceListStats, type AnalyticsSummary, type WorkspaceListWithStats, type WorkspaceRoutingHealth } from "@/data/analytics";
import type { AnalyticsRange } from "@/data/analytics-range";
import type { Actor } from "@/data/authorization";
import { createCallDetails } from "@/data/call-details";
import { defaultCallSort, emptyCallFilters, type CallFilters, type CallListQuery } from "@/data/call-list-query";
import { createCallList, type CallListResult } from "@/data/calls";
import type { CloudflareClient } from "@/data/cloudflare-client";
import { createCloudflareConnection } from "@/data/cloudflare-connection";
import { calendarMonth, costRevenueTotals, createCostRevenue, monthLabel, type WorkspaceCostRevenue } from "@/data/cost-revenue";
import type { DataForSeoClient } from "@/data/dataforseo-client";
import { createFormsKey } from "@/data/form-submissions";
import { createIntegrations } from "@/data/integrations";
import { loadIntegrationsOverview, type IntegrationsOverview } from "@/data/integrations-handler";
import type { ProviderConfiguration } from "@/data/provider-health";
import { siteSearch, type SiteSearch } from "@/data/site-search";
import { createSites, siteResponseForActor, summaryResponseForActor } from "@/data/sites";
import type { TwilioClient } from "@/data/twilio-client";
import { canManageWorkspaces, createReadableWorkspaces } from "@/data/workspace-authorization";
import { createWorkspaceRouting } from "@/data/workspace-routing";
import { createWorkspaces, type WorkspaceListQuery, type WorkspaceRecord } from "@/data/workspaces";

export interface PageRuntime {
  database: Database;
  pool: Pool;
  masterKey: string | undefined;
  baseURL: string;
  providerConfiguration: ProviderConfiguration;
}

function orNull<T>(promise: Promise<T>): Promise<T | null> {
  return promise.catch(() => null);
}

export interface HomeMoneyData {
  month: string;
  totals: ReturnType<typeof costRevenueTotals>;
  byWorkspace: Record<string, { costCents: number; revenueCents: number }>;
}

export type HomePageData =
  | { onlyWorkspaceId: string }
  | { noWorkspaces: true }
  | {
      workspaceCount: number;
      summary: AnalyticsSummary | null;
      recentCalls: CallListResult | null;
      workspaces: { id: string; name: string }[];
      money: HomeMoneyData | null | undefined;
    };

async function homeMoney(pool: Pool, actor: Actor, workspaceIds: string[]): Promise<HomeMoneyData> {
  const month = calendarMonth(new Date(), actor.timezone);
  const monthly = await createCostRevenue(pool, actor).monthly(workspaceIds, month);
  const rows = Object.values(monthly);
  return {
    month: monthLabel(month),
    totals: costRevenueTotals(rows),
    byWorkspace: Object.fromEntries(rows.map((row) => [row.workspaceId, { costCents: row.costCents, revenueCents: row.revenueCents }])),
  };
}

/** Home: the readable Workspaces decide the redirect, then analytics, recent Calls, and money load together. */
export async function loadHomePage(runtime: PageRuntime, actor: Actor, range: AnalyticsRange): Promise<HomePageData> {
  const operator = canManageWorkspaces(actor);
  const calls = createCallList(runtime.pool, actor);
  const workspaces = await calls.workspaceOptions();
  if (!operator && workspaces.length === 1) return { onlyWorkspaceId: workspaces[0].id };
  if (!operator && workspaces.length === 0) return { noWorkspaces: true };
  if (workspaces.length === 0) return { workspaceCount: 0, summary: null, recentCalls: null, workspaces: [], money: undefined };
  const [summary, recentCalls, money] = await Promise.all([
    orNull(createAnalytics(runtime.pool, actor).summary({ range })),
    orNull(calls.list({ page: 1, sort: defaultCallSort, filters: emptyCallFilters })),
    operator ? orNull(homeMoney(runtime.pool, actor, workspaces.map((workspace) => workspace.id))) : undefined,
  ]);
  return { workspaceCount: workspaces.length, summary, recentCalls, workspaces, money };
}

export interface WorkspacesPageData {
  initialResult: WorkspaceListWithStats;
  cloudflareConnected: boolean;
}

/** Workspaces: the list and its stats on one branch, the Cloudflare connection on the other. */
export async function loadWorkspacesPage(runtime: PageRuntime, actor: Actor, query: WorkspaceListQuery, cloudflare: CloudflareClient): Promise<WorkspacesPageData> {
  const operator = canManageWorkspaces(actor);
  const [initialResult, connection] = await Promise.all([
    createReadableWorkspaces(runtime.database, actor).list(query).then((result) => withWorkspaceListStats(createAnalytics(runtime.pool, actor), result)),
    operator
      ? createCloudflareConnection({ database: runtime.database, organizationId: actor.organizationId, cloudflare, masterKey: runtime.masterKey })
          .getCloudflareConnection()
          .catch(() => null)
      : null,
  ]);
  return { initialResult, cloudflareConnected: connection !== null };
}

export interface WorkspaceMoneyData {
  month: string;
  costCents: number;
  profitCents: number;
  deal: WorkspaceCostRevenue["deal"];
}

export interface WorkspaceOverviewPageData {
  flow: { published: Awaited<ReturnType<ReturnType<typeof createWorkspaceRouting>["getFlow"]>>["published"] };
  recentCalls: Awaited<ReturnType<ReturnType<typeof createCallDetails>["listRecent"]>> | null;
  summary: AnalyticsSummary | null;
  routingHealth: WorkspaceRoutingHealth | null;
  site: {
    record: ReturnType<typeof siteResponseForActor> | null;
    summary: ReturnType<typeof summaryResponseForActor> | null;
    searchScore: number | null;
  } | null;
  money: WorkspaceMoneyData | null | undefined;
}

/** Workspace Overview: six independent reads at once; only the Site's summary and score wait for the Site Link. */
export async function loadWorkspaceOverviewPage(runtime: PageRuntime, actor: Actor, workspace: WorkspaceRecord, range: AnalyticsRange, twilio: TwilioClient): Promise<WorkspaceOverviewPageData> {
  const organizationId = actor.organizationId;
  const workspaces = createWorkspaces(runtime.database, organizationId);
  const routing = createWorkspaceRouting({
    database: runtime.database,
    organizationId,
    twilio,
    workspaces,
    integrations: createIntegrations({ database: runtime.database, organizationId, twilio, masterKey: runtime.masterKey }),
    baseURL: runtime.baseURL,
  });
  const analytics = createAnalytics(runtime.pool, actor);
  const sites = createSites(runtime.pool, actor);
  const operator = canManageWorkspaces(actor);
  const month = calendarMonth(new Date(), workspace.reportingTimezone);
  const [flow, recentCalls, summary, routingHealth, site, money] = await Promise.all([
    routing.getFlow(workspace.id),
    orNull(createCallDetails(runtime.pool, actor).listRecent(workspace.id).then((calls) => calls ?? [])),
    orNull(analytics.summary({ workspaceId: workspace.id, range })),
    orNull(analytics.routingHealth(workspace.id)),
    orNull(
      sites.findLinked(workspace.id).then(async (linked) => {
        if (!linked) return { record: null, summary: null, searchScore: null };
        const [traffic, search] = await Promise.all([
          orNull(sites.summary(linked.id, range, workspace.reportingTimezone)),
          orNull(siteSearch(runtime.pool, linked.id, workspace.reportingTimezone)),
        ]);
        return {
          record: siteResponseForActor(actor, linked),
          summary: traffic ? summaryResponseForActor(actor, traffic) : null,
          searchScore: search?.score ?? null,
        };
      }),
    ),
    operator
      ? orNull(createCostRevenue(runtime.pool, actor).monthly([workspace.id], month).then((monthly) => {
          const row = monthly[workspace.id];
          return row ? { month: monthLabel(month), costCents: row.costCents, profitCents: row.profitCents, deal: row.deal } : null;
        }))
      : undefined,
  ]);
  return { flow: { published: flow.published }, recentCalls, summary, routingHealth, site, money };
}

export interface SitePageData {
  site: ReturnType<typeof siteResponseForActor> | null | undefined;
  summary: ReturnType<typeof summaryResponseForActor> | null;
  search: SiteSearch | null | undefined;
  analytics: AnalyticsSummary | null;
  cloudflareConnected: boolean;
  money: (WorkspaceCostRevenue & { month: string }) | null | undefined;
}

/** Site: the Site Link, analytics, connection, and money together, then the Site's traffic and Search together. */
export async function loadSitePage(runtime: PageRuntime, actor: Actor, workspace: WorkspaceRecord, range: AnalyticsRange, cloudflare: CloudflareClient): Promise<SitePageData> {
  const sites = createSites(runtime.pool, actor);
  const connection = createCloudflareConnection({ database: runtime.database, organizationId: actor.organizationId, cloudflare, masterKey: runtime.masterKey });
  const operator = canManageWorkspaces(actor);
  const month = calendarMonth(new Date(), workspace.reportingTimezone);
  const [site, analytics, cloudflareRecord, money] = await Promise.all([
    sites.findLinked(workspace.id).catch(() => undefined),
    orNull(createAnalytics(runtime.pool, actor).summary({ workspaceId: workspace.id, range })),
    orNull(connection.getCloudflareConnection()),
    operator ? orNull(createCostRevenue(runtime.pool, actor).monthly([workspace.id], month).then((monthly) => (monthly[workspace.id] ? { ...monthly[workspace.id], month: monthLabel(month) } : null))) : undefined,
  ]);
  const [summary, search] = site
    ? await Promise.all([orNull(sites.summary(site.id, range, workspace.reportingTimezone)), orNull(siteSearch(runtime.pool, site.id, workspace.reportingTimezone))])
    : [null, undefined];
  return {
    site: site ? siteResponseForActor(actor, site) : site,
    summary: summary ? summaryResponseForActor(actor, summary) : null,
    search,
    analytics,
    cloudflareConnected: cloudflareRecord !== null,
    money,
  };
}

export interface IntegrationsClients {
  twilio: TwilioClient;
  cloudflare: CloudflareClient;
  dataforseo: DataForSeoClient;
}

/** Integrations: one parallel pass over the three connections, health, numbers, Sites, and the Forms key. */
export async function loadIntegrationsPage(runtime: PageRuntime, actor: Actor, clients: IntegrationsClients): Promise<IntegrationsOverview> {
  const integrations = createIntegrations({
    database: runtime.database,
    organizationId: actor.organizationId,
    twilio: clients.twilio,
    cloudflare: clients.cloudflare,
    dataforseo: clients.dataforseo,
    masterKey: runtime.masterKey,
  });
  return loadIntegrationsOverview(integrations, runtime.providerConfiguration, createFormsKey(runtime.pool, actor));
}

export interface CallsPageData {
  initialResult: CallListResult | null;
  workspaceOptions: { id: string; name: string }[];
}

/** Calls: the page of Calls and the Workspace filter options together. */
export async function loadCallsPage(runtime: PageRuntime, actor: Actor, query: CallListQuery): Promise<CallsPageData> {
  const calls = createCallList(runtime.pool, actor);
  const [initialResult, workspaceOptions] = await Promise.all([calls.list(query), calls.workspaceOptions()]);
  return { initialResult, workspaceOptions };
}

/** Workspace Calls: one page of Calls fixed to the Workspace. */
export async function loadWorkspaceCallsPage(runtime: PageRuntime, actor: Actor, workspaceId: string, query: CallListQuery): Promise<CallListResult | null> {
  return createCallList(runtime.pool, actor).list({ ...query, workspaceId });
}

export interface ActivityPageData {
  initialResult: Awaited<ReturnType<ReturnType<typeof createActivity>["list"]>>;
  workspaceOptions: { id: string; name: string }[];
}

/** Activity: the first window of entries and the Workspace filter options together. */
export async function loadActivityPage(runtime: PageRuntime, actor: Actor, filters: CallFilters): Promise<ActivityPageData> {
  const [initialResult, workspaceOptions] = await Promise.all([
    createActivity(runtime.pool, actor).list({ filters }),
    createCallList(runtime.pool, actor).workspaceOptions(),
  ]);
  return { initialResult, workspaceOptions };
}
