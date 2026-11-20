/**
 * -------------------------------------------------------------------------
 * @file   home-sample.prototype.ts
 * @brief  PROTOTYPE. Made-up Home data shown when the URL has ?sample=true.
 *
 * @description
 *  Builds a believable month for six invented Workspaces: totals with a
 *  comparison to the previous period, a daily trend with a weekday rhythm,
 *  per-Workspace performance with cost and revenue, and twelve recent Calls
 *  of mixed outcomes and lead results. Nothing here reads or writes the
 *  database.
 *
 * @remarks
 *  Throwaway, like the prototype it feeds. The numbers are fixed rather than
 *  random so every variant shows the same month. Call rows link to Calls
 *  that do not exist.
 *
 * @see
 *  components/tracer/prototype/home-variants.prototype.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { HomeMoney } from "@/components/tracer/home-dashboard";
import type { AnalyticsSummary, AnalyticsTrendPoint } from "@/data/analytics";
import type { CallListItem, CallListResult } from "@/data/calls";

const timeZone = "America/Chicago";
const day = 86_400_000;

const workspaces = [
  { id: "sample-1", name: "Austin Plumbing Pros", number: "+15125550142", calls: 148, answer: 0.91, leads: 61, cost: 4120, revenue: 150000 },
  { id: "sample-2", name: "Lakeway Roofing", number: "+15125550177", calls: 96, answer: 0.84, leads: 33, cost: 3310, revenue: 99000 },
  { id: "sample-3", name: "Round Rock HVAC", number: "+15125550109", calls: 73, answer: 0.78, leads: 29, cost: 2890, revenue: 72500 },
  { id: "sample-4", name: "Cedar Park Tree Service", number: "+15125550163", calls: 41, answer: 0.66, leads: 9, cost: 2240, revenue: 40000 },
  { id: "sample-5", name: "Georgetown Garage Doors", number: "+15125550121", calls: 18, answer: 0.94, leads: 7, cost: 1980, revenue: 0 },
  { id: "sample-6", name: "Pflugerville Pest Control", number: null, calls: 0, answer: null, leads: 0, cost: 400, revenue: 0 },
];

function trend(now: number): AnalyticsTrendPoint[] {
  const label = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(now - (29 - index) * day);
    const weekday = date.getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const totalCalls = Math.round((weekend ? 5 : 13) + index * 0.18 + ((index * 7) % 5));
    const answeredCalls = Math.round(totalCalls * (0.78 + ((index * 3) % 4) * 0.04));
    const start = date.toISOString().slice(0, 10);
    return {
      start,
      end: start,
      label: label.format(date),
      totalCalls,
      answeredCalls,
      goodLeads: Math.round(answeredCalls * 0.42),
      formSubmissions: weekend ? 0 : (index * 5) % 4,
    };
  });
}

const recent: Array<[string, number, CallListItem["outcome"], number | null, CallListItem["effectiveLeadClassification"], number]> = [
  ["+15125550188", 0, "Answered", 214, { classification: "Good Lead", source: "assessment" }, 4],
  ["+17375550102", 0, "Answered", 96, { classification: "Good Lead", source: "review" }, 22],
  ["+15125550134", 1, "Voicemail", 31, { classification: "Uncertain", source: "assessment" }, 47],
  ["+12105550190", 2, "Missed", null, null, 65],
  ["+15125550171", 0, "Answered", 402, { classification: "Good Lead", source: "review" }, 118],
  ["+18305550116", 3, "Abandoned", null, null, 164],
  ["+15125550155", 1, "Answered", 58, { classification: "Not Good Lead", source: "assessment" }, 201],
  ["+17375550148", 2, "Answered", 173, { classification: "Good Lead", source: "assessment" }, 260],
  [null as unknown as string, 0, "Blocked", null, null, 335],
  ["+15125550119", 4, "Answered", 244, { classification: "Good Lead", source: "review" }, 410],
  ["+12545550127", 1, "Voicemail", 19, { classification: "Not Good Lead", source: "review" }, 1500],
  ["+15125550160", 3, "Answered", 87, { classification: "Uncertain", source: "assessment" }, 1720],
];

export function sampleHome(): { workspaceCount: number; summary: AnalyticsSummary; recentCalls: CallListResult; money: HomeMoney } {
  const now = Date.now();
  const points = trend(now);
  const totalCalls = workspaces.reduce((sum, row) => sum + row.calls, 0);
  const goodLeads = workspaces.reduce((sum, row) => sum + row.leads, 0);
  const costCents = workspaces.reduce((sum, row) => sum + row.cost, 0);
  const revenueCents = workspaces.reduce((sum, row) => sum + row.revenue, 0);
  const calls: CallListItem[] = recent.map(([callerNumber, workspace, outcome, seconds, lead, minutesAgo], index) => ({
    id: `sample-call-${index}`,
    workspace: { id: workspaces[workspace].id, name: workspaces[workspace].name },
    callerNumber: callerNumber ?? null,
    state: "Completed" as CallListItem["state"],
    outcome,
    startedAt: new Date(now - minutesAgo * 60_000).toISOString(),
    connectedDurationSeconds: seconds,
    effectiveLeadClassification: lead,
    leadScore: lead ? 60 + ((index * 9) % 35) : null,
    recording: seconds ? "Ready" : "Unavailable",
    mp3RecordingId: null,
  }));
  return {
    workspaceCount: workspaces.length,
    summary: {
      timeZone,
      workspace: null,
      window: { from: points[0].start, to: points[29].start },
      previousWindow: null,
      kpis: {
        totalCalls: { value: totalCalls, comparison: { previous: 331, change: (totalCalls - 331) / 331, unit: "relative" } },
        answerRate: { value: 0.842, comparison: { previous: 0.871, change: -0.029, unit: "points" } },
        goodLeads: { value: goodLeads, comparison: { previous: 112, change: (goodLeads - 112) / 112, unit: "relative" } },
        averageConnectedSeconds: { value: 167, comparison: { previous: 154, change: 13 / 154, unit: "relative" } },
      },
      goodLeadForms: 17,
      trend: { interval: "day", points },
      workspacePerformance: workspaces.map((row) => ({
        workspace: { id: row.id, name: row.name },
        trackingNumber: row.number,
        totalCalls: row.calls,
        answerRate: row.answer,
        goodLeads: row.leads,
        leadRate: row.calls === 0 ? null : row.leads / row.calls,
      })),
    },
    recentCalls: { calls, total: totalCalls, page: 1, pageSize: 25, timeZone, workspace: null, hasCalls: true },
    money: {
      month: "November 2026",
      totals: { costCents, yearlyCostCents: costCents * 12, revenueCents, profitCents: revenueCents - costCents },
      byWorkspace: Object.fromEntries(workspaces.map((row) => [row.id, { costCents: row.cost, revenueCents: row.revenue }])),
    },
  };
}
