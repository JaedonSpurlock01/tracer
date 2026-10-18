/**
 * -------------------------------------------------------------------------
 * @file   analytics.ts
 * @brief  Computes the dashboard KPIs, trends, Workspace performance, and Workspace health.
 *
 * @description
 *  One query service backs Home, Workspace Overview, and the Workspaces
 *  list, so every surface shares the KPI definitions. A summary covers one
 *  readable Workspace in its reporting timezone, or every readable
 *  Workspace in the user's timezone, over a dashboard range. Total Calls
 *  counts every Call started in the range, In Progress included. Answer
 *  Rate divides the Answered Calls among Calls with a Forwarding attempted
 *  event by those Calls, so Abandoned, Missed, and Failed forwards count
 *  against it while Voicemail, Blocked, and spam-gate failures do not.
 *  Good Leads count the effective Lead classification, Lead Review before
 *  Lead Assessment. Average Connected Duration averages the connected
 *  duration of Answered Calls only. Each KPI compares with the immediately
 *  preceding window of equal length, except for All Time; the change is the
 *  relative difference and is null when the prior value is zero or absent,
 *  so a view shows a dash. Trend points count Total Calls, Answered Calls,
 *  and Good Leads per zero-filled bucket. Workspace performance lists Total
 *  Calls, Answer Rate, Good Leads, and Lead Rate (Good Leads over Total
 *  Calls) per readable Workspace, Total Calls descending, and is withheld
 *  entirely unless the actor reads more than one Workspace. The Workspaces
 *  list reads each Workspace's Calls and Good Leads for the last 30 days in
 *  its reporting timezone, its last Call, and its webhook health, and
 *  Workspace Overview reads the same last Call and webhook health as its
 *  routing health.
 *
 * @remarks
 *  Every aggregate reads the Calls list source, readable Workspace
 *  condition, effective classification, and Started date filter, so the
 *  same scope and dates always give the Calls list's Total Calls and Good
 *  Leads; the connected duration reuses the Call Detail rule. Dates are
 *  calendar dates resolved at local midnight in the scope timezone, and the
 *  trend reads Call counts per local day and assigns them to buckets with
 *  the shared range module, so midnight and daylight saving changes fall
 *  on the right day. An All Time trend starts at the first Call's day.
 *  Webhook health comes from recorded provider events, never a live Twilio
 *  check: an Active Workspace warns while its current Number Assignment has
 *  no accepted voice webhook, and other Workspace States are not
 *  applicable. Signature rejections are not part of it, because the
 *  webhook handler answers a bad signature with a 403 and records no
 *  provider event. The clock is injectable so ranges resolve against a
 *  fixed today in tests.
 *
 * @see
 *  data/analytics-range.ts
 *  data/calls.ts
 *  data/call-details.ts
 *  data/workspace-authorization.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import {
  analyticsBucketStart,
  analyticsTrendBuckets,
  analyticsTrendInterval,
  analyticsWindow,
  calendarDateInTimeZone,
  previousAnalyticsWindow,
  type AnalyticsRange,
  type AnalyticsTrendBucket,
  type AnalyticsTrendInterval,
  type AnalyticsWindow,
} from "@/data/analytics-range";
import type { Actor } from "@/data/authorization";
import { connectedSecondsSql } from "@/data/call-details";
import { emptyCallFilters } from "@/data/call-list-query";
import { callSource, effectiveClassificationSql, filterConditions } from "@/data/calls";
import type { WorkspaceState } from "@/data/workspace-policy";
import { createReadableWorkspaces, readableWorkspaceSql } from "@/data/workspace-authorization";

export interface AnalyticsComparison {
  previous: number | null;
  change: number | null;
}

export interface AnalyticsKpi {
  value: number | null;
  comparison: AnalyticsComparison | null;
}

export interface AnalyticsKpis {
  totalCalls: AnalyticsKpi;
  answerRate: AnalyticsKpi;
  goodLeads: AnalyticsKpi;
  averageConnectedSeconds: AnalyticsKpi;
}

export interface AnalyticsTrendPoint extends AnalyticsTrendBucket {
  totalCalls: number;
  answeredCalls: number;
  goodLeads: number;
}

export interface WorkspacePerformanceRow {
  workspace: { id: string; name: string };
  trackingNumber: string | null;
  totalCalls: number;
  answerRate: number | null;
  goodLeads: number;
  leadRate: number | null;
}

export interface AnalyticsSummary {
  timeZone: string;
  workspace: { id: string; name: string } | null;
  window: AnalyticsWindow;
  previousWindow: AnalyticsWindow | null;
  kpis: AnalyticsKpis;
  trend: { interval: AnalyticsTrendInterval; points: AnalyticsTrendPoint[] };
  workspacePerformance: WorkspacePerformanceRow[] | null;
}

export interface AnalyticsQuery {
  workspaceId?: string;
  range: AnalyticsRange;
}

export interface WebhookHealth {
  status: "Healthy" | "Warning" | "Not applicable";
  lastAcceptedVoiceWebhookAt: string | null;
}

export interface WorkspaceListStats {
  callsLast30Days: number;
  goodLeadsLast30Days: number;
  lastCallAt: string | null;
  integrationHealth: WebhookHealth;
}

export interface WorkspaceRoutingHealth {
  lastSuccessfulInboundCallAt: string | null;
  webhook: WebhookHealth;
}

export interface Analytics {
  summary(query: AnalyticsQuery): Promise<AnalyticsSummary | null>;
  workspaceListStats(workspaceIds: string[]): Promise<Record<string, WorkspaceListStats>>;
  routingHealth(workspaceId: string): Promise<WorkspaceRoutingHealth | null>;
}

const answeredSql = "c.outcome = 'Answered'";
const forwardedSql = "exists (select 1 from call_event e where e.organization_id = c.organization_id and e.call_id = c.id and e.kind = 'forwarding_attempted')";
const goodLeadSql = `${effectiveClassificationSql} = 'Good Lead'`;

const aggregateColumns = `count(*)::int as total_calls,
       count(*) filter (where ${forwardedSql})::int as forwarded_calls,
       count(*) filter (where ${answeredSql} and ${forwardedSql})::int as answered_forwarded_calls,
       count(*) filter (where ${goodLeadSql})::int as good_leads,
       (avg(${connectedSecondsSql}) filter (where ${answeredSql}))::float8 as average_connected_seconds`;

type AggregateRow = { total_calls: number; forwarded_calls: number; answered_forwarded_calls: number; good_leads: number; average_connected_seconds: number | null };

const recentWindowDays = 30;

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function kpi(value: number | null, previous: number | null | undefined): AnalyticsKpi {
  if (previous === undefined) return { value, comparison: null };
  const change = value === null || previous === null || previous === 0 ? null : (value - previous) / previous;
  return { value, comparison: { previous, change } };
}

function kpiValues(row: AggregateRow) {
  return {
    totalCalls: row.total_calls,
    answerRate: ratio(row.answered_forwarded_calls, row.forwarded_calls),
    goodLeads: row.good_leads,
    averageConnectedSeconds: row.average_connected_seconds,
  };
}

function webhookHealth(state: WorkspaceState, lastAccepted: Date | null): WebhookHealth {
  const lastAcceptedVoiceWebhookAt = lastAccepted?.toISOString() ?? null;
  if (state !== "Active") return { status: "Not applicable", lastAcceptedVoiceWebhookAt };
  return { status: lastAccepted ? "Healthy" : "Warning", lastAcceptedVoiceWebhookAt };
}

export function createAnalytics(pool: Pool, actor: Actor, options: { now?: () => Date } = {}): Analytics {
  const workspaces = createReadableWorkspaces(pool, actor);
  const now = options.now ?? (() => new Date());

  function scopeConditions(values: unknown[], workspaceId: string | null, window: AnalyticsWindow | null, timeZone: string): string {
    const conditions = [readableWorkspaceSql(actor, values)];
    if (workspaceId) {
      values.push(workspaceId);
      conditions.push(`c.workspace_id = $${values.length}`);
    }
    if (window) conditions.push(...filterConditions({ ...emptyCallFilters, startedFrom: window.from, startedTo: window.to }, values, { scoped: workspaceId !== null, timeZone }));
    return conditions.join(" and ");
  }

  async function aggregate(workspaceId: string | null, window: AnalyticsWindow | null, timeZone: string): Promise<AggregateRow> {
    const values: unknown[] = [];
    const where = scopeConditions(values, workspaceId, window, timeZone);
    return (await pool.query<AggregateRow>(`select ${aggregateColumns} from ${callSource} where ${where}`, values)).rows[0];
  }

  async function trend(workspaceId: string | null, window: AnalyticsWindow | null, timeZone: string, interval: AnalyticsTrendInterval, today: string) {
    const values: unknown[] = [];
    const where = scopeConditions(values, workspaceId, window, timeZone);
    values.push(timeZone);
    const rows = await pool.query<{ day: string; total_calls: number; answered_calls: number; good_leads: number }>(
      `select to_char((c.started_at at time zone $${values.length})::date, 'YYYY-MM-DD') as day,
              count(*)::int as total_calls,
              count(*) filter (where ${answeredSql})::int as answered_calls,
              count(*) filter (where ${goodLeadSql})::int as good_leads
         from ${callSource}
        where ${where}
        group by 1
        order by 1`,
      values,
    );
    const first = rows.rows[0]?.day;
    const trendWindow = window ?? { from: first && first < today ? first : today, to: today };
    const points = analyticsTrendBuckets(interval, trendWindow).map((bucket): AnalyticsTrendPoint => ({ ...bucket, totalCalls: 0, answeredCalls: 0, goodLeads: 0 }));
    const byStart = new Map(points.map((point) => [analyticsBucketStart(interval, point.start), point]));
    for (const row of rows.rows) {
      const point = byStart.get(analyticsBucketStart(interval, row.day));
      if (!point) continue;
      point.totalCalls += row.total_calls;
      point.answeredCalls += row.answered_calls;
      point.goodLeads += row.good_leads;
    }
    return { window: trendWindow, points };
  }

  async function workspacePerformance(window: AnalyticsWindow | null, timeZone: string): Promise<WorkspacePerformanceRow[] | null> {
    const readable: unknown[] = [];
    const listed = await pool.query<{ id: string; name: string; tracking_number: string | null }>(
      `select w.id, w.name, na.phone_number as tracking_number
         from workspace w
         left join number_assignment na on na.workspace_id = w.id and na.organization_id = w.organization_id and na.ended_at is null
        where ${readableWorkspaceSql(actor, readable)}`,
      readable,
    );
    if (listed.rows.length <= 1) return null;
    const values: unknown[] = [];
    const where = scopeConditions(values, null, window, timeZone);
    const aggregates = await pool.query<AggregateRow & { workspace_id: string }>(
      `select c.workspace_id, ${aggregateColumns} from ${callSource} where ${where} group by c.workspace_id`,
      values,
    );
    const byWorkspace = new Map(aggregates.rows.map((row) => [row.workspace_id, row]));
    return listed.rows
      .map((workspace): WorkspacePerformanceRow => {
        const row = byWorkspace.get(workspace.id);
        const totalCalls = row?.total_calls ?? 0;
        const goodLeads = row?.good_leads ?? 0;
        return {
          workspace: { id: workspace.id, name: workspace.name },
          trackingNumber: workspace.tracking_number,
          totalCalls,
          answerRate: row ? ratio(row.answered_forwarded_calls, row.forwarded_calls) : null,
          goodLeads,
          leadRate: ratio(goodLeads, totalCalls),
        };
      })
      .sort((a, b) => b.totalCalls - a.totalCalls || a.workspace.name.localeCompare(b.workspace.name) || a.workspace.id.localeCompare(b.workspace.id));
  }

  async function workspaceListStats(workspaceIds: string[]): Promise<Record<string, WorkspaceListStats>> {
    if (workspaceIds.length === 0) return {};
    const values: unknown[] = [];
    const readable = readableWorkspaceSql(actor, values);
    values.push(workspaceIds, now().toISOString(), recentWindowDays - 1);
    const [ids, at, daysBack] = [`$${values.length - 2}`, `$${values.length - 1}::timestamptz`, `$${values.length}::int`];
    const localToday = `(${at} at time zone w.reporting_timezone)::date`;
    const recent = `c.started_at >= (${localToday} - ${daysBack})::timestamp at time zone w.reporting_timezone and c.started_at < (${localToday} + 1)::timestamp at time zone w.reporting_timezone`;
    const [health, calls] = await Promise.all([
      pool.query<{ id: string; state: WorkspaceState; last_accepted_voice_at: Date | null }>(
        `select w.id, w.state,
                (select max(pe.received_at)
                   from number_assignment na
                   join provider_event pe on pe.number_assignment_id = na.id and pe.organization_id = na.organization_id
                  where na.workspace_id = w.id and na.organization_id = w.organization_id and na.ended_at is null
                    and pe.kind = 'voice' and pe.disposition = 'accepted') as last_accepted_voice_at
           from workspace w
          where ${readable} and w.id = any(${ids}::text[])`,
        values.slice(0, values.length - 2),
      ),
      pool.query<{ workspace_id: string; calls: number; good_leads: number; last_call_at: Date | null }>(
        `select c.workspace_id,
                count(*) filter (where ${recent})::int as calls,
                count(*) filter (where ${recent} and ${goodLeadSql})::int as good_leads,
                max(c.started_at) as last_call_at
           from ${callSource}
          where ${readable} and c.workspace_id = any(${ids}::text[])
          group by c.workspace_id`,
        values,
      ),
    ]);
    const callsByWorkspace = new Map(calls.rows.map((row) => [row.workspace_id, row]));
    return Object.fromEntries(health.rows.map((row) => {
      const stats = callsByWorkspace.get(row.id);
      return [row.id, {
        callsLast30Days: stats?.calls ?? 0,
        goodLeadsLast30Days: stats?.good_leads ?? 0,
        lastCallAt: stats?.last_call_at?.toISOString() ?? null,
        integrationHealth: webhookHealth(row.state, row.last_accepted_voice_at),
      }];
    }));
  }

  return {
    async summary(query) {
      const workspace = query.workspaceId === undefined ? null : await workspaces.find(query.workspaceId);
      if (query.workspaceId !== undefined && !workspace) return null;
      const workspaceId = workspace?.id ?? null;
      const timeZone = workspace?.reportingTimezone ?? actor.timezone;
      const today = calendarDateInTimeZone(now(), timeZone);
      const window = analyticsWindow(query.range, today);
      const previousWindow = previousAnalyticsWindow(window);
      const interval = analyticsTrendInterval(query.range);
      const [current, previous, trendResult, performance] = await Promise.all([
        aggregate(workspaceId, window, timeZone),
        previousWindow ? aggregate(workspaceId, previousWindow, timeZone) : null,
        trend(workspaceId, window, timeZone, interval, today),
        workspace ? null : workspacePerformance(window, timeZone),
      ]);
      const values = kpiValues(current);
      const prior = previous ? kpiValues(previous) : undefined;
      return {
        timeZone,
        workspace: workspace ? { id: workspace.id, name: workspace.name } : null,
        window: trendResult.window,
        previousWindow,
        kpis: {
          totalCalls: kpi(values.totalCalls, prior?.totalCalls),
          answerRate: kpi(values.answerRate, prior?.answerRate),
          goodLeads: kpi(values.goodLeads, prior?.goodLeads),
          averageConnectedSeconds: kpi(values.averageConnectedSeconds, prior?.averageConnectedSeconds),
        },
        trend: { interval, points: trendResult.points },
        workspacePerformance: performance,
      };
    },
    workspaceListStats,
    async routingHealth(workspaceId) {
      const stats = (await workspaceListStats([workspaceId]))[workspaceId];
      return stats ? { lastSuccessfulInboundCallAt: stats.lastCallAt, webhook: stats.integrationHealth } : null;
    },
  };
}
