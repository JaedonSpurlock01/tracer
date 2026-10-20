/**
 * -------------------------------------------------------------------------
 * @file   workspace-overview.tsx
 * @brief  Renders the Workspace Overview analytics, routing health, and Recent Calls.
 *
 * @description
 *  Displays the Workspace header with its state, numbers, reporting
 *  timezone, date controls, and actions, then the KPI row and Call trends
 *  chart in the Workspace reporting timezone, routing health, the
 *  published Call Flow summary, and the five Recent Calls linking to Call
 *  Detail, with View Calls opening Workspace Calls over the same range. The
 *  Workspace tabs sit below the header. Operators get Edit Flow and
 *  Workspace Settings; Client Viewers get Generate Report, scoped to this
 *  Workspace and its reporting timezone, and Workspace Reports.
 *
 * @remarks
 *  Lifecycle state and health stay separate: routing health reports the
 *  Twilio webhook health and last successful inbound Call from recorded
 *  provider events, and a webhook Warning stays inside routing health with
 *  an Operator-only action that opens the Number settings. Analytics,
 *  routing health, and Recent Calls each fail alone with an inline Retry
 *  that rerenders the page. Setup Required replaces the analytics with
 *  Resume Setup and its checklist. Archived keeps historical analytics and
 *  Calls readable under an archived label and removes live-routing actions.
 *
 * @see
 *  data/analytics.ts
 *  data/workspace-routing.ts
 *  components/tracer/analytics-panels.tsx
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/reui/badge";
import { Frame, FramePanel } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import {
  AnalyticsKpiRow,
  AnalyticsKpiSkeleton,
  AnalyticsRangeControls,
  CallTrendsChart,
  CallTrendsSkeleton,
  RegionRetry,
  useAnalyticsNavigation,
} from "@/components/tracer/analytics-panels";
import CallOutcomeBadge from "@/components/tracer/call-outcome-badge";
import { formatCallDate, formatCallTime, formatClock } from "@/components/tracer/call-format";
import FlowSummary from "@/components/tracer/flow/flow-summary";
import GenerateReportButton from "@/components/tracer/generate-report-dialog";
import WorkspaceTabs from "@/components/tracer/workspace-tabs";
import type { AnalyticsSummary, WebhookHealth, WorkspaceRoutingHealth } from "@/data/analytics";
import type { AnalyticsRange } from "@/data/analytics-range";
import type { RecentCall } from "@/data/call-details";
import type { CallFlowGraph } from "@/data/call-flow";
import type { WorkspaceRecord } from "@/data/workspaces";
import { describeSetupChecklist } from "@/data/workspace-policy";

interface WorkspaceOverviewProps {
  workspace: WorkspaceRecord;
  flow?: { published: { version: number; graph: CallFlowGraph } | null };
  readOnly?: boolean;
  recentCalls?: RecentCall[] | null;
  routingHealth?: WorkspaceRoutingHealth | null;
  analytics?: { range: AnalyticsRange; summary: AnalyticsSummary | null; callsHref: string };
}

const healthBadges = {
  Healthy: ["Healthy", "success-light"],
  Warning: ["Needs attention", "warning-light"],
  "Not applicable": ["Not applicable", "outline"],
} as const satisfies Record<WebhookHealth["status"], readonly [string, string]>;

function stateVariant(state: WorkspaceRecord["state"]): "primary-light" | "success-light" | "destructive-light" {
  if (state === "Active") return "success-light";
  if (state === "Archived") return "destructive-light";
  return "primary-light";
}

function RecentCalls({ workspace, calls, viewCallsHref, onRetry, pending }: { workspace: WorkspaceRecord; calls: RecentCall[] | null; viewCallsHref: string; onRetry: () => void; pending: boolean }) {
  return (
    <Frame>
      <FramePanel className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <h2 id="recent-calls-title" className="font-semibold">Recent Calls</h2>
          <Button variant="outline" render={<Link href={viewCallsHref} prefetch />}>
            View Calls
          </Button>
        </div>
        {calls === null ? (
          <RegionRetry message="Recent Calls are unavailable." pending={pending} onRetry={onRetry} />
        ) : calls.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Calls yet. Calls appear after the first inbound Call reaches the Tracking Number.</p>
        ) : (
          <ul aria-labelledby="recent-calls-title" className="flex flex-col divide-y divide-border">
            {calls.map((call) => (
              <li key={call.id}>
                <Link
                  href={`/workspaces/${workspace.id}/calls/${call.id}`}
                  prefetch
                  className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-2 text-sm transition-colors hover:bg-muted/50 sm:grid-cols-[8rem_1fr_auto_4rem]"
                >
                  <span><CallOutcomeBadge outcome={call.outcome} /></span>
                  <span className="font-mono font-medium tabular-nums">{call.callerNumber ?? "Unknown caller"}</span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">{formatCallTime(call.startedAt, workspace.reportingTimezone)}</span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums sm:text-right">{call.connectedDurationSeconds === null ? "-" : formatClock(call.connectedDurationSeconds)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </FramePanel>
    </Frame>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm tabular-nums">{children}</dd>
    </div>
  );
}

function RoutingHealth({ workspace, health, operator, pending, onRetry }: { workspace: WorkspaceRecord; health: WorkspaceRoutingHealth | null | undefined; operator: boolean; pending: boolean; onRetry: () => void }) {
  const zone = workspace.reportingTimezone;
  const time = (iso: string | null) => (iso ? formatCallTime(iso, zone) : "-");
  const webhook = health?.webhook;
  const [label, variant] = webhook ? healthBadges[webhook.status] : [null, null];
  return (
    <Frame>
      <FramePanel role="region" aria-labelledby="routing-health-title" className="flex flex-col gap-4">
        <h2 id="routing-health-title" className="font-semibold">Routing health</h2>
        {webhook?.status === "Warning" ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/25 bg-warning/15 px-3 py-2 text-sm">
            <p>No accepted Twilio voice webhook for the current Tracking Number.</p>
            {operator ? (
              <Button variant="outline" size="sm" render={<Link href={`/workspaces/${workspace.id}/settings/number`} prefetch />}>
                Review Number Settings
              </Button>
            ) : null}
          </div>
        ) : null}
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Tracking Number">{workspace.trackingNumber ?? "-"}</Fact>
          <Fact label="Assignment start">{time(workspace.numberAssignmentStartedAt)}</Fact>
          <Fact label="Destination Number">{workspace.destinationNumber ?? "-"}</Fact>
          <Fact label="Twilio webhook health">
            {health === null ? "Unavailable" : webhook && label && variant ? <Badge variant={variant}>{label}</Badge> : "-"}
          </Fact>
          <Fact label="Last successful inbound Call">{health === null ? "Unavailable" : health ? (health.lastSuccessfulInboundCallAt ? time(health.lastSuccessfulInboundCallAt) : "None yet") : "-"}</Fact>
          <Fact label="Recording">{workspace.recordingEnabled ? "Enabled" : "Disabled"}</Fact>
          <Fact label="Spam gate">{workspace.spamGateEnabled ? "Enabled" : "Disabled"}</Fact>
          <Fact label="Whisper">{workspace.whisperEnabled ? workspace.whisperMessage || "Enabled" : "Disabled"}</Fact>
          <Fact label="Call Flow published">{time(workspace.publishedFlowVersion?.publishedAt ?? null)}</Fact>
        </dl>
        {health === null ? <RegionRetry message="Webhook health is unavailable." pending={pending} onRetry={onRetry} /> : null}
      </FramePanel>
    </Frame>
  );
}

function Analytics({ analytics, pending, onRetry }: { analytics: NonNullable<WorkspaceOverviewProps["analytics"]>; pending: boolean; onRetry: () => void }) {
  const { summary } = analytics;
  if (!pending && !summary) {
    return (
      <Frame>
        <FramePanel>
          <RegionRetry message="Analytics are unavailable." pending={pending} onRetry={onRetry} />
        </FramePanel>
      </Frame>
    );
  }
  return (
    <>
      {pending || !summary ? <AnalyticsKpiSkeleton /> : <AnalyticsKpiRow kpis={summary.kpis} />}
      <Frame>
        <FramePanel role="region" aria-labelledby="call-trends-title" className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 id="call-trends-title" className="font-semibold">Call trends</h2>
            {summary ? <p className="text-xs text-muted-foreground">Times in {summary.timeZone}</p> : null}
          </div>
          {pending || !summary ? <CallTrendsSkeleton /> : <CallTrendsChart trend={summary.trend} />}
        </FramePanel>
      </Frame>
    </>
  );
}

export default function WorkspaceOverview({ workspace, flow, readOnly = false, recentCalls, routingHealth, analytics }: WorkspaceOverviewProps) {
  const { pending, changeRange, retry } = useAnalyticsNavigation();
  const checklist = describeSetupChecklist(workspace);
  const published = flow?.published ?? null;
  const operator = !readOnly;
  const setupRequired = workspace.state === "Setup Required";
  const archived = workspace.state === "Archived";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <Badge variant={stateVariant(workspace.state)}>{workspace.state}</Badge>
            <span className="font-mono tabular-nums">Tracking {workspace.trackingNumber ?? "-"}</span>
            <span className="font-mono tabular-nums">Destination {workspace.destinationNumber ?? "-"}</span>
            <span>{workspace.reportingTimezone}</span>
          </div>
          {archived ? (
            <p className="text-sm text-muted-foreground">
              Archived {workspace.archivedAt ? `${formatCallDate(workspace.archivedAt, workspace.reportingTimezone)}. ` : ". "}Historical analytics and Calls stay readable; routing is read-only.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {operator ? (
            <>
              <Button variant="outline" render={<Link href={`/workspaces/${workspace.id}/settings/general`} prefetch />}>
                Workspace Settings
              </Button>
              {setupRequired ? <Button render={<Link href={`/workspaces?resume=${workspace.id}`} />}>Resume Setup</Button> : null}
              {archived ? <Button render={<Link href={`/workspaces/${workspace.id}/settings/danger`} />}>Restore</Button> : null}
              {workspace.state === "Active" ? <Button render={<Link href={`/workspaces/${workspace.id}/flow`} />}>Edit Flow</Button> : null}
            </>
          ) : (
            <>
              <Button variant="outline" render={<Link href={`/workspaces/${workspace.id}/reports`} prefetch />}>
                Reports
              </Button>
              <GenerateReportButton scope={{ kind: "workspace", workspace: { id: workspace.id, name: workspace.name, reportingTimezone: workspace.reportingTimezone } }} />
            </>
          )}
        </div>
      </div>
      <WorkspaceTabs workspaceId={workspace.id} operator={operator} current="overview" />
      {setupRequired && operator ? (
        <Frame>
          <FramePanel className="flex flex-col gap-4">
            <div>
              <h2 className="font-semibold">Setup Required</h2>
              <p className="text-sm text-muted-foreground">Finish these requirements before the Workspace can become Active.</p>
            </div>
            <ul className="grid gap-2">
              {checklist.map((item) => (
                <li key={item.label} className="flex items-center gap-2 text-sm">
                  <span>{item.complete ? "Complete" : "Incomplete"}</span>
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          </FramePanel>
        </Frame>
      ) : null}
      {analytics && !setupRequired ? (
        <>
          <AnalyticsRangeControls range={analytics.range} onRangeChange={changeRange} disabled={pending} />
          <Analytics analytics={analytics} pending={pending} onRetry={retry} />
        </>
      ) : null}
      <RoutingHealth workspace={workspace} health={routingHealth} operator={operator && !archived} pending={pending} onRetry={retry} />
      <Frame>
        <FramePanel>
          <h2 className="font-semibold">Call Flow</h2>
          {published ? (
            <div className="mt-4">
              <FlowSummary graph={published.graph} />
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No published Call Flow.</p>
          )}
        </FramePanel>
      </Frame>
      {recentCalls !== undefined ? (
        <RecentCalls workspace={workspace} calls={recentCalls} viewCallsHref={analytics?.callsHref ?? `/workspaces/${workspace.id}/calls`} onRetry={retry} pending={pending} />
      ) : null}
    </div>
  );
}
