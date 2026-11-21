/**
 * -------------------------------------------------------------------------
 * @file   home-dashboard.tsx
 * @brief  Renders the Home briefing for every Workspace the user can read.
 *
 * @description
 *  Shows the Home header with a sentence naming the scope and range, the
 *  date controls, and Generate Report on one row, then one stat strip with
 *  the four Call stats and, for Operators, this month's Monthly Revenue and
 *  Profit with the Monthly Cost named beneath it. Leads generated sits
 *  beside the five newest Calls as one-line rows, and the Workspaces list
 *  follows when the user reads more than one Workspace (with each
 *  Workspace's profit for Operators). A Workspace row opens that Workspace
 *  Overview. A Recent Calls row opens Call Detail with the global Calls
 *  list as its source, and View Calls opens Calls with the dashboard range
 *  as the Started filter. An Operator without Workspaces sees why Tracer
 *  needs an imported Twilio number and a Create Workspace action instead.
 *
 * @remarks
 *  The server page loads the analytics summary and Recent Calls as separate
 *  regions, so either can fail alone: a failed region shows an inline Retry
 *  that rerenders the page and every other region stays visible. A range
 *  change shows the analytics regions as Skeletons until the new range
 *  arrives. Generate Report opens the Generate Report dialog over every
 *  accessible Workspace with the account timezone.
 *
 * @see
 *  app/(app)/(everyone)/(home)/page.tsx
 *  components/tracer/page-parts.tsx
 *  components/tracer/analytics-panels.tsx
 *  data/analytics.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AnalyticsRangeControls, CallTrendsChart, CallTrendsSkeleton, formatRate, RegionRetry, useAnalyticsNavigation } from "@/components/tracer/analytics-panels";
import CallOutcomeBadge from "@/components/tracer/call-outcome-badge";
import { formatCallTime, formatClock, formatShortTime } from "@/components/tracer/call-format";
import GenerateReportButton, { type GenerateReportScope } from "@/components/tracer/generate-report-dialog";
import LeadClassificationBadge from "@/components/tracer/lead-classification-badge";
import { ListRow, PageHeader, Panel, StatStrip, type Stat } from "@/components/tracer/page-parts";
import type { AnalyticsKpi, AnalyticsSummary, WorkspacePerformanceRow } from "@/data/analytics";
import type { AnalyticsRange } from "@/data/analytics-range";
import { callDetailHref } from "@/data/call-source";
import type { CallListItem, CallListResult } from "@/data/calls";
import type { CostRevenueTotals } from "@/data/cost-revenue";
import { formatUsdCents } from "@/data/pricing";

export interface HomeMoney {
  month: string;
  totals: CostRevenueTotals;
  byWorkspace: Record<string, { costCents: number; revenueCents: number }>;
}

const recentCallCount = 5;
const callsSource = "/calls";
const noCallsYet = "Activity appears after the first inbound Call.";
const count = new Intl.NumberFormat("en-US");
const isoDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

interface HomeDashboardProps {
  operator: boolean;
  workspaceCount: number;
  range: AnalyticsRange;
  summary: AnalyticsSummary | null;
  recentCalls: CallListResult | null;
  callsHref: string;
  reportScope: GenerateReportScope;
  money?: HomeMoney | null;
}

function rangeLabel(range: AnalyticsRange): string {
  if (range.kind === "days") return `the last ${range.days} days`;
  if (range.kind === "all") return "all time";
  return `${isoDate.format(new Date(`${range.from}T00:00:00Z`))} to ${isoDate.format(new Date(`${range.to}T00:00:00Z`))}`;
}

function change(kpi: AnalyticsKpi): Stat["change"] {
  return kpi.comparison && kpi.comparison.change !== null ? { value: kpi.comparison.change, unit: kpi.comparison.unit } : null;
}

function homeStats(summary: AnalyticsSummary, money: HomeMoney | null | undefined, operator: boolean): Stat[] {
  const { kpis, goodLeadForms } = summary;
  const stats: Stat[] = [
    { label: "Total Calls", value: count.format(kpis.totalCalls.value ?? 0), change: change(kpis.totalCalls), hint: "Calls started in the period" },
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
  if (operator && money) {
    stats.push(
      { label: "Monthly Revenue", value: formatUsdCents(money.totals.revenueCents), hint: `Open Deals for ${money.month}` },
      { label: "Profit", value: formatUsdCents(money.totals.profitCents), hint: "Monthly Revenue minus Monthly Cost", tone: money.totals.profitCents < 0 ? "destructive" : "success" },
    );
  }
  return stats;
}

function MoneyLine({ money, pending, onRetry }: { money: HomeMoney | null; pending: boolean; onRetry: () => void }) {
  if (!money) return <RegionRetry message="Cost and revenue are unavailable." pending={pending} onRetry={onRetry} />;
  return (
    <p className="text-xs text-muted-foreground">
      Monthly Cost {formatUsdCents(money.totals.costCents)}, projected {formatUsdCents(money.totals.yearlyCostCents)} per year. Rates in the{" "}
      <Link className="underline transition-colors hover:text-foreground" href="/pricing" prefetch>
        Pricing guide
      </Link>
      .
    </p>
  );
}

function RecentCallRow({ call, timeZone }: { call: CallListItem; timeZone: string }) {
  const lead = call.effectiveLeadClassification;
  return (
    <ListRow
      href={callDetailHref({ id: call.id, workspaceId: call.workspace.id }, callsSource)}
      title={call.callerNumber ? <span className="font-mono">{call.callerNumber}</span> : "Unknown caller"}
      detail={
        <>
          {call.workspace.name} · <span title={formatCallTime(call.startedAt, timeZone)}>{formatShortTime(call.startedAt, timeZone)}</span>
          {call.connectedDurationSeconds ? ` · ${formatClock(call.connectedDurationSeconds)}` : ""}
        </>
      }
    >
      {lead ? <LeadClassificationBadge classification={lead.classification} automated={lead.source === "assessment"} /> : <CallOutcomeBadge outcome={call.outcome} />}
    </ListRow>
  );
}

function WorkspaceRow({ row, money }: { row: WorkspacePerformanceRow; money: HomeMoney["byWorkspace"] | undefined }) {
  const cents = money ? (money[row.workspace.id] ?? { costCents: 0, revenueCents: 0 }) : null;
  const profit = cents ? cents.revenueCents - cents.costCents : null;
  return (
    <ListRow
      href={`/workspaces/${row.workspace.id}`}
      title={row.workspace.name}
      detail={row.trackingNumber ? <span className="font-mono">{row.trackingNumber}</span> : "No Tracking Number"}
    >
      <span className="flex shrink-0 items-baseline gap-4 text-sm tabular-nums">
        <span>
          {row.totalCalls} <span className="text-xs text-muted-foreground">{row.totalCalls === 1 ? "Call" : "Calls"}</span>
        </span>
        <span className="hidden sm:inline">
          {row.goodLeads} <span className="text-xs text-muted-foreground">{row.goodLeads === 1 ? "Good Lead" : "Good Leads"}</span>
        </span>
        {row.answerRate === null ? null : (
          <span className="hidden sm:inline">
            {formatRate(row.answerRate)} <span className="text-xs text-muted-foreground">answered</span>
          </span>
        )}
        {profit === null ? null : (
          <span className={profit < 0 ? "text-destructive" : undefined}>
            {formatUsdCents(profit)} <span className="text-xs text-muted-foreground">profit</span>
          </span>
        )}
      </span>
    </ListRow>
  );
}

export default function HomeDashboard({ operator, workspaceCount, range, summary, recentCalls, callsHref, reportScope, money }: HomeDashboardProps) {
  const { pending, changeRange, retry } = useAnalyticsNavigation();
  const scope = operator ? "All Workspaces" : `${workspaceCount} ${workspaceCount === 1 ? "Workspace" : "Workspaces"}`;
  const noWorkspaces = operator && workspaceCount === 0;
  const hasCalls = recentCalls?.hasCalls ?? true;
  const showChart = pending || summary !== null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <PageHeader title="Home" description={noWorkspaces ? "Calls across every Workspace in this Organization." : `${scope}, ${rangeLabel(range)}.`}>
        {noWorkspaces ? null : <AnalyticsRangeControls range={range} onRangeChange={changeRange} disabled={pending} />}
        <GenerateReportButton scope={reportScope} />
      </PageHeader>
      {noWorkspaces ? (
        <Panel className="items-center gap-3 py-10 text-center text-sm text-muted-foreground">
          <p>Tracer needs an imported Twilio number before it can track Calls. Create a Workspace to assign one.</p>
          <Link href="/workspaces" prefetch className={buttonVariants()}>Create Workspace</Link>
        </Panel>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {pending ? (
              <Skeleton className="h-[78px] w-full rounded-lg" aria-busy="true" />
            ) : summary ? (
              <StatStrip stats={homeStats(summary, money, operator)} />
            ) : (
              <Panel>
                <RegionRetry message="Analytics are unavailable." pending={pending} onRetry={retry} />
              </Panel>
            )}
            {operator && money !== undefined && !pending ? <MoneyLine money={money} pending={pending} onRetry={retry} /> : null}
          </div>
          <div className="grid items-start gap-5 lg:grid-cols-3">
            {showChart ? (
              <Panel title="Leads generated" className="lg:col-span-2">
                <div className="p-4">
                  {pending || !summary ? <CallTrendsSkeleton /> : hasCalls ? <CallTrendsChart trend={summary.trend} /> : <p className="py-10 text-center text-sm text-muted-foreground">{noCallsYet}</p>}
                </div>
              </Panel>
            ) : null}
            <Panel
              title="Recent Calls"
              className={showChart ? undefined : "lg:col-span-3"}
              action={
                <Link href={callsHref} prefetch className="text-xs text-muted-foreground transition-colors hover:text-foreground">
                  View Calls
                </Link>
              }
            >
              {recentCalls === null ? (
                <RegionRetry message="Recent Calls are unavailable." pending={pending} onRetry={retry} />
              ) : recentCalls.calls.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">{hasCalls ? "No Calls yet." : noCallsYet}</p>
              ) : (
                <div className="flex flex-col divide-y divide-border">
                  {recentCalls.calls.slice(0, recentCallCount).map((call) => (
                    <RecentCallRow key={call.id} call={call} timeZone={recentCalls.timeZone} />
                  ))}
                </div>
              )}
            </Panel>
          </div>
          {!pending && summary?.workspacePerformance ? (
            <Panel
              title="Workspaces"
              action={
                <Link href="/workspaces" prefetch className="text-xs text-muted-foreground transition-colors hover:text-foreground">
                  View all
                </Link>
              }
            >
              <div className="flex flex-col divide-y divide-border">
                {summary.workspacePerformance.map((row) => (
                  <WorkspaceRow key={row.workspace.id} row={row} money={operator && money ? money.byWorkspace : undefined} />
                ))}
              </div>
            </Panel>
          ) : null}
        </>
      )}
    </div>
  );
}
