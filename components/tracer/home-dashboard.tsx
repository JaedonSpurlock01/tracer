/**
 * -------------------------------------------------------------------------
 * @file   home-dashboard.tsx
 * @brief  Renders the Home dashboard for every Workspace the user can read.
 *
 * @description
 *  Shows the Home header with its scope, date controls, and Generate
 *  Report, then the KPI row, the Operator-only Money row (this month's
 *  cost with its yearly projection, the revenue of open Deals, and the
 *  profit), the Call trends chart, Workspace performance when the user
 *  reads more than one Workspace (with Cost and Revenue columns for
 *  Operators), and the five newest Calls in scope. A Workspace performance row opens that Workspace Overview. A
 *  Recent Calls row opens Call Detail with the global Calls list as its
 *  source, and View Calls opens Calls with the dashboard range as the
 *  Started filter. An Operator without Workspaces sees why Tracer needs an
 *  imported Twilio number and a Create Workspace action instead.
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
 *  app/(app)/page.tsx
 *  components/tracer/analytics-panels.tsx
 *  data/analytics.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useTable, type ColumnDef } from "@tanstack/react-table";

import { Badge } from "@/components/reui/badge";
import { DataGrid, dataGridFeatures, type DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AnalyticsKpiRow,
  AnalyticsKpiSkeleton,
  AnalyticsRangeControls,
  CallTrendsChart,
  CallTrendsSkeleton,
  formatRate,
  RegionRetry,
  useAnalyticsNavigation,
} from "@/components/tracer/analytics-panels";
import CallOutcomeBadge from "@/components/tracer/call-outcome-badge";
import GenerateReportButton, { type GenerateReportScope } from "@/components/tracer/generate-report-dialog";
import { formatCallTime, formatClock } from "@/components/tracer/call-format";
import LeadClassificationBadge from "@/components/tracer/lead-classification-badge";
import type { AnalyticsSummary, WorkspacePerformanceRow } from "@/data/analytics";
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

function WorkspacePerformance({ rows, money }: { rows: WorkspacePerformanceRow[]; money: HomeMoney["byWorkspace"] | undefined }) {
  const router = useRouter();
  const columns = useMemo<ColumnDef<DataGridFeatures, WorkspacePerformanceRow>[]>(
    () => [
      {
        id: "workspace",
        header: "Workspace",
        cell: ({ row }) => (
          <Link href={`/workspaces/${row.original.workspace.id}`} prefetch className="font-medium transition-colors hover:text-muted-foreground">
            {row.original.workspace.name}
          </Link>
        ),
        size: 200,
      },
      { id: "trackingNumber", header: "Tracking Number", cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.trackingNumber ?? "-"}</span>, size: 160 },
      { id: "totalCalls", header: "Total Calls", cell: ({ row }) => <span className="tabular-nums">{row.original.totalCalls}</span>, size: 120 },
      { id: "answerRate", header: "Answer Rate", cell: ({ row }) => <span className="tabular-nums">{formatRate(row.original.answerRate)}</span>, size: 120 },
      { id: "goodLeads", header: "Good Leads", cell: ({ row }) => <span className="tabular-nums">{row.original.goodLeads}</span>, size: 120 },
      { id: "leadRate", header: "Lead Rate", cell: ({ row }) => <span className="tabular-nums">{formatRate(row.original.leadRate)}</span>, size: 120 },
      ...(money
        ? [
            { id: "cost", header: "Cost", cell: ({ row }) => <span className="font-mono tabular-nums">{formatUsdCents(money[row.original.workspace.id]?.costCents ?? 0)}</span>, size: 120 },
            { id: "revenue", header: "Revenue", cell: ({ row }) => <span className="font-mono tabular-nums">{formatUsdCents(money[row.original.workspace.id]?.revenueCents ?? 0)}</span>, size: 120 },
          ] satisfies ColumnDef<DataGridFeatures, WorkspacePerformanceRow>[]
        : []),
    ],
    [money],
  );
  const table = useTable({ features: dataGridFeatures, data: rows, columns, getRowId: (row) => row.workspace.id });
  return (
    <DataGrid table={table} recordCount={rows.length} emptyMessage="No Workspaces to compare." onRowClick={(row) => router.push(`/workspaces/${row.workspace.id}`)}>
      <DataGridScrollArea orientation="horizontal">
        <DataGridTable />
      </DataGridScrollArea>
    </DataGrid>
  );
}

function RecentCallsGrid({ calls, timeZone, hasCalls }: { calls: CallListItem[]; timeZone: string; hasCalls: boolean }) {
  const router = useRouter();
  const columns = useMemo<ColumnDef<DataGridFeatures, CallListItem>[]>(
    () => [
      { id: "outcome", header: "Call Outcome", cell: ({ row }) => <CallOutcomeBadge outcome={row.original.outcome} />, size: 140, meta: { skeleton: <Skeleton className="h-5 w-20" /> } },
      {
        id: "callerNumber",
        header: "Caller",
        cell: ({ row }) => (
          <Link href={callDetailHref({ id: row.original.id, workspaceId: row.original.workspace.id }, callsSource)} prefetch className="font-mono font-medium tabular-nums transition-colors hover:text-muted-foreground">
            {row.original.callerNumber ?? "Unknown caller"}
          </Link>
        ),
        size: 150,
      },
      { id: "workspace", header: "Workspace", cell: ({ row }) => row.original.workspace.name, size: 160 },
      { id: "startedAt", header: "Started", cell: ({ row }) => <span className="font-mono tabular-nums">{formatCallTime(row.original.startedAt, timeZone)}</span>, size: 200 },
      {
        id: "connectedDuration",
        header: "Connected Duration",
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.connectedDurationSeconds === null ? "-" : formatClock(row.original.connectedDurationSeconds)}</span>,
        size: 170,
      },
      {
        id: "leadClassification",
        header: "Effective Lead Classification",
        cell: ({ row }) => {
          const effective = row.original.effectiveLeadClassification;
          return effective ? <LeadClassificationBadge classification={effective.classification} automated={effective.source === "assessment"} /> : "-";
        },
        size: 240,
      },
    ],
    [timeZone],
  );
  const table = useTable({ features: dataGridFeatures, data: calls, columns, getRowId: (row) => row.id });
  return (
    <DataGrid
      table={table}
      recordCount={calls.length}
      emptyMessage={hasCalls ? "No Calls yet." : noCallsYet}
      onRowClick={(call) => router.push(callDetailHref({ id: call.id, workspaceId: call.workspace.id }, callsSource))}
    >
      <DataGridScrollArea orientation="horizontal">
        <DataGridTable />
      </DataGridScrollArea>
    </DataGrid>
  );
}

function MoneyTile({ id, label, value, definition, footer, valueClass = "" }: { id: string; label: string; value: string; definition: string; footer?: React.ReactNode; valueClass?: string }) {
  return (
    <FramePanel role="group" aria-labelledby={`${id}-label`} className="flex flex-col gap-1">
      <p id={`${id}-label`} className="text-sm text-muted-foreground">{label}</p>
      <p className={`font-mono text-2xl font-semibold tracking-tight tabular-nums ${valueClass}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{definition}</p>
      {footer ? <p className="text-xs text-muted-foreground">{footer}</p> : null}
    </FramePanel>
  );
}

function MoneyRow({ money, pending, onRetry }: { money: HomeMoney | null; pending: boolean; onRetry: () => void }) {
  if (!money) {
    return (
      <Frame>
        <FramePanel>
          <RegionRetry message="Cost and revenue are unavailable." pending={pending} onRetry={onRetry} />
        </FramePanel>
      </Frame>
    );
  }
  const { totals } = money;
  return (
    <Frame className="grid gap-2 sm:grid-cols-3">
      <MoneyTile
        id="money-cost"
        label="Monthly Cost"
        value={formatUsdCents(totals.costCents)}
        definition={`Projected ${formatUsdCents(totals.yearlyCostCents)} per year`}
        footer={
          <>
            Rates in the{" "}
            <Link className="underline" href="/pricing" prefetch>
              Pricing guide
            </Link>
            .
          </>
        }
      />
      <MoneyTile id="money-revenue" label="Monthly Revenue" value={formatUsdCents(totals.revenueCents)} definition={`Open Deals for ${money.month}`} />
      <MoneyTile id="money-profit" label="Profit" value={formatUsdCents(totals.profitCents)} definition="Revenue minus cost this month" valueClass={totals.profitCents < 0 ? "text-destructive" : "text-success"} />
    </Frame>
  );
}

function RegionTitle({ id, title, description, action }: { id: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <FrameHeader className="flex-row items-center justify-between gap-2">
      <div className="flex flex-col gap-0.5">
        <FrameTitle id={id}>
          <h2>{title}</h2>
        </FrameTitle>
        {description ? <FrameDescription>{description}</FrameDescription> : null}
      </div>
      {action}
    </FrameHeader>
  );
}

export default function HomeDashboard({ operator, workspaceCount, range, summary, recentCalls, callsHref, reportScope, money }: HomeDashboardProps) {
  const { pending, changeRange, retry } = useAnalyticsNavigation();
  const scope = operator ? "All Workspaces" : `${workspaceCount} ${workspaceCount === 1 ? "Workspace" : "Workspaces"}`;
  const noWorkspaces = operator && workspaceCount === 0;
  const hasCalls = recentCalls?.hasCalls ?? true;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
          <p className="text-sm text-muted-foreground">{operator ? "Calls across every Workspace in this Organization." : "Calls across the Workspaces you can access."}</p>
          <div>
            <Badge variant="outline">{scope}</Badge>
          </div>
        </div>
        <GenerateReportButton scope={reportScope} />
      </div>
      {noWorkspaces ? (
        <Frame>
          <FramePanel className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
            <p>Tracer needs an imported Twilio number before it can track Calls. Create a Workspace to assign one.</p>
            <Button render={<Link href="/workspaces" prefetch />}>Create Workspace</Button>
          </FramePanel>
        </Frame>
      ) : (
        <>
          <AnalyticsRangeControls range={range} onRangeChange={changeRange} disabled={pending} />
          {pending ? (
            <AnalyticsKpiSkeleton />
          ) : summary ? (
            <AnalyticsKpiRow kpis={summary.kpis} goodLeadForms={summary.goodLeadForms} />
          ) : (
            <Frame>
              <FramePanel>
                <RegionRetry message="Analytics are unavailable." pending={pending} onRetry={retry} />
              </FramePanel>
            </Frame>
          )}
          {operator && money !== undefined ? <MoneyRow money={money} pending={pending} onRetry={retry} /> : null}
          {summary || pending ? (
            <Frame stacked>
              <FramePanel className="p-0" role="region" aria-labelledby="call-trends-title">
                <RegionTitle id="call-trends-title" title="Call trends" description={summary ? `Times in ${summary.timeZone}` : undefined} />
                <div className="px-(--frame-panel-px) pb-(--frame-panel-py)">
                  {pending || !summary ? <CallTrendsSkeleton /> : hasCalls ? <CallTrendsChart trend={summary.trend} /> : <p className="py-10 text-center text-sm text-muted-foreground">{noCallsYet}</p>}
                </div>
              </FramePanel>
            </Frame>
          ) : null}
          {!pending && summary?.workspacePerformance ? (
            <Frame stacked>
              <FramePanel className="flex flex-col gap-3 p-0" role="region" aria-labelledby="workspace-performance-title">
                <RegionTitle id="workspace-performance-title" title="Workspace performance" />
                <WorkspacePerformance rows={summary.workspacePerformance} money={operator && money ? money.byWorkspace : undefined} />
              </FramePanel>
            </Frame>
          ) : null}
          <Frame stacked>
            <FramePanel className="flex flex-col gap-3 p-0" role="region" aria-labelledby="home-recent-calls-title">
              <RegionTitle
                id="home-recent-calls-title"
                title="Recent Calls"
                action={
                  <Button variant="outline" size="sm" render={<Link href={callsHref} prefetch />}>
                    View Calls
                  </Button>
                }
              />
              {recentCalls ? (
                <RecentCallsGrid calls={recentCalls.calls.slice(0, recentCallCount)} timeZone={recentCalls.timeZone} hasCalls={recentCalls.hasCalls} />
              ) : (
                <RegionRetry message="Recent Calls are unavailable." pending={pending} onRetry={retry} />
              )}
            </FramePanel>
          </Frame>
        </>
      )}
    </div>
  );
}
