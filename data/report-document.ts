/**
 * -------------------------------------------------------------------------
 * @file   report-document.ts
 * @brief  Builds the report PDF's document model from report analytics.
 *
 * @description
 *  Turns a report job's scope, period, timezone, and analytics summaries
 *  into the structured content of the PDF, in DESIGN order. The cover
 *  carries the generated time with its zone abbreviation, the report
 *  period and its calendar dates, the document timezone, and the Workspace
 *  scope. A multi-Workspace report has a combined summary with the
 *  Workspace comparison, followed by one section per Workspace; a
 *  single-Workspace report has one section titled by its Workspace and no
 *  comparison. Each section holds Total Calls, Answer Rate, Good Leads,
 *  Lead Rate, and Average Connected Duration with their prior-period
 *  comparisons, none for All Time and a dash against a zero prior; the
 *  three-series trend; the Call Outcome distribution, In Progress
 *  included; the effective Lead classification distribution split into
 *  Lead Reviews and Lead Assessments labeled as estimates; and up to ten
 *  notable Good Leads in analytics order, by AI lead score then recency.
 *
 * @remarks
 *  Every number comes from the analytics service, so the PDF shares the
 *  dashboard KPI and classification rules; this module only formats.
 *  Calendar dates carry no timezone, so they format in UTC, while instants
 *  format in the report timezone. Shares divide by Total Calls.
 *
 * @see
 *  data/analytics.ts
 *  data/report-pdf.tsx
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { AnalyticsComparison, AnalyticsKpi, NotableGoodLead, ReportAnalyticsSummary } from "@/data/analytics";
import type { AnalyticsTrendInterval, AnalyticsWindow } from "@/data/analytics-range";
import type { ReportPeriod } from "@/data/report-period";

export interface ReportDocumentInput {
  generatedAt: Date;
  timeZone: string;
  period: ReportPeriod;
  workspaces: { id: string; name: string }[];
  combined: ReportAnalyticsSummary;
  sections: { workspace: { id: string; name: string }; summary: ReportAnalyticsSummary }[];
}

export interface ReportCover {
  title: string;
  generatedAt: string;
  period: string;
  dates: string;
  timeZone: string;
  scope: string;
  workspaces: string[];
}

export interface ReportKpi {
  label: string;
  value: string;
  comparison: string | null;
}

export interface ReportTrend {
  interval: string;
  points: { label: string; totalCalls: number; answeredCalls: number; goodLeads: number }[];
}

export interface ReportSection {
  title: string;
  kpis: ReportKpi[];
  trend: ReportTrend;
  outcomes: { outcome: string; calls: string; share: string }[];
  classifications: { classification: string; reviewed: string; estimated: string; total: string; share: string }[];
  notableGoodLeads: ReportNotableGoodLead[];
}

export interface ReportNotableGoodLead {
  startedAt: string;
  workspace: string;
  callerNumber: string;
  outcome: string;
  connectedDuration: string;
  score: string;
  basis: "Lead Review" | "Lead Assessment (estimate)";
  summary: string | null;
}

export const reportNotableGoodLeadLimit = 10;

export interface ReportComparisonRow {
  workspace: string;
  trackingNumber: string;
  totalCalls: string;
  answerRate: string;
  goodLeads: string;
  leadRate: string;
}

export interface ReportDocument {
  cover: ReportCover;
  summary: ReportSection;
  comparison: ReportComparisonRow[] | null;
  workspaceSections: ReportSection[];
  estimateNote: string;
}

const estimateNote = "Lead Assessments are automated estimates. A Lead Review, where one exists, takes precedence in every classification.";

const intervalNames: Readonly<Record<AnalyticsTrendInterval, string>> = { day: "Daily", week: "Weekly", month: "Monthly" };

const periodNames: Readonly<Record<ReportPeriod["kind"], string>> = {
  previousWeek: "Previous Week",
  previousMonth: "Previous Month",
  all: "All Time",
  custom: "Custom Range",
};

const countFormat = new Intl.NumberFormat("en-US");
const percentFormat = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });

function rate(value: number | null): string {
  return value === null ? "-" : percentFormat.format(value);
}

function count(value: number | null): string {
  return value === null ? "-" : countFormat.format(value);
}

const signedPercentFormat = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });
const signedPointsFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });

function duration(seconds: number | null): string {
  if (seconds === null) return "-";
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

function comparisonLabel(comparison: AnalyticsComparison | null): string | null {
  if (!comparison) return null;
  if (comparison.change === null) return "- vs previous period";
  const change = comparison.unit === "points" ? `${signedPointsFormat.format(comparison.change * 100)} pts` : signedPercentFormat.format(comparison.change);
  return `${change} vs previous period`;
}

function reportKpi(label: string, kpi: AnalyticsKpi, format: (value: number | null) => string): ReportKpi {
  return { label, value: format(kpi.value), comparison: comparisonLabel(kpi.comparison) };
}

const calendarDateFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium" });

function calendarDateLabel(date: string): string {
  return calendarDateFormat.format(new Date(`${date}T12:00:00Z`));
}

function windowLabel(window: AnalyticsWindow): string {
  return `${calendarDateLabel(window.from)} - ${calendarDateLabel(window.to)}`;
}

function localTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(instant);
}

function generatedTime(instant: Date, timeZone: string): string {
  const zone = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(instant).find((part) => part.type === "timeZoneName")?.value;
  return `${localTime(instant, timeZone)} ${zone ?? timeZone}`;
}

function notableGoodLead(lead: NotableGoodLead, timeZone: string): ReportNotableGoodLead {
  return {
    startedAt: localTime(new Date(lead.startedAt), timeZone),
    workspace: lead.workspace.name,
    callerNumber: lead.callerNumber ?? "-",
    outcome: lead.outcome ?? "In Progress",
    connectedDuration: duration(lead.connectedSeconds),
    score: count(lead.leadScore),
    basis: lead.source === "review" ? "Lead Review" : "Lead Assessment (estimate)",
    summary: lead.summary,
  };
}

function section(title: string, summary: ReportAnalyticsSummary, timeZone: string): ReportSection {
  const { kpis } = summary;
  const total = kpis.totalCalls.value ?? 0;
  const share = (calls: number) => rate(total === 0 ? null : calls / total);
  return {
    title,
    kpis: [
      reportKpi("Total Calls", kpis.totalCalls, count),
      reportKpi("Answer Rate", kpis.answerRate, rate),
      reportKpi("Good Leads", kpis.goodLeads, count),
      reportKpi("Lead Rate", kpis.leadRate, rate),
      reportKpi("Average Connected Duration", kpis.averageConnectedSeconds, duration),
    ],
    trend: {
      interval: intervalNames[summary.trend.interval],
      points: summary.trend.points.map(({ label, totalCalls, answeredCalls, goodLeads }) => ({ label, totalCalls, answeredCalls, goodLeads })),
    },
    outcomes: summary.outcomes.map(({ outcome, calls }) => ({ outcome, calls: count(calls), share: share(calls) })),
    classifications: [
      ...summary.classifications.map(({ classification, reviewed, assessed }) => ({
        classification,
        reviewed: count(reviewed),
        estimated: count(assessed),
        total: count(reviewed + assessed),
        share: share(reviewed + assessed),
      })),
      { classification: "Not classified", reviewed: "-", estimated: "-", total: count(summary.unclassifiedCalls), share: share(summary.unclassifiedCalls) },
    ],
    notableGoodLeads: summary.notableGoodLeads.slice(0, reportNotableGoodLeadLimit).map((lead) => notableGoodLead(lead, timeZone)),
  };
}

export function buildReportDocument(input: ReportDocumentInput): ReportDocument {
  const multiWorkspace = input.workspaces.length > 1;
  return {
    cover: {
      title: "Call Report",
      generatedAt: generatedTime(input.generatedAt, input.timeZone),
      period: periodNames[input.period.kind],
      dates: windowLabel(input.combined.window),
      timeZone: input.timeZone,
      scope: multiWorkspace ? `${input.workspaces.length} Workspaces` : "1 Workspace",
      workspaces: input.workspaces.map(({ name }) => name),
    },
    summary: section(multiWorkspace ? "Combined summary" : input.workspaces[0].name, input.combined, input.timeZone),
    comparison: multiWorkspace
      ? (input.combined.workspacePerformance ?? []).map((row) => ({
          workspace: row.workspace.name,
          trackingNumber: row.trackingNumber ?? "-",
          totalCalls: count(row.totalCalls),
          answerRate: rate(row.answerRate),
          goodLeads: count(row.goodLeads),
          leadRate: rate(row.leadRate),
        }))
      : null,
    workspaceSections: multiWorkspace ? input.sections.map(({ workspace, summary }) => section(workspace.name, summary, input.timeZone)) : [],
    estimateNote,
  };
}
