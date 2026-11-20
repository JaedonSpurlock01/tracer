/**
 * -------------------------------------------------------------------------
 * @file   home-variants.prototype.tsx
 * @brief  PROTOTYPE. Three throwaway layouts for Home, switched by ?variant=.
 *
 * @description
 *  Three variants of Home on the existing `/` route, switchable via
 *  `?variant=a|b|c` and the floating bar. No param renders the real Home.
 *  A is a briefing (one stat strip, chart beside a call feed), B puts the
 *  Workspaces first as a board, C is a lead inbox with the numbers in a
 *  rail. All three read the same props the real HomeDashboard receives.
 *  Adding `?sample=true` swaps those props for the made-up month in
 *  home-sample.prototype.ts, on every variant including the real Home.
 *
 * @remarks
 *  Throwaway code that answers one question: what should Home look like so
 *  the page reads at a glance. Read-only, no tests, not for merge. Changing
 *  the date range drops the variant param; pick the variant again.
 *
 * @see
 *  components/tracer/home-dashboard.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, type ReactNode } from "react";

import { AnalyticsRangeControls, CallTrendsChart, formatRate, useAnalyticsNavigation } from "@/components/tracer/analytics-panels";
import CallOutcomeBadge from "@/components/tracer/call-outcome-badge";
import { formatClock } from "@/components/tracer/call-format";
import GenerateReportButton, { type GenerateReportScope } from "@/components/tracer/generate-report-dialog";
import HomeDashboard, { type HomeMoney } from "@/components/tracer/home-dashboard";
import { sampleHome } from "@/components/tracer/prototype/home-sample.prototype";
import LeadClassificationBadge from "@/components/tracer/lead-classification-badge";
import type { AnalyticsKpi, AnalyticsSummary } from "@/data/analytics";
import type { AnalyticsRange } from "@/data/analytics-range";
import { callDetailHref } from "@/data/call-source";
import type { CallListItem, CallListResult } from "@/data/calls";
import { formatUsdCents } from "@/data/pricing";

interface HomeProps {
  operator: boolean;
  workspaceCount: number;
  range: AnalyticsRange;
  summary: AnalyticsSummary | null;
  recentCalls: CallListResult | null;
  callsHref: string;
  reportScope: GenerateReportScope;
  money?: HomeMoney | null;
}

const variants = [
  { key: "current", name: "Today's Home" },
  { key: "a", name: "Briefing" },
  { key: "b", name: "Workspace board" },
  { key: "c", name: "Lead inbox" },
] as const;

const count = new Intl.NumberFormat("en-US");
const signed = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0, signDisplay: "exceptZero" });

function rangeLabel(range: AnalyticsRange): string {
  if (range.kind === "days") return `the last ${range.days} days`;
  if (range.kind === "all") return "all time";
  return `${range.from} to ${range.to}`;
}

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

function Delta({ kpi }: { kpi: AnalyticsKpi }) {
  const change = kpi.comparison?.change;
  if (change === null || change === undefined || change === 0) return null;
  const text = kpi.comparison?.unit === "points" ? `${change > 0 ? "+" : ""}${Math.round(change * 100)} pts` : signed.format(change);
  return <span className={`text-xs font-medium tabular-nums ${change > 0 ? "text-success" : "text-destructive"}`}>{text}</span>;
}

function stats(summary: AnalyticsSummary, money: HomeMoney | null | undefined, operator: boolean) {
  const kpis = summary.kpis;
  const list: { label: string; value: string; kpi?: AnalyticsKpi; tone?: string; hint: string }[] = [
    { label: "Calls", value: count.format(kpis.totalCalls.value ?? 0), kpi: kpis.totalCalls, hint: "Calls started in the period" },
    { label: "Answer rate", value: formatRate(kpis.answerRate.value), kpi: kpis.answerRate, hint: "Answered Calls of forwarding attempts" },
    { label: "Good Leads", value: count.format(kpis.goodLeads.value ?? 0), kpi: kpis.goodLeads, hint: "Good Lead Calls and Form Submissions" },
    { label: "Avg duration", value: kpis.averageConnectedSeconds.value === null ? "No calls" : formatClock(kpis.averageConnectedSeconds.value), kpi: kpis.averageConnectedSeconds, hint: "Connected talk time of Answered Calls" },
  ];
  if (operator && money) {
    list.push(
      { label: "Revenue", value: formatUsdCents(money.totals.revenueCents), hint: `Open Deals for ${money.month}` },
      { label: "Profit", value: formatUsdCents(money.totals.profitCents), tone: money.totals.profitCents < 0 ? "text-destructive" : "text-success", hint: `After ${formatUsdCents(money.totals.costCents)} cost this month` },
    );
  }
  return list;
}

function Panel({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`flex flex-col rounded-lg border border-border bg-card ${className}`}>
      {title ? (
        <div className="flex h-11 items-center justify-between border-b border-border px-4">
          <h2 className="text-sm font-medium">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function CallRow({ call, dense = false }: { call: CallListItem; dense?: boolean }) {
  const lead = call.effectiveLeadClassification;
  return (
    <Link
      href={callDetailHref({ id: call.id, workspaceId: call.workspace.id }, "/calls")}
      className={`flex items-center gap-3 px-4 transition-colors hover:bg-muted/60 ${dense ? "py-2.5" : "py-3.5"}`}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium tabular-nums">{call.callerNumber ?? "Unknown caller"}</span>
        <span className="truncate text-xs text-muted-foreground">
          {call.workspace.name} · {ago(call.startedAt)}
          {call.connectedDurationSeconds ? ` · ${formatClock(call.connectedDurationSeconds)}` : ""}
        </span>
      </div>
      {lead ? <LeadClassificationBadge classification={lead.classification} automated={lead.source === "assessment"} /> : null}
      <CallOutcomeBadge outcome={call.outcome} />
    </Link>
  );
}

function ViewAll({ href }: { href: string }) {
  return (
    <Link href={href} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
      View all
    </Link>
  );
}

function Header({ subtitle, range, reportScope }: { subtitle: ReactNode; range: AnalyticsRange; reportScope: GenerateReportScope }) {
  const { pending, changeRange } = useAnalyticsNavigation();
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Home</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <AnalyticsRangeControls range={range} onRangeChange={changeRange} disabled={pending} />
        <GenerateReportButton scope={reportScope} />
      </div>
    </div>
  );
}

/** A: one stat strip, then the chart beside a feed of calls. */
function VariantA({ operator, range, summary, recentCalls, callsHref, reportScope, money }: HomeProps) {
  if (!summary) return null;
  const list = stats(summary, money, operator);
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <Header subtitle={`Every Workspace, ${rangeLabel(range)}.`} range={range} reportScope={reportScope} />
      <div className={`grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 ${list.length > 4 ? "xl:grid-cols-6" : "xl:grid-cols-4"}`}>
        {list.map((item) => (
          <div key={item.label} title={item.hint} className="flex flex-col gap-1.5 bg-card px-4 py-3.5">
            <span className="text-xs text-muted-foreground">{item.label}</span>
            <span className="flex items-baseline gap-2">
              <span className={`text-2xl font-semibold tracking-tight tabular-nums ${item.tone ?? ""}`}>{item.value}</span>
              {item.kpi ? <Delta kpi={item.kpi} /> : null}
            </span>
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Leads generated" className="lg:col-span-2">
          <div className="p-4">
            <CallTrendsChart trend={summary.trend} />
          </div>
        </Panel>
        <Panel title="Recent Calls" action={<ViewAll href={callsHref} />}>
          <div className="flex flex-col divide-y divide-border">
            {(recentCalls?.calls ?? []).slice(0, 6).map((call) => (
              <CallRow key={call.id} call={call} dense />
            ))}
          </div>
        </Panel>
      </div>
      {summary.workspacePerformance ? (
        <Panel title="Workspaces" action={<ViewAll href="/workspaces" />}>
          <div className="flex flex-col divide-y divide-border">
            {summary.workspacePerformance.map((row) => (
              <Link key={row.workspace.id} href={`/workspaces/${row.workspace.id}`} className="grid grid-cols-[minmax(0,1fr)_repeat(3,5.5rem)] items-center gap-4 px-4 py-2.5 text-sm transition-colors hover:bg-muted/60">
                <span className="truncate font-medium">{row.workspace.name}</span>
                <span className="text-right tabular-nums">{row.totalCalls} <span className="text-xs text-muted-foreground">calls</span></span>
                <span className="text-right tabular-nums">{row.goodLeads} <span className="text-xs text-muted-foreground">leads</span></span>
                <span className="text-right text-muted-foreground tabular-nums">{row.answerRate === null ? "No calls" : formatRate(row.answerRate)}</span>
              </Link>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

/** B: the Workspaces are the page; the totals are one sentence. */
function VariantB({ operator, range, summary, recentCalls, callsHref, reportScope, money }: HomeProps) {
  if (!summary) return null;
  const kpis = summary.kpis;
  const rows = [...(summary.workspacePerformance ?? [])].sort((first, second) => second.totalCalls - first.totalCalls);
  const most = Math.max(1, ...rows.map((row) => row.totalCalls));
  const sentence = (
    <>
      <span className="text-foreground">{count.format(kpis.totalCalls.value ?? 0)} Calls</span>, <span className="text-foreground">{formatRate(kpis.answerRate.value)}</span> answered,{" "}
      <span className="text-foreground">{count.format(kpis.goodLeads.value ?? 0)} Good Leads</span> in {rangeLabel(range)}
      {operator && money ? (
        <>
          . Profit this month <span className={money.totals.profitCents < 0 ? "text-destructive" : "text-success"}>{formatUsdCents(money.totals.profitCents)}</span>
        </>
      ) : null}
      .
    </>
  );
  return (
    <div className="flex flex-col gap-6">
      <Header subtitle={sentence} range={range} reportScope={reportScope} />
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {rows.map((row) => {
          const cents = money?.byWorkspace[row.workspace.id];
          return (
            <Link key={row.workspace.id} href={`/workspaces/${row.workspace.id}`} className="group flex flex-col gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/25">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{row.workspace.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{row.trackingNumber ?? "No Tracking Number"}</span>
                </div>
                <span className={`mt-1 size-2 shrink-0 rounded-full ${row.trackingNumber ? "bg-success" : "bg-muted-foreground/40"}`} aria-hidden />
              </div>
              <div className="flex items-end justify-between gap-4">
                <div className="flex flex-col">
                  <span className="text-3xl font-semibold tracking-tight tabular-nums">{row.totalCalls}</span>
                  <span className="text-xs text-muted-foreground">Calls</span>
                </div>
                <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-right text-xs">
                  <dt className="text-muted-foreground">Good Leads</dt>
                  <dd className="tabular-nums">{row.goodLeads}</dd>
                  <dt className="text-muted-foreground">Answered</dt>
                  <dd className="tabular-nums">{row.answerRate === null ? "n/a" : formatRate(row.answerRate)}</dd>
                  {cents ? (
                    <>
                      <dt className="text-muted-foreground">Profit</dt>
                      <dd className="tabular-nums">{formatUsdCents(cents.revenueCents - cents.costCents)}</dd>
                    </>
                  ) : null}
                </dl>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-foreground/70" style={{ width: `${(row.totalCalls / most) * 100}%` }} />
              </div>
            </Link>
          );
        })}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Leads generated">
          <div className="p-4">
            <CallTrendsChart trend={summary.trend} />
          </div>
        </Panel>
        <Panel title="Recent Calls" action={<ViewAll href={callsHref} />}>
          <div className="flex flex-col divide-y divide-border">
            {(recentCalls?.calls ?? []).slice(0, 6).map((call) => (
              <CallRow key={call.id} call={call} />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

/** C: the calls to look at are the page; the numbers sit in a rail. */
function VariantC({ operator, range, summary, recentCalls, callsHref, reportScope, money }: HomeProps) {
  if (!summary) return null;
  const list = stats(summary, money, operator);
  const calls = recentCalls?.calls ?? [];
  const unreviewed = calls.filter((call) => call.effectiveLeadClassification?.source !== "review");
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <Header subtitle={`${unreviewed.length} of the latest ${calls.length} Calls have no Lead Review yet.`} range={range} reportScope={reportScope} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel title="Latest Calls" action={<ViewAll href={callsHref} />}>
          <div className="flex flex-col divide-y divide-border">
            {calls.map((call) => (
              <CallRow key={call.id} call={call} />
            ))}
          </div>
        </Panel>
        <div className="flex flex-col gap-5 lg:sticky lg:top-4">
          <Panel>
            <dl className="flex flex-col divide-y divide-border">
              {list.map((item) => (
                <div key={item.label} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                  <dt className="text-sm text-muted-foreground">{item.label}</dt>
                  <dd className="flex items-baseline gap-2">
                    {item.kpi ? <Delta kpi={item.kpi} /> : null}
                    <span className={`text-sm font-semibold tabular-nums ${item.tone ?? ""}`}>{item.value}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel title="Leads generated">
            <div className="p-3">
              <CallTrendsChart trend={summary.trend} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function PrototypeSwitcher({ current }: { current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const index = Math.max(0, variants.findIndex((item) => item.key === current));

  function go(step: number) {
    const next = variants[(index + step + variants.length) % variants.length];
    const search = new URLSearchParams(params.toString());
    if (next.key === "current") search.delete("variant");
    else search.set("variant", next.key);
    const query = search.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-yellow-300 px-1.5 py-1 text-sm font-medium text-black shadow-lg">
      <button type="button" aria-label="Previous variant" className="size-7 rounded-full hover:bg-black/10" onClick={() => go(-1)}>
        &larr;
      </button>
      <span className="min-w-44 text-center">
        Prototype {index + 1}/{variants.length}: {variants[index].name}
      </span>
      <button type="button" aria-label="Next variant" className="size-7 rounded-full hover:bg-black/10" onClick={() => go(1)}>
        &rarr;
      </button>
    </div>
  );
}

export default function HomePrototype({ variant, ...loaded }: HomeProps & { variant: string }) {
  const sample = useSearchParams().get("sample") === "true";
  const fake = useMemo(() => (sample ? sampleHome() : null), [sample]);
  if (process.env.NODE_ENV === "production") return <HomeDashboard {...loaded} />;
  const props = fake ? { ...loaded, ...fake } : loaded;
  return (
    <>
      {variant === "a" ? <VariantA {...props} /> : variant === "b" ? <VariantB {...props} /> : variant === "c" ? <VariantC {...props} /> : <HomeDashboard {...props} />}
      <PrototypeSwitcher current={variant} />
    </>
  );
}
