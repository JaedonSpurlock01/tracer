/**
 * -------------------------------------------------------------------------
 * @file   report-document.test.ts
 * @brief  Verifies the report PDF document model built from report analytics.
 *
 * @description
 *  Checks the cover's generated time, report period, timezone, and
 *  Workspace scope; that a multi-Workspace report has a combined summary,
 *  a Workspace comparison, and one clearly separated section per
 *  Workspace, while a single-Workspace report has neither; the five KPIs
 *  with their comparisons, none for All Time and a dash against a zero
 *  prior; Call Outcome and effective Lead classification distributions
 *  with automated Lead Assessments labeled as estimates; and the notable
 *  Good Lead list kept in analytics order and capped.
 *
 * @remarks
 *  Analytics summaries are fixed, non-round fixtures in the shape the
 *  analytics service returns, so the model is tested without a database.
 *
 * @see
 *  data/report-document.ts
 *  data/analytics.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import type { NotableGoodLead, ReportAnalyticsSummary } from "@/data/analytics";
import { buildReportDocument, reportNotableGoodLeadLimit, type ReportDocumentInput } from "@/data/report-document";

const north = { id: "north", name: "North Plumbing" };
const south = { id: "south", name: "South Roofing, Inc." };

function lead(callId: string, workspace: { id: string; name: string }, leadScore: number | null, source: NotableGoodLead["source"]): NotableGoodLead {
  return { callId, workspace, startedAt: "2026-10-06T15:47:31.204Z", callerNumber: "+12125550187", outcome: "Answered", connectedSeconds: 283, leadScore, source, summary: "Caller asked for a water heater quote." };
}

function summary(overrides: Partial<ReportAnalyticsSummary> = {}): ReportAnalyticsSummary {
  return {
    timeZone: "America/Denver",
    window: { from: "2026-10-05", to: "2026-10-11" },
    previousWindow: { from: "2026-09-28", to: "2026-10-04" },
    kpis: {
      totalCalls: { value: 37, comparison: { previous: 29, change: 8 / 29, unit: "relative" } },
      answerRate: { value: 19 / 26, comparison: { previous: 0.65, change: 19 / 26 - 0.65, unit: "points" } },
      goodLeads: { value: 11, comparison: { previous: 0, change: null, unit: "relative" } },
      averageConnectedSeconds: { value: 187.4, comparison: { previous: 203, change: (187.4 - 203) / 203, unit: "relative" } },
      leadRate: { value: 11 / 37, comparison: { previous: 0, change: 11 / 37, unit: "points" } },
    },
    trend: {
      interval: "day",
      points: [
        { start: "2026-10-05", end: "2026-10-05", label: "Oct 5, 2026", totalCalls: 7, answeredCalls: 4, goodLeads: 2 },
        { start: "2026-10-06", end: "2026-10-06", label: "Oct 6, 2026", totalCalls: 3, answeredCalls: 3, goodLeads: 1 },
      ],
    },
    outcomes: [
      { outcome: "Answered", calls: 19 },
      { outcome: "Voicemail", calls: 6 },
      { outcome: "Missed", calls: 5 },
      { outcome: "Abandoned", calls: 2 },
      { outcome: "Blocked", calls: 3 },
      { outcome: "Failed", calls: 1 },
      { outcome: "In Progress", calls: 1 },
    ],
    classifications: [
      { classification: "Good Lead", reviewed: 4, assessed: 7 },
      { classification: "Not Good Lead", reviewed: 2, assessed: 9 },
      { classification: "Uncertain", reviewed: 0, assessed: 3 },
    ],
    unclassifiedCalls: 12,
    notableGoodLeads: [lead("call-1", north, 93, "assessment"), lead("call-2", south, 71, "review")],
    workspacePerformance: [
      { workspace: north, trackingNumber: "+14155550113", totalCalls: 23, answerRate: 13 / 17, goodLeads: 8, leadRate: 8 / 23 },
      { workspace: south, trackingNumber: "+14155550127", totalCalls: 14, answerRate: 6 / 9, goodLeads: 3, leadRate: 3 / 14 },
    ],
    ...overrides,
  };
}

const multi: ReportDocumentInput = {
  generatedAt: new Date("2026-10-14T15:41:27.906Z"),
  timeZone: "America/Denver",
  period: { kind: "previousWeek" },
  workspaces: [north, south],
  combined: summary(),
  sections: [
    { workspace: north, summary: summary({ workspacePerformance: null }) },
    { workspace: south, summary: summary({ workspacePerformance: null }) },
  ],
};

describe("Report document", () => {
  it("puts the generated time, report period, timezone, and Workspace scope on the cover", () => {
    expect(buildReportDocument(multi).cover).toEqual({
      title: "Call Report",
      generatedAt: "Oct 14, 2026, 9:41 AM MDT",
      period: "Previous Week",
      dates: "Oct 5, 2026 - Oct 11, 2026",
      timeZone: "America/Denver",
      scope: "2 Workspaces",
      workspaces: ["North Plumbing", "South Roofing, Inc."],
    });
  });

  it("leads a multi-Workspace report with a combined summary and Workspace comparison, followed by one section per Workspace", () => {
    const document = buildReportDocument(multi);
    expect(document.summary.title).toBe("Combined summary");
    expect(document.comparison).toEqual([
      { workspace: "North Plumbing", trackingNumber: "+14155550113", totalCalls: "23", answerRate: "76.5%", goodLeads: "8", leadRate: "34.8%" },
      { workspace: "South Roofing, Inc.", trackingNumber: "+14155550127", totalCalls: "14", answerRate: "66.7%", goodLeads: "3", leadRate: "21.4%" },
    ]);
    expect(document.workspaceSections.map((section) => section.title)).toEqual(["North Plumbing", "South Roofing, Inc."]);
  });

  it("gives a single-Workspace report one summary titled by its Workspace, without a comparison or Workspace sections", () => {
    const single = buildReportDocument({ ...multi, workspaces: [north], combined: summary({ workspacePerformance: null }), sections: [] });
    expect(single.cover.scope).toBe("1 Workspace");
    expect(single.summary.title).toBe("North Plumbing");
    expect(single.comparison).toBeNull();
    expect(single.workspaceSections).toEqual([]);
  });

  it("reports the five KPIs in DESIGN order with comparisons, a dash against a zero prior, and none for All Time", () => {
    expect(buildReportDocument(multi).summary.kpis).toEqual([
      { label: "Total Calls", value: "37", comparison: "+27.6% vs previous period" },
      { label: "Answer Rate", value: "73.1%", comparison: "+8.1 pts vs previous period" },
      { label: "Good Leads", value: "11", comparison: "- vs previous period" },
      { label: "Lead Rate", value: "29.7%", comparison: "+29.7 pts vs previous period" },
      { label: "Average Connected Duration", value: "3:07", comparison: "-7.7% vs previous period" },
    ]);
    const allTime = summary({ previousWindow: null, window: { from: "2025-09-17", to: "2026-10-14" } });
    for (const kpi of Object.values(allTime.kpis)) kpi.comparison = null;
    allTime.kpis.answerRate.value = null;
    allTime.kpis.averageConnectedSeconds.value = null;
    const document = buildReportDocument({ ...multi, period: { kind: "all" }, combined: allTime });
    expect(document.cover).toMatchObject({ period: "All Time", dates: "Sep 17, 2025 - Oct 14, 2026" });
    expect(document.summary.kpis.map(({ value, comparison }) => [value, comparison])).toEqual([["37", null], ["-", null], ["11", null], ["29.7%", null], ["-", null]]);
  });

  it("carries the three-series trend and the Call Outcome distribution with each share of Total Calls", () => {
    const section = buildReportDocument(multi).summary;
    expect(section.trend).toEqual({
      interval: "Daily",
      points: [
        { label: "Oct 5, 2026", totalCalls: 7, answeredCalls: 4, goodLeads: 2 },
        { label: "Oct 6, 2026", totalCalls: 3, answeredCalls: 3, goodLeads: 1 },
      ],
    });
    expect(section.outcomes).toEqual([
      { outcome: "Answered", calls: "19", share: "51.4%" },
      { outcome: "Voicemail", calls: "6", share: "16.2%" },
      { outcome: "Missed", calls: "5", share: "13.5%" },
      { outcome: "Abandoned", calls: "2", share: "5.4%" },
      { outcome: "Blocked", calls: "3", share: "8.1%" },
      { outcome: "Failed", calls: "1", share: "2.7%" },
      { outcome: "In Progress", calls: "1", share: "2.7%" },
    ]);
  });

  it("splits each effective Lead classification into Lead Reviews and Lead Assessments labeled as estimates", () => {
    const document = buildReportDocument(multi);
    expect(document.summary.classifications).toEqual([
      { classification: "Good Lead", reviewed: "4", estimated: "7", total: "11", share: "29.7%" },
      { classification: "Not Good Lead", reviewed: "2", estimated: "9", total: "11", share: "29.7%" },
      { classification: "Uncertain", reviewed: "0", estimated: "3", total: "3", share: "8.1%" },
      { classification: "Not classified", reviewed: "-", estimated: "-", total: "12", share: "32.4%" },
    ]);
    expect(document.estimateNote).toBe("Lead Assessments are automated estimates. A Lead Review, where one exists, takes precedence in every classification.");
  });

  it("lists at most ten notable Good Leads in analytics order, with start times in the report timezone and estimates labeled", () => {
    const leads = Array.from({ length: 12 }, (_, index) => lead(`call-${index + 1}`, index % 2 ? south : north, 97 - index * 3, index === 1 ? "review" : "assessment"));
    leads[11] = { ...leads[11], leadScore: null, summary: null, callerNumber: null, connectedSeconds: null };
    const document = buildReportDocument({ ...multi, combined: summary({ notableGoodLeads: leads }) });
    expect(reportNotableGoodLeadLimit).toBe(10);
    expect(document.summary.notableGoodLeads.map((row) => row.score)).toEqual(["97", "94", "91", "88", "85", "82", "79", "76", "73", "70"]);
    expect(document.summary.notableGoodLeads.slice(0, 2)).toEqual([
      { startedAt: "Oct 6, 2026, 9:47 AM", workspace: "North Plumbing", callerNumber: "+12125550187", outcome: "Answered", connectedDuration: "4:43", score: "97", basis: "Lead Assessment (estimate)", summary: "Caller asked for a water heater quote." },
      { startedAt: "Oct 6, 2026, 9:47 AM", workspace: "South Roofing, Inc.", callerNumber: "+12125550187", outcome: "Answered", connectedDuration: "4:43", score: "94", basis: "Lead Review", summary: "Caller asked for a water heater quote." },
    ]);
    const sparse = buildReportDocument({ ...multi, combined: summary({ notableGoodLeads: [leads[11]] }) }).summary.notableGoodLeads[0];
    expect(sparse).toMatchObject({ callerNumber: "-", connectedDuration: "-", score: "-", summary: null });
  });
});
