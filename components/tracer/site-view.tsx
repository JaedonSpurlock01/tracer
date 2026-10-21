/**
 * -------------------------------------------------------------------------
 * @file   site-view.tsx
 * @brief  Renders the Workspace Site page.
 *
 * @description
 *  Shows the Workspace header with the linked Site's primary hostname,
 *  Open Site, and Replace Site for Operators; the hero preview with the
 *  Site Health Badge and its reason, uptime over 30 days with the median
 *  response time, the last uptime check, last deploy, hostnames, and the
 *  Worker name for Operators; the Workspace date
 *  controls; Visits, Page Views, Calls, and Visit-to-Call; the Traffic
 *  and Calls chart; Top pages and Referrers with the device split;
 *  Core Web Vitals graded at the Good thresholds beside the Search panel
 *  with the Search Visibility score, its 30-day sparkline, and the
 *  Keyword table with weight, position, and 7-day change; the Operator-only
 *  Deal and cost panel with the Deal, this month's cost and profit, what
 *  cost includes, Add, Edit, and End Deal, and the Pricing guide link;
 *  and the Operator-only Hosting panel with requests, errors,
 *  certificates, Refresh Preview, and deployments.
 *
 * @remarks
 *  Calls come from the Call analytics summary over the same range, and
 *  the chart joins Visits into the Call trend's periods so daily, weekly,
 *  and monthly intervals follow Leads generated. The preview image is served
 *  by the Workspace-authorized preview route with the capture time as a
 *  cache buster; a missing image reads as Preview pending. States: No
 *  Site, Syncing before the first sync, Preview pending, Cloudflare
 *  disconnected, Down with the last check time, and No rankings yet with
 *  a Keywords link for Operators before the first rank check.
 *
 * @see
 *  data/sites.ts
 *  data/site-search.ts
 *  components/tracer/site-picker.tsx
 *  components/tracer/analytics-panels.tsx
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/reui/badge";
import { Frame, FramePanel } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { AnalyticsRangeControls, RegionRetry, useAnalyticsNavigation } from "@/components/tracer/analytics-panels";
import { formatCallDate, formatCallTime } from "@/components/tracer/call-format";
import { DealActions, describeDeal } from "@/components/tracer/deal-editor";
import { EmptyState } from "@/components/tracer/empty-state";
import { NoWorkspacesArt } from "@/components/tracer/line-art";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import { previewImageSrc, SitePickerDialog, siteHealthBadges, type SitePickerMode, type SiteResponse } from "@/components/tracer/site-picker";
import type { AnalyticsSummary } from "@/data/analytics";
import type { AnalyticsRange, AnalyticsTrendInterval } from "@/data/analytics-range";
import type { WorkspaceCostRevenue } from "@/data/cost-revenue";
import type { DealRecord } from "@/data/deals";
import { formatUsdCents, projectedMonthlyRevenueCents } from "@/data/pricing";
import type { SiteSearch } from "@/data/site-search";
import type { SiteSummary } from "@/data/sites";
import type { WorkspaceRecord } from "@/data/workspaces";

export type SiteViewSite = SiteResponse;

export type SiteViewSummary = Omit<SiteSummary, "requests" | "errors"> & { requests?: number; errors?: number };

export type SiteViewMoney = WorkspaceCostRevenue & { month: string };

interface SiteViewProps {
  workspace: WorkspaceRecord;
  site: SiteViewSite | null | undefined;
  summary: SiteViewSummary | null;
  analytics: AnalyticsSummary | null;
  range: AnalyticsRange;
  search?: SiteSearch | null;
  readOnly?: boolean;
  cloudflareConnected: boolean;
  money?: SiteViewMoney | null;
}

export interface TrafficAndCallsPoint {
  start: string;
  label: string;
  visits: number;
  calls: number | null;
}

const count = new Intl.NumberFormat("en-US");
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const wholePercent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });
const relative = new Intl.RelativeTimeFormat("en-US", { numeric: "always" });
const dayTick = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const monthTick = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", year: "numeric" });
const intervalNames: Record<AnalyticsTrendInterval, string> = { day: "day", week: "week", month: "month" };
const series = [
  { key: "visits", label: "Visits", color: "var(--chart-3)", dash: undefined },
  { key: "calls", label: "Calls", color: "var(--chart-1)", dash: "6 4" },
] as const;
const chartConfig = Object.fromEntries(series.map((item) => [item.key, { label: item.label, color: item.color }])) satisfies ChartConfig;
const searchChartConfig = { score: { label: "Search Visibility", color: "var(--chart-1)" } } satisfies ChartConfig;

function stateVariant(state: WorkspaceRecord["state"]): "primary-light" | "success-light" | "destructive-light" {
  if (state === "Active") return "success-light";
  if (state === "Archived") return "destructive-light";
  return "primary-light";
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  if (Math.abs(minutes) < 1) return "just now";
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

export function trafficAndCallsSeries(daily: SiteViewSummary["daily"], trend: AnalyticsSummary["trend"] | null): TrafficAndCallsPoint[] {
  if (!trend) return daily.map((row) => ({ start: row.day, label: formatCallDate(`${row.day}T12:00:00Z`, "UTC"), visits: row.visits, calls: null }));
  return trend.points.map((point) => ({
    start: point.start,
    label: point.label,
    visits: daily.filter((row) => row.day >= point.start && row.day <= point.end).reduce((total, row) => total + row.visits, 0),
    calls: point.totalCalls,
  }));
}

function tickLabel(interval: AnalyticsTrendInterval, start: string): string {
  const date = new Date(`${start}T00:00:00Z`);
  return interval === "month" ? monthTick.format(date) : dayTick.format(date);
}

function uptimeLabel(uptime: SiteViewSite["uptime30d"]): string {
  if (!uptime || uptime.checks === 0) return "No checks yet";
  const median = uptime.medianResponseMs === null ? "-" : `${count.format(uptime.medianResponseMs)} ms`;
  return `${percent.format(uptime.ratio ?? 0)} · ${median}`;
}

function visitToCall(calls: number | null, visits: number | null): string {
  if (calls === null || visits === null || visits === 0) return "-";
  return percent.format(calls / visits);
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function KpiTile({ id, label, value, definition, accent = false }: { id: string; label: string; value: string; definition: string; accent?: boolean }) {
  return (
    <FramePanel role="group" aria-labelledby={`${id}-label`} className="flex flex-col gap-1">
      <p id={`${id}-label`} className="text-sm text-muted-foreground">{label}</p>
      <p className={`font-mono text-2xl font-semibold tracking-tight tabular-nums${accent ? " text-[var(--chart-1)]" : ""}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{definition}</p>
    </FramePanel>
  );
}

const kpiGrid = "grid gap-2 sm:grid-cols-2 xl:grid-cols-4";
const kpiLabels = ["Visits", "Page Views", "Calls", "Visit-to-Call"];

function SiteKpiSkeleton() {
  return (
    <Frame className={kpiGrid} aria-busy="true">
      {kpiLabels.map((label) => (
        <FramePanel key={label} className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">{label}</p>
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-4 w-36" />
        </FramePanel>
      ))}
    </Frame>
  );
}

function HeroPreview({ workspace, site, operator, cloudflareConnected }: { workspace: WorkspaceRecord; site: SiteViewSite; operator: boolean; cloudflareConnected: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  const zone = workspace.reportingTimezone;
  const [healthLabel, healthVariant] = siteHealthBadges[site.health];
  const preview = site.latestPreview && !imageFailed ? site.latestPreview : null;
  const check = site.latestCheck;
  const url = `https://${site.primaryHostname}`;
  return (
    <Frame>
      <FramePanel role="region" aria-labelledby="site-preview-title" className="flex flex-col gap-4">
        <h2 id="site-preview-title" className="sr-only">Site preview</h2>
        {!cloudflareConnected ? (
          <p role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/25 bg-warning/15 px-3 py-2 text-sm">
            <span>Cloudflare is disconnected. Showing the last synced data.</span>
            {operator ? (
              <Link href="/integrations" prefetch className="underline">
                Integrations
              </Link>
            ) : null}
          </p>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <div className="flex flex-col gap-2">
            {preview ? (
              <a href={url} target="_blank" rel="noreferrer" aria-label={`Open ${site.primaryHostname} in a new tab`} className="group relative block aspect-[16/10] w-full overflow-hidden rounded-md border bg-muted">
                <Image src={previewImageSrc(workspace.id, preview.capturedAt)} alt={`Preview of ${site.primaryHostname}`} fill unoptimized sizes="(min-width: 1024px) 60vw, 100vw" className="object-cover object-top" onError={() => setImageFailed(true)} />
                <span aria-hidden="true" className="absolute bottom-2 right-2 rounded-md border bg-background/90 px-2 py-0.5 text-xs opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  Open
                </span>
              </a>
            ) : (
              <Skeleton className="aspect-[16/10] w-full rounded-md" />
            )}
            <p className="text-xs text-muted-foreground">{preview ? `Preview captured ${relativeTime(preview.capturedAt)}` : "Preview pending"}</p>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label="Site Health">
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant={healthVariant}>{healthLabel}</Badge>
                {site.healthReason ? <span className="text-xs text-muted-foreground">{site.healthReason}</span> : null}
              </span>
            </Fact>
            <Fact label="Uptime, 30 days">
              <span className="font-mono tabular-nums">{uptimeLabel(site.uptime30d)}</span>
            </Fact>
            <Fact label="Last check">
              {check ? (
                <span className="font-mono tabular-nums">
                  {check.ok ? "" : "Failed: "}
                  {check.statusCode ?? "No response"}, {check.responseMs === null ? "-" : `${check.responseMs} ms`}, {formatCallTime(check.checkedAt, zone)}
                </span>
              ) : (
                "No check yet"
              )}
            </Fact>
            <Fact label="Last deploy">
              <span className="font-mono tabular-nums">{site.lastDeployedAt ? formatCallTime(site.lastDeployedAt, zone) : "-"}</span>
            </Fact>
            <Fact label="Hostnames">
              <ul className="flex flex-col font-mono">
                {site.hostnames.map((hostname) => (
                  <li key={hostname.hostname}>{hostname.hostname}</li>
                ))}
              </ul>
            </Fact>
            {operator && site.scriptName ? (
              <Fact label="Worker">
                <span className="font-mono">{site.scriptName}</span>
              </Fact>
            ) : null}
            <Fact label="Site Link since">
              <span className="font-mono tabular-nums">{formatCallDate(site.linkedAt, zone)}</span>
            </Fact>
          </dl>
        </div>
      </FramePanel>
    </Frame>
  );
}

function TrafficAndCallsChart({ points, interval }: { points: TrafficAndCallsPoint[]; interval: AnalyticsTrendInterval }) {
  const name = `Traffic and Calls by ${intervalNames[interval]}`;
  return (
    <div className="flex flex-col gap-3">
      <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full" aria-hidden="true">
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="start" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={(start: string) => tickLabel(interval, start)} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
          <ChartTooltip content={<ChartTooltipContent indicator="line" className="min-w-40 tabular-nums" labelFormatter={(_, payload) => (payload?.[0]?.payload as TrafficAndCallsPoint | undefined)?.label} />} />
          {series.map((item) => (
            <Line key={item.key} dataKey={item.key} type="monotone" stroke={`var(--color-${item.key})`} strokeWidth={2} strokeDasharray={item.dash} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          ))}
        </LineChart>
      </ChartContainer>
      <ul aria-label="Chart legend" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5">
            <svg aria-hidden="true" width="20" height="8" viewBox="0 0 20 8" className="shrink-0">
              <line x1="0" y1="4" x2="20" y2="4" stroke={item.color} strokeWidth="2" strokeDasharray={item.dash} />
            </svg>
            {item.label}
          </li>
        ))}
      </ul>
      <table className="sr-only">
        <caption>{name}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {series.map((item) => (
              <th key={item.key} scope="col">{item.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.start}>
              <th scope="row">{point.label}</th>
              <td>{point.visits}</td>
              <td>{point.calls ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CountedList({ id, title, rows, emptyLabel, footer }: { id: string; title: string; rows: [string, number][]; emptyLabel: (key: string) => string; footer?: ReactNode }) {
  const max = Math.max(1, ...rows.map(([, value]) => value));
  return (
    <FramePanel role="region" aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
      <h2 id={`${id}-title`} className="font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No page views in this range.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {rows.map(([key, value]) => (
            <li key={key} className="relative flex items-center justify-between gap-3 px-2 py-1 text-sm">
              <span aria-hidden="true" className="absolute inset-y-0 left-0 rounded-sm bg-muted" style={{ width: `${(value / max) * 100}%` }} />
              <span className="relative truncate font-mono">{emptyLabel(key)}</span>
              <span className="relative font-mono text-xs text-muted-foreground tabular-nums">{count.format(value)}</span>
            </li>
          ))}
        </ol>
      )}
      {footer}
    </FramePanel>
  );
}

function deviceSplit(devices: [string, number][]): string {
  const total = devices.reduce((sum, [, value]) => sum + value, 0);
  if (total === 0) return "No device data";
  return devices.map(([device, value]) => `${device} ${wholePercent.format(value / total)}`).join(", ");
}

function Vital({ id, label, value, good, unit }: { id: string; label: string; value: number | null; good: boolean; unit: (value: number) => string }) {
  return (
    <div role="group" aria-labelledby={`${id}-label`} className="flex flex-col gap-1">
      <p id={`${id}-label`} className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-xl font-semibold tabular-nums">{value === null ? "-" : unit(value)}</p>
      {value === null ? <p className="text-xs text-muted-foreground">No samples</p> : <span><Badge variant={good ? "success-light" : "warning-light"}>{good ? "Good" : "Needs work"}</Badge></span>}
    </div>
  );
}

function Performance({ vitals }: { vitals: SiteViewSummary["vitals"] }) {
  return (
    <FramePanel role="region" aria-labelledby="performance-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id="performance-title" className="font-semibold">Performance</h2>
        <p className="text-xs text-muted-foreground">Core Web Vitals at the 75th percentile</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Vital id="vital-lcp" label="Largest Contentful Paint" value={vitals.lcpMs} good={(vitals.lcpMs ?? 0) <= 2500} unit={(value) => `${(value / 1000).toFixed(1)} s`} />
        <Vital id="vital-inp" label="Interaction to Next Paint" value={vitals.inpMs} good={(vitals.inpMs ?? 0) <= 200} unit={(value) => `${count.format(value)} ms`} />
        <Vital id="vital-cls" label="Cumulative Layout Shift" value={vitals.cls} good={(vitals.cls ?? 0) <= 0.1} unit={(value) => value.toFixed(2)} />
      </div>
    </FramePanel>
  );
}

function changeLabel(change: number | null): string {
  if (change === null) return "-";
  return change > 0 ? `+${change}` : String(change);
}

function SearchPanel({ workspace, search, operator, pending, onRetry }: { workspace: WorkspaceRecord; search: SiteSearch | null; operator: boolean; pending: boolean; onRetry: () => void }) {
  const zone = workspace.reportingTimezone;
  return (
    <FramePanel role="region" aria-labelledby="search-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id="search-title" className="font-semibold">Search</h2>
        <p className="text-xs text-muted-foreground">
          {search?.serviceArea.city ? `Search Visibility from ${[search.serviceArea.city, search.serviceArea.region, search.serviceArea.country].filter(Boolean).join(", ")}` : "Search Visibility"}
          {search?.checkedAt ? ` · Checked ${formatCallDate(search.checkedAt, zone)}` : ""}
        </p>
      </div>
      {search === null ? (
        <RegionRetry message="Search rankings are unavailable." pending={pending} onRetry={onRetry} />
      ) : search.checkedAt === null ? (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-muted-foreground">No rankings yet</p>
          {operator ? (
            <p>
              {search.keywords.length === 0 ? "Add " : "The daily check runs at 06:41 UTC. Edit "}
              <Link className="underline" href={`/workspaces/${workspace.id}/settings/site`} prefetch>
                Keywords
              </Link>
              {search.serviceArea.city ? "." : " and set the Service Area in Site settings."}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-end">
            <p className="font-mono text-2xl font-semibold tracking-tight tabular-nums">
              <span>{search.score ?? "-"}</span>
              <span className="text-base font-normal text-muted-foreground">/100</span>
            </p>
            <ChartContainer config={searchChartConfig} className="aspect-auto h-12 w-full" aria-hidden="true">
              <LineChart data={search.trend} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                <YAxis domain={[0, 100]} hide />
                <ChartTooltip content={<ChartTooltipContent indicator="line" className="min-w-32 tabular-nums" labelFormatter={(_, payload) => formatCallDate(`${(payload?.[0]?.payload as { day: string } | undefined)?.day}T12:00:00Z`, "UTC")} />} />
                <Line dataKey="score" type="monotone" stroke="var(--color-score)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ChartContainer>
          </div>
          <table className="sr-only">
            <caption>Search Visibility by day</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Search Visibility</th>
              </tr>
            </thead>
            <tbody>
              {search.trend.map((point) => (
                <tr key={point.day}>
                  <th scope="row">{formatCallDate(`${point.day}T12:00:00Z`, "UTC")}</th>
                  <td>{point.score ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="overflow-x-auto">
            <table aria-label="Keywords" className="w-full text-sm">
              <caption className="sr-only">Keywords</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1 pr-2 font-medium">Keyword</th>
                  <th scope="col" className="px-2 py-1 font-medium">Weight</th>
                  <th scope="col" className="px-2 py-1 font-medium">Position</th>
                  <th scope="col" className="py-1 pl-2 font-medium">7d change</th>
                </tr>
              </thead>
              <tbody>
                {search.keywords.map((keyword) => (
                  <tr key={keyword.id} className="border-b">
                    <td className="py-1.5 pr-2">
                      {keyword.rankingUrl ? <a className="hover:underline" href={keyword.rankingUrl} target="_blank" rel="noreferrer">{keyword.phrase}</a> : keyword.phrase}
                    </td>
                    <td className="px-2 py-1.5 font-mono tabular-nums">{keyword.weight}</td>
                    <td className="px-2 py-1.5 font-mono tabular-nums">{keyword.position === null ? <span className="font-sans text-muted-foreground">{keyword.checkedAt ? "Not ranking" : "-"}</span> : keyword.position}</td>
                    <td className="py-1.5 pl-2 font-mono tabular-nums">
                      {keyword.change7d === null ? (
                        <span className="text-muted-foreground">-</span>
                      ) : keyword.change7d === 0 ? (
                        <span className="text-muted-foreground">0</span>
                      ) : (
                        <Badge variant={keyword.change7d > 0 ? "success-light" : "destructive-light"}>{changeLabel(keyword.change7d)}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </FramePanel>
  );
}

export function profitClass(profitCents: number): string {
  return profitCents < 0 ? "text-destructive" : "text-success";
}

function DealAndCost({ workspace, money, pending, onRetry }: { workspace: WorkspaceRecord; money: SiteViewMoney | null; pending: boolean; onRetry: () => void }) {
  const [deal, setDeal] = useState<DealRecord | null>(money?.deal ?? null);
  const revenueCents = money ? projectedMonthlyRevenueCents(deal, money.goodLeads) : 0;
  const profitCents = money ? revenueCents - money.costCents : 0;
  return (
    <Frame>
      <FramePanel role="region" aria-labelledby="deal-cost-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="deal-cost-title" className="font-semibold">Deal and cost</h2>
          {money ? <DealActions workspaceId={workspace.id} deal={deal} onChange={setDeal} /> : null}
        </div>
        {money === null ? (
          <RegionRetry message="Cost and revenue are unavailable." pending={pending} onRetry={onRetry} />
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-3">
              <Fact label="Deal">{describeDeal(deal)}</Fact>
              <Fact label="Cost">
                <span className="font-mono text-xl font-semibold tabular-nums">{formatUsdCents(money.costCents)}</span>
                <span className="text-xs text-muted-foreground"> per month</span>
              </Fact>
              <Fact label="Profit">
                <span className={`font-mono text-xl font-semibold tabular-nums ${profitClass(profitCents)}`}>{formatUsdCents(profitCents)}</span>
                <span className="text-xs text-muted-foreground"> per month, on {formatUsdCents(revenueCents)} revenue</span>
              </Fact>
            </dl>
            <p className="text-xs text-muted-foreground">
              Cost includes Telephony {formatUsdCents(money.telephonyCents)}, Processing {formatUsdCents(money.processingCents)}, Hosting {formatUsdCents(money.hostingCents)}, Search {formatUsdCents(money.searchCents)}, and Domain {formatUsdCents(money.domainCents)} for {money.month}
              {money.costPerGoodLeadCents === null ? "." : `, at ${formatUsdCents(money.costPerGoodLeadCents)} per Good Lead.`}
              {" "}Rates are in the{" "}
              <Link className="underline" href="/pricing" prefetch>
                Pricing guide
              </Link>
              .
            </p>
          </>
        )}
      </FramePanel>
    </Frame>
  );
}

function Hosting({ workspace, site, summary }: { workspace: WorkspaceRecord; site: SiteViewSite; summary: SiteViewSummary | null }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const certificates = site.hostnames.filter((hostname) => hostname.certificateId).length;
  const deployments = site.deployments ?? [];

  async function refreshPreview() {
    setBusy(true);
    setStatus("");
    setError("");
    const response = await mutationFetch(`/api/workspaces/${workspace.id}/site/preview/refresh`, { method: "POST" }).catch(() => null);
    if (response?.ok) setStatus("Preview refresh requested.");
    else setError("The preview could not be refreshed.");
    setBusy(false);
  }

  return (
    <Frame>
      <FramePanel role="region" aria-labelledby="hosting-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="hosting-title" className="font-semibold">Hosting</h2>
          <div className="flex items-center gap-2">
            {status ? <p role="status" className="text-xs text-muted-foreground">{status}</p> : null}
            {error ? <p role="alert" className="text-xs">{error}</p> : null}
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void refreshPreview()}>
              Refresh Preview
            </Button>
          </div>
        </div>
        <dl className="grid gap-3 sm:grid-cols-3">
          <Fact label="Worker requests">
            <span className="font-mono tabular-nums">{summary?.requests === undefined ? "-" : count.format(summary.requests)}</span>
          </Fact>
          <Fact label="Worker errors">
            <span className="font-mono tabular-nums">{summary?.errors === undefined ? "-" : count.format(summary.errors)}</span>
          </Fact>
          <Fact label="Hostname certificates">
            <Badge variant={certificates === site.hostnames.length ? "success-light" : "warning-light"}>{certificates} certificates</Badge>
          </Fact>
        </dl>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Deployments</h3>
          {deployments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deployments recorded.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {deployments.map((deployment) => (
                <li key={deployment.versionId} className="grid grid-cols-[6rem_1fr_auto] items-center gap-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="font-mono tabular-nums">{deployment.versionId.slice(0, 8)}</span>
                    {deployment.versionId === site.liveVersionId ? <Badge variant="success-light">Live</Badge> : null}
                  </span>
                  <span className="text-muted-foreground">{deployment.source}</span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">{formatCallTime(deployment.deployedAt, workspace.reportingTimezone)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </FramePanel>
    </Frame>
  );
}

export default function SiteView({ workspace, site, summary, analytics, range, search, readOnly = false, cloudflareConnected, money }: SiteViewProps) {
  const { pending, changeRange, retry } = useAnalyticsNavigation();
  const [picker, setPicker] = useState<SitePickerMode | null>(null);
  const operator = !readOnly;
  const syncing = site ? site.lastSyncedAt === null : false;
  const calls = analytics?.kpis.totalCalls.value ?? null;
  const interval = analytics?.trend.interval ?? "day";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <Badge variant={stateVariant(workspace.state)}>{workspace.state}</Badge>
            <span className="font-mono tabular-nums">Tracking {workspace.trackingNumber ?? "-"}</span>
            {site ? <span className="font-mono text-foreground">{site.primaryHostname}</span> : null}
            <span>{workspace.reportingTimezone}</span>
          </div>
        </div>
        {site ? (
          <div className="flex flex-wrap gap-2">
            {operator ? (
              <Button type="button" variant="outline" onClick={() => setPicker("replace")}>
                Replace Site
              </Button>
            ) : null}
            <Button render={<a href={`https://${site.primaryHostname}`} target="_blank" rel="noreferrer" />}>Open Site</Button>
          </div>
        ) : null}
      </div>
      {site === undefined ? (
        <Frame>
          <FramePanel>
            <RegionRetry message="The Site is unavailable." pending={pending} onRetry={retry} />
          </FramePanel>
        </Frame>
      ) : site === null ? (
        <Frame>
          <FramePanel>
            <EmptyState
              art={<NoWorkspacesArt />}
              title="No Site is linked to this Workspace"
              description={operator ? "Link one of the connected Cloudflare account's Sites to see its preview, traffic, performance, and health here." : undefined}
              action={
                operator ? (
                  <Button type="button" onClick={() => setPicker("link")}>
                    Link Site
                  </Button>
                ) : null
              }
            />
          </FramePanel>
        </Frame>
      ) : (
        <>
          <HeroPreview workspace={workspace} site={site} operator={operator} cloudflareConnected={cloudflareConnected} />
          <AnalyticsRangeControls range={range} onRangeChange={changeRange} disabled={pending} />
          {syncing ? (
            <>
              <p className="text-sm text-muted-foreground">First sync in progress</p>
              <SiteKpiSkeleton />
              <Frame>
                <FramePanel className="flex flex-col gap-3" aria-busy="true">
                  <h2 className="font-semibold">Traffic and Calls</h2>
                  <Skeleton className="h-64 w-full" />
                </FramePanel>
              </Frame>
            </>
          ) : !summary ? (
            <Frame>
              <FramePanel>
                <RegionRetry message="Site traffic is unavailable." pending={pending} onRetry={retry} />
              </FramePanel>
            </Frame>
          ) : (
            <>
              <Frame className={kpiGrid}>
                <KpiTile id="kpi-visits" label="Visits" value={count.format(summary.visits)} definition="Sessions on the Site" />
                <KpiTile id="kpi-page-views" label="Page Views" value={count.format(summary.pageViews)} definition="Pages loaded on the Site" />
                <KpiTile id="kpi-calls" label="Calls" value={calls === null ? "-" : count.format(calls)} definition="Calls to the Tracking Number" />
                <KpiTile id="kpi-visit-to-call" label="Visit-to-Call" value={visitToCall(calls, summary.visits)} definition="Calls divided by Visits" accent />
              </Frame>
              <Frame>
                <FramePanel role="region" aria-labelledby="traffic-calls-title" className="flex flex-col gap-3">
                  <div className="flex flex-col gap-0.5">
                    <h2 id="traffic-calls-title" className="font-semibold">Traffic and Calls</h2>
                    <p className="text-xs text-muted-foreground">Times in {workspace.reportingTimezone}</p>
                  </div>
                  <TrafficAndCallsChart points={trafficAndCallsSeries(summary.daily, analytics?.trend ?? null)} interval={interval} />
                </FramePanel>
              </Frame>
              <Frame className="grid gap-2 lg:grid-cols-2">
                <CountedList id="top-pages" title="Top pages" rows={summary.topPaths} emptyLabel={(key) => key || "/"} />
                <CountedList
                  id="referrers"
                  title="Referrers"
                  rows={summary.referrers}
                  emptyLabel={(key) => key || "(direct)"}
                  footer={<p className="text-xs text-muted-foreground">{deviceSplit(summary.devices)}</p>}
                />
              </Frame>
              <Frame className={search === undefined ? undefined : "grid gap-2 lg:grid-cols-2"}>
                <Performance vitals={summary.vitals} />
                {search === undefined ? null : <SearchPanel workspace={workspace} search={search} operator={operator} pending={pending} onRetry={retry} />}
              </Frame>
            </>
          )}
          {operator && money !== undefined ? <DealAndCost workspace={workspace} money={money} pending={pending} onRetry={retry} /> : null}
          {operator ? <Hosting workspace={workspace} site={site} summary={summary} /> : null}
        </>
      )}
      {operator ? (
        <SitePickerDialog
          open={picker !== null}
          onOpenChange={(open) => setPicker(open ? (picker ?? "link") : null)}
          workspaceId={workspace.id}
          mode={picker ?? "link"}
          timeZone={workspace.reportingTimezone}
          onLinked={retry}
        />
      ) : null}
    </div>
  );
}
