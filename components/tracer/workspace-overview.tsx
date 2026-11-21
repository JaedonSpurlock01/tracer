/**
 * -------------------------------------------------------------------------
 * @file   workspace-overview.tsx
 * @brief  Renders the Workspace Overview as the Briefing layout with a right rail.
 *
 * @description
 *  The page header names the Workspace, its state, and the range in its
 *  reporting timezone beside the date controls and the actions. One stat
 *  strip holds Total Calls, Answer Rate, Good Leads, Average Duration,
 *  Visit-to-Call when a Site is linked, and Profit for Operators, with the
 *  Monthly Cost, its yearly projection, and the Deal on one line beneath
 *  it. Leads generated and the five Recent Calls fill the main column; the
 *  rail stacks Routing health, the Site with its Visits and Search
 *  Visibility (or one Link Site line when no Site is linked), the
 *  published Call Flow, and, for Operators, the Business with its city map.
 *  Operators get Edit Flow and Workspace Settings; Client Viewers get
 *  Generate Report, scoped to this Workspace and its reporting timezone,
 *  and Workspace Reports.
 *
 * @remarks
 *  Lifecycle state and health stay separate: routing health reports the
 *  Twilio webhook health and last successful inbound Call from recorded
 *  provider events, and a webhook Warning stays inside routing health with
 *  an Operator-only action that opens the Number settings. Analytics,
 *  routing health, Recent Calls, and the Site each fail alone with an
 *  inline Retry that rerenders the page. Setup Required replaces the
 *  analytics with Resume Setup and its checklist. Archived keeps historical
 *  analytics and Calls readable under an archived label and removes
 *  live-routing actions. The Product Owner chose the rail layout from a
 *  three-way prototype on 2026-11-20 (M28).
 *
 * @see
 *  components/tracer/page-parts.tsx
 *  data/analytics.ts
 *  data/workspace-routing.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { CircleCheckIcon, CircleIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/reui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AnalyticsRangeControls, CallTrendsChart, CallTrendsSkeleton, formatRate, RegionRetry, useAnalyticsNavigation } from "@/components/tracer/analytics-panels";
import CallOutcomeBadge from "@/components/tracer/call-outcome-badge";
import { formatCallDate, formatCallTime, formatClock, formatShortTime } from "@/components/tracer/call-format";
import LocationMap from "@/components/tracer/location-map";
import FlowSpine from "@/components/tracer/flow/flow-spine";
import GenerateReportButton from "@/components/tracer/generate-report-dialog";
import { describeDeal } from "@/components/tracer/deal-editor";
import { FactList, ListRow, PageHeader, Panel, StatStrip, type Stat } from "@/components/tracer/page-parts";
import { previewImageSrc, SitePickerDialog, SitePreviewThumbnail, siteHealthBadges, type SiteResponse } from "@/components/tracer/site-picker";
import type { AnalyticsKpi, AnalyticsSummary, WebhookHealth, WorkspaceRoutingHealth } from "@/data/analytics";
import type { AnalyticsRange } from "@/data/analytics-range";
import type { BusinessRecord } from "@/data/business";
import type { RecentCall } from "@/data/call-details";
import type { CallFlowGraph } from "@/data/call-flow";
import type { DealRecord } from "@/data/deals";
import { formatUsdCents, yearlyCents } from "@/data/pricing";
import type { ClientViewerSiteSummary, SiteSummary } from "@/data/sites";
import type { WorkspaceRecord } from "@/data/workspaces";
import { describeSetupChecklist } from "@/data/workspace-policy";

interface WorkspaceOverviewProps {
  workspace: WorkspaceRecord;
  flow?: { published: { version: number; graph: CallFlowGraph } | null };
  readOnly?: boolean;
  recentCalls?: RecentCall[] | null;
  routingHealth?: WorkspaceRoutingHealth | null;
  analytics?: { range: AnalyticsRange; summary: AnalyticsSummary | null; callsHref: string };
  site?: { record: SiteResponse | null; summary: SiteSummary | ClientViewerSiteSummary | null; searchScore?: number | null } | null;
  money?: WorkspaceMoney | null;
  business?: BusinessRecord | null;
}

export interface WorkspaceMoney {
  month: string;
  costCents: number;
  profitCents: number;
  deal: DealRecord | null;
}

const count = new Intl.NumberFormat("en-US");
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const isoDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });
const panelLink = "text-xs text-muted-foreground transition-colors hover:text-foreground";

const healthBadges = {
  Healthy: ["Healthy", "success-light"],
  Warning: ["Needs attention", "warning-light"],
  "Not applicable": ["Not applicable", "outline"],
} as const satisfies Record<WebhookHealth["status"], readonly [string, string]>;

const stateBadges = { Active: "success-light", "Setup Required": "primary-light", Archived: "destructive-light" } as const satisfies Record<WorkspaceRecord["state"], string>;

function rangeLabel(range: AnalyticsRange): string {
  if (range.kind === "days") return `the last ${range.days} days`;
  if (range.kind === "all") return "all time";
  return `${isoDate.format(new Date(`${range.from}T00:00:00Z`))} to ${isoDate.format(new Date(`${range.to}T00:00:00Z`))}`;
}

function ShortTime({ iso, timeZone }: { iso: string; timeZone: string }) {
  return <span title={formatCallTime(iso, timeZone)}>{formatShortTime(iso, timeZone)}</span>;
}

function change(kpi: AnalyticsKpi): Stat["change"] {
  return kpi.comparison && kpi.comparison.change !== null ? { value: kpi.comparison.change, unit: kpi.comparison.unit } : null;
}

function overviewStats(summary: AnalyticsSummary, visits: number | null, siteLinked: boolean, money: WorkspaceMoney | null | undefined): Stat[] {
  const { kpis, goodLeadForms } = summary;
  const calls = kpis.totalCalls.value ?? 0;
  const stats: Stat[] = [
    { label: "Total Calls", value: count.format(calls), change: change(kpis.totalCalls), hint: "Calls started in the period" },
    { label: "Answer Rate", value: kpis.answerRate.value === null ? "None" : formatRate(kpis.answerRate.value), change: change(kpis.answerRate), hint: "Answered Calls of forwarding attempts" },
    {
      label: "Good Leads",
      value: count.format(kpis.goodLeads.value ?? 0),
      change: change(kpis.goodLeads),
      hint: goodLeadForms > 0 ? `Good Lead Calls and Form Submissions, ${count.format(goodLeadForms)} from Forms` : "Good Lead Calls and Form Submissions",
    },
    {
      label: "Average Duration",
      value: kpis.averageConnectedSeconds.value === null ? "None" : formatClock(kpis.averageConnectedSeconds.value),
      change: change(kpis.averageConnectedSeconds),
      hint: "Connected talk time of Answered Calls",
    },
  ];
  if (siteLinked) {
    stats.push({ label: "Visit-to-Call", value: visits ? percent.format(calls / visits) : "None", hint: visits === null ? "Calls divided by Visits" : `${count.format(calls)} Calls from ${count.format(visits)} Visits` });
  }
  if (money) {
    stats.push({ label: "Profit", value: formatUsdCents(money.profitCents), hint: "Monthly Revenue minus Monthly Cost", tone: money.profitCents < 0 ? "destructive" : "success" });
  }
  return stats;
}

function Stats({ summary, pending, onRetry, visits, siteLinked, money }: { summary: AnalyticsSummary | null; pending: boolean; onRetry: () => void; visits: number | null; siteLinked: boolean; money: WorkspaceMoney | null | undefined }) {
  if (pending) return <Skeleton className="h-[78px] w-full rounded-lg" aria-busy="true" />;
  if (!summary) {
    return (
      <Panel>
        <RegionRetry message="Analytics are unavailable." pending={pending} onRetry={onRetry} />
      </Panel>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <StatStrip stats={overviewStats(summary, visits, siteLinked, money)} />
      {money ? (
        <p className="text-xs text-muted-foreground">
          Monthly Cost {formatUsdCents(money.costCents)}, projected {formatUsdCents(yearlyCents(money.costCents))} per year. Deal: {describeDeal(money.deal)}.
        </p>
      ) : null}
    </div>
  );
}

function RecentCalls({ workspace, calls, viewCallsHref, onRetry, pending }: { workspace: WorkspaceRecord; calls: RecentCall[] | null; viewCallsHref: string; onRetry: () => void; pending: boolean }) {
  return (
    <Panel
      title="Recent Calls"
      action={
        <Link href={viewCallsHref} prefetch className={panelLink}>
          View Calls
        </Link>
      }
    >
      {calls === null ? (
        <RegionRetry message="Recent Calls are unavailable." pending={pending} onRetry={onRetry} />
      ) : calls.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">No Calls yet. Calls appear after the first inbound Call reaches the Tracking Number.</p>
      ) : (
        <ul aria-label="Recent Calls" className="flex flex-col divide-y divide-border">
          {calls.map((call) => (
            <li key={call.id}>
              <ListRow
                href={`/workspaces/${workspace.id}/calls/${call.id}`}
                title={call.callerNumber ? <span className="font-mono">{call.callerNumber}</span> : "Unknown caller"}
                detail={
                  <>
                    <ShortTime iso={call.startedAt} timeZone={workspace.reportingTimezone} />
                    {call.connectedDurationSeconds === null ? "" : ` · ${formatClock(call.connectedDurationSeconds)}`}
                  </>
                }
              >
                <CallOutcomeBadge outcome={call.outcome} />
              </ListRow>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RoutingHealth({ workspace, health, operator, pending, onRetry }: { workspace: WorkspaceRecord; health: WorkspaceRoutingHealth | null | undefined; operator: boolean; pending: boolean; onRetry: () => void }) {
  const zone = workspace.reportingTimezone;
  const webhook = health?.webhook;
  const lastInbound = health?.lastSuccessfulInboundCallAt;
  const toggles = [`Recording ${workspace.recordingEnabled ? "on" : "off"}`, `Spam gate ${workspace.spamGateEnabled ? "on" : "off"}`, `Whisper ${workspace.whisperEnabled ? "on" : "off"}`].join(" · ");
  return (
    <Panel title="Routing health" action={webhook ? <Badge variant={healthBadges[webhook.status][1]}>{healthBadges[webhook.status][0]}</Badge> : null}>
      <div className="flex flex-col gap-3 p-4">
        {webhook?.status === "Warning" ? (
          <div className="flex flex-col items-start gap-2 rounded-md border border-warning/25 bg-warning/15 px-3 py-2 text-sm">
            <p>No accepted Twilio voice webhook for the current Tracking Number.</p>
            {operator ? (
              <Link href={`/workspaces/${workspace.id}/settings/number`} prefetch className={buttonVariants({ variant: "outline", size: "sm" })}>
                Review Number Settings
              </Link>
            ) : null}
          </div>
        ) : null}
        <FactList
          className="grid-cols-2"
          facts={[
            { label: "Tracking Number", value: workspace.trackingNumber, mono: true },
            { label: "Destination Number", value: workspace.destinationNumber, mono: true },
            { label: "Last inbound Call", value: health === null ? "Unavailable" : lastInbound ? <ShortTime iso={lastInbound} timeZone={zone} /> : null, empty: "None yet" },
            { label: "Assigned", value: workspace.numberAssignmentStartedAt ? <ShortTime iso={workspace.numberAssignmentStartedAt} timeZone={zone} /> : null },
          ]}
        />
        <p className="text-xs text-muted-foreground">{toggles}</p>
        {health === null ? <RegionRetry message="Webhook health is unavailable." pending={pending} onRetry={onRetry} /> : null}
      </div>
    </Panel>
  );
}

function SiteSummaryPanel({ workspace, site, operator, pending, onRetry, onLink }: { workspace: WorkspaceRecord; site: NonNullable<WorkspaceOverviewProps["site"]> | null; operator: boolean; pending: boolean; onRetry: () => void; onLink: () => void }) {
  const zone = workspace.reportingTimezone;
  if (site === null) {
    return (
      <Panel title="Site">
        <RegionRetry message="The Site summary is unavailable." pending={pending} onRetry={onRetry} />
      </Panel>
    );
  }
  const record = site.record;
  if (!record) {
    return (
      <Panel role="region" aria-label="Site" className="flex-row items-center justify-between gap-3 px-4 py-2.5">
        <p className="text-sm text-muted-foreground">No Site is linked to this Workspace.</p>
        {operator ? (
          <Button type="button" size="sm" variant="outline" onClick={onLink}>
            Link Site
          </Button>
        ) : null}
      </Panel>
    );
  }
  const check = record.latestCheck;
  return (
    <Panel
      title="Site"
      action={
        <Link href={`/workspaces/${workspace.id}/site`} prefetch className={panelLink}>
          View Site
        </Link>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <div className="w-24 shrink-0">
            <SitePreviewThumbnail src={record.latestPreview ? previewImageSrc(workspace.id, record.latestPreview.capturedAt) : null} alt={`Preview of ${record.primaryHostname}`} />
          </div>
          <div className="flex min-w-0 flex-col items-start gap-1">
            <span className="max-w-full truncate font-mono text-sm">{record.primaryHostname}</span>
            <Badge variant={siteHealthBadges[record.health][1]}>{siteHealthBadges[record.health][0]}</Badge>
            {record.healthReason ? <span className="text-xs text-muted-foreground">{record.healthReason}</span> : null}
          </div>
        </div>
        <FactList
          className="grid-cols-2"
          facts={[
            { label: "Visits", value: site.summary ? count.format(site.summary.visits) : null },
            { label: "Search Visibility", value: site.searchScore === null || site.searchScore === undefined ? null : `${site.searchScore} of 100`, empty: "No score yet" },
            {
              label: "Last check",
              value: check ? (
                <>
                  {check.ok ? "" : "Failed: "}
                  {check.statusCode ?? "No response"}
                  {check.responseMs === null ? "" : `, ${check.responseMs} ms`}, <ShortTime iso={check.checkedAt} timeZone={zone} />
                </>
              ) : null,
              empty: "No check yet",
            },
            { label: "Last deploy", value: record.lastDeployedAt ? <ShortTime iso={record.lastDeployedAt} timeZone={zone} /> : null },
          ]}
        />
      </div>
    </Panel>
  );
}

function CallFlowPanel({ workspace, published, operator }: { workspace: WorkspaceRecord; published: { version: number; graph: CallFlowGraph } | null; operator: boolean }) {
  return (
    <Panel
      title="Call Flow"
      action={
        published ? (
          <span className="flex items-center gap-3">
            <Badge variant="outline">v{published.version}</Badge>
            {operator && workspace.state === "Active" ? (
              <Link href={`/workspaces/${workspace.id}/flow`} prefetch className={panelLink}>
                Open Flow
              </Link>
            ) : null}
          </span>
        ) : null
      }
    >
      <div className="p-4">{published ? <FlowSpine graph={published.graph} /> : <p className="text-sm text-muted-foreground">No published Call Flow.</p>}</div>
    </Panel>
  );
}

function BusinessPanel({ workspace, business }: { workspace: WorkspaceRecord; business: BusinessRecord | null }) {
  const contact = [business?.firstName, business?.lastName].filter(Boolean).join(" ");
  return (
    <Panel
      title="Business"
      action={
        <Link href={`/workspaces/${workspace.id}/settings/site`} prefetch className={panelLink}>
          Edit Business
        </Link>
      }
    >
      {business ? (
        <div className="flex flex-col gap-3 p-4">
          <FactList
            className="grid-cols-2"
            facts={[
              { label: "Business name", value: business.name },
              { label: "Contact", value: contact || null },
              { label: "Niche", value: business.niche },
              { label: "City", value: business.city },
            ]}
          />
          <LocationMap point={business.cityPoint} zoom={11} label={business.city ? `Map of ${business.city}` : "Map"} className="h-36" placeholder="Pick a city in Site settings to place this Business on the map." />
        </div>
      ) : (
        <p className="px-4 py-3 text-sm text-muted-foreground">No Business details yet.</p>
      )}
    </Panel>
  );
}

function SetupChecklist({ workspace }: { workspace: WorkspaceRecord }) {
  return (
    <Panel title="Setup Required">
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted-foreground">Finish these requirements before the Workspace can become Active.</p>
        {workspace.voiceRestoreNeeded ? (
          <p role="alert" className="text-sm text-warning">
            Tracer could not restore {workspace.voiceRestoreNeeded} in Twilio. Clear its voice URL in the Twilio console or attach it to a Workspace again.
          </p>
        ) : null}
        <ul className="grid gap-2">
          {describeSetupChecklist(workspace).map((item) => (
            <li key={item.label} className="flex items-center gap-2 text-sm">
              {item.complete ? <CircleCheckIcon aria-hidden="true" className="size-4 text-success" /> : <CircleIcon aria-hidden="true" className="size-4 text-muted-foreground" />}
              <span data-requirement className={item.complete ? "text-muted-foreground" : undefined}>
                {item.label}
              </span>
              <span className="sr-only">{item.complete ? "Complete" : "Incomplete"}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

export default function WorkspaceOverview({ workspace, flow, readOnly = false, recentCalls, routingHealth, analytics, site, money, business }: WorkspaceOverviewProps) {
  const { pending, changeRange, retry } = useAnalyticsNavigation();
  const [linkSiteOpen, setLinkSiteOpen] = useState(false);
  const published = flow?.published ?? null;
  const operator = !readOnly;
  const setupRequired = workspace.state === "Setup Required";
  const archived = workspace.state === "Archived";
  const showAnalytics = Boolean(analytics) && !setupRequired;
  const showChart = showAnalytics && (pending || Boolean(analytics?.summary));

  const rail = (
    <>
      <RoutingHealth workspace={workspace} health={routingHealth} operator={operator && !archived} pending={pending} onRetry={retry} />
      {site !== undefined ? <SiteSummaryPanel workspace={workspace} site={site} operator={operator} pending={pending} onRetry={retry} onLink={() => setLinkSiteOpen(true)} /> : null}
      <CallFlowPanel workspace={workspace} published={published} operator={operator} />
      {operator && business !== undefined ? <BusinessPanel workspace={workspace} business={business} /> : null}
    </>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <PageHeader
          title={workspace.name}
          description={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge variant={stateBadges[workspace.state]}>{workspace.state}</Badge>
              <span>{showAnalytics && analytics ? `${rangeLabel(analytics.range)} in ${workspace.reportingTimezone}` : workspace.reportingTimezone}</span>
            </span>
          }
        >
          {showAnalytics && analytics ? <AnalyticsRangeControls range={analytics.range} onRangeChange={changeRange} disabled={pending} /> : null}
          {operator ? (
            <>
              <Link href={`/workspaces/${workspace.id}/settings/general`} prefetch className={buttonVariants({ variant: "outline" })}>
                Workspace Settings
              </Link>
              {setupRequired ? <Link href={`/workspaces?resume=${workspace.id}`} className={buttonVariants()}>Resume Setup</Link> : null}
              {archived ? <Link href={`/workspaces/${workspace.id}/settings/danger`} className={buttonVariants()}>Restore</Link> : null}
              {workspace.state === "Active" ? <Link href={`/workspaces/${workspace.id}/flow`} className={buttonVariants()}>Edit Flow</Link> : null}
            </>
          ) : (
            <>
              <Link href={`/workspaces/${workspace.id}/reports`} prefetch className={buttonVariants({ variant: "outline" })}>
                Reports
              </Link>
              <GenerateReportButton scope={{ kind: "workspace", workspace: { id: workspace.id, name: workspace.name, reportingTimezone: workspace.reportingTimezone } }} />
            </>
          )}
        </PageHeader>
        {archived ? (
          <p className="text-sm text-muted-foreground">
            Archived{workspace.archivedAt ? ` ${formatCallDate(workspace.archivedAt, workspace.reportingTimezone)}` : ""}. Historical analytics and Calls stay readable; routing is read-only.
          </p>
        ) : null}
      </div>
      {setupRequired && operator ? <SetupChecklist workspace={workspace} /> : null}
      {showAnalytics && analytics ? (
        <Stats summary={analytics.summary} pending={pending} onRetry={retry} visits={site?.summary?.visits ?? null} siteLinked={Boolean(site?.record)} money={operator ? money : undefined} />
      ) : null}
      <div className="grid items-start gap-5 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
          {showChart && analytics ? (
            <Panel title="Leads generated">
              <div className="p-4">{pending || !analytics.summary ? <CallTrendsSkeleton /> : <CallTrendsChart trend={analytics.summary.trend} />}</div>
            </Panel>
          ) : null}
          {recentCalls !== undefined ? (
            <RecentCalls workspace={workspace} calls={recentCalls} viewCallsHref={analytics?.callsHref ?? `/workspaces/${workspace.id}/calls`} onRetry={retry} pending={pending} />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-5">{rail}</div>
      </div>
      {operator ? <SitePickerDialog open={linkSiteOpen} onOpenChange={setLinkSiteOpen} workspaceId={workspace.id} mode="link" timeZone={workspace.reportingTimezone} onLinked={retry} /> : null}
    </div>
  );
}
