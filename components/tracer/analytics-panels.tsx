/**
 * -------------------------------------------------------------------------
 * @file   analytics-panels.tsx
 * @brief  Renders the dashboard date controls, KPI row, and Call trends chart.
 *
 * @description
 *  Home and Workspace Overview share these regions so both read the same
 *  KPI definitions in the same visual order. The date controls offer 7
 *  Days, 30 Days, 90 Days, All Time, and a Custom range of calendar dates,
 *  and write the choice to the URL. The KPI row shows Total Calls, Answer
 *  Rate, Good Leads, and Average Duration, each with its comparison against
 *  the previous period, and Good Leads names how many are Form Submissions: a relative change for counts and durations,
 *  percentage points for Answer Rate, a dash when no change exists, and
 *  nothing for All Time. The chart plots Total Calls, Answered Calls, and
 *  Good Leads per period, with a visible legend, a tooltip naming the
 *  period and each series, and a visually hidden table of every point.
 *
 * @remarks
 *  A range change or a Retry rerenders the server page inside a transition,
 *  so the analytics regions show Skeletons in their final layout while the
 *  rest of the page stays in place. Series use the Tracer chart identities
 *  from DESIGN.md, which sit close in lightness, so each series also has
 *  its own line style and marker, repeated in the legend, and the legend
 *  names every series in text so color is never the only distinction.
 *
 * @see
 *  data/analytics.ts
 *  data/analytics-range.ts
 *  components/ui/chart.tsx
 *  https://reui.io/preview/base/components/c-chart-17
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { format } from "date-fns";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { Frame, FramePanel } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Calendar } from "@/components/ui/calendar";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCallDate, formatClock } from "@/components/tracer/call-format";
import type { AnalyticsComparison, AnalyticsKpi, AnalyticsKpis, AnalyticsTrendPoint } from "@/data/analytics";
import { analyticsPresetDays, analyticsRangeSearchParams, type AnalyticsRange, type AnalyticsTrendInterval } from "@/data/analytics-range";

const series = [
  { key: "totalCalls", label: "Total Calls", color: "var(--chart-3)", dash: undefined, dot: "circle" },
  { key: "answeredCalls", label: "Answered Calls", color: "var(--chart-2)", dash: "6 4", dot: "square" },
  { key: "goodLeads", label: "Good Leads", color: "var(--chart-1)", dash: "2 3", dot: "diamond" },
] as const;

/**
 * Every range button keeps the outline border so the ButtonGroup's shared
 * edges stay continuous; the pressed one is told apart by fill and ink.
 */
const rangeButtonClassName = "text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground";

const chartConfig = Object.fromEntries(series.map((item) => [item.key, { label: item.label, color: item.color }])) satisfies ChartConfig;

const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const signedPercent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });
const signedPoints = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, signDisplay: "exceptZero" });
const count = new Intl.NumberFormat("en-US");
const dayTick = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const monthTick = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", year: "numeric" });
const intervalNames: Record<AnalyticsTrendInterval, string> = { day: "day", week: "week", month: "month" };

export function formatRate(value: number | null): string {
  return value === null ? "-" : percent.format(value);
}

function formatComparison(comparison: AnalyticsComparison): string {
  if (comparison.change === null) return "- vs previous period";
  const change = comparison.unit === "points" ? `${signedPoints.format(comparison.change * 100)} pts` : signedPercent.format(comparison.change);
  return `${change} vs previous period`;
}

function calendarLabel(date: string): string {
  return formatCallDate(`${date}T12:00:00Z`, "UTC");
}

function localDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function useAnalyticsNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  return {
    pending,
    changeRange(range: AnalyticsRange) {
      const search = analyticsRangeSearchParams(range).toString();
      startTransition(() => router.push(`${pathname}${search ? `?${search}` : ""}`, { scroll: false }));
    },
    retry() {
      startTransition(() => router.refresh());
    },
  };
}

function CustomRange({ range, onRangeChange }: { range: AnalyticsRange; onRangeChange: (range: AnalyticsRange) => void }) {
  const custom = range.kind === "custom" ? range : null;
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<{ from?: Date; to?: Date }>(() => (custom ? { from: localDate(custom.from), to: localDate(custom.to) } : {}));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" size="sm" variant="outline" className={rangeButtonClassName} aria-pressed={custom !== null} />}>
        <span className="tabular-nums">{custom ? `${calendarLabel(custom.from)} - ${calendarLabel(custom.to)}` : "Custom"}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto">
        <Calendar
          mode="range"
          className="p-0 [--cell-size:--spacing(7)]"
          selected={{ from: selected.from, to: selected.to }}
          defaultMonth={selected.from}
          disabled={{ after: new Date() }}
          onSelect={(value) => setSelected({ from: value?.from, to: value?.to ?? value?.from })}
        />
        <div className="flex items-center justify-end gap-1.5 border-t pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!selected.from}
            onClick={() => {
              if (!selected.from) return;
              setOpen(false);
              onRangeChange({ kind: "custom", from: format(selected.from, "yyyy-MM-dd"), to: format(selected.to ?? selected.from, "yyyy-MM-dd") });
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AnalyticsRangeControls({ range, onRangeChange, disabled = false }: { range: AnalyticsRange; onRangeChange: (range: AnalyticsRange) => void; disabled?: boolean }) {
  const presets: { label: string; range: AnalyticsRange; current: boolean }[] = [
    ...analyticsPresetDays.map((days) => ({ label: `${days} Days`, range: { kind: "days", days } as const, current: range.kind === "days" && range.days === days })),
    { label: "All Time", range: { kind: "all" }, current: range.kind === "all" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ButtonGroup aria-label="Date range">
        {presets.map((preset) => (
          <Button
            key={preset.label}
            type="button"
            size="sm"
            variant="outline"
            className={rangeButtonClassName}
            aria-pressed={preset.current}
            disabled={disabled}
            onClick={() => onRangeChange(preset.range)}
          >
            {preset.label}
          </Button>
        ))}
        <CustomRange key={range.kind === "custom" ? `${range.from}:${range.to}` : "preset"} range={range} onRangeChange={onRangeChange} />
      </ButtonGroup>
    </div>
  );
}

function KpiTile({ id, label, value, detail, kpi, definition }: { id: string; label: string; value: string; detail?: string; kpi: AnalyticsKpi; definition: string }) {
  return (
    <FramePanel role="group" aria-labelledby={`${id}-label`} className="flex flex-col gap-1">
      <p id={`${id}-label`} className="text-sm text-muted-foreground">{label}</p>
      <p className="font-mono text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {detail ? <p className="text-xs text-muted-foreground tabular-nums">{detail}</p> : null}
      {kpi.comparison ? <p className="text-xs text-muted-foreground tabular-nums">{formatComparison(kpi.comparison)}</p> : null}
      <p className="text-xs text-muted-foreground">{definition}</p>
    </FramePanel>
  );
}

const kpiGrid = "grid gap-2 sm:grid-cols-2 xl:grid-cols-4";

export function AnalyticsKpiRow({ kpis, goodLeadForms = 0 }: { kpis: AnalyticsKpis; goodLeadForms?: number }) {
  return (
    <Frame className={kpiGrid}>
      <KpiTile id="kpi-total-calls" label="Total Calls" value={count.format(kpis.totalCalls.value ?? 0)} kpi={kpis.totalCalls} definition="Calls started in the period" />
      <KpiTile id="kpi-answer-rate" label="Answer Rate" value={formatRate(kpis.answerRate.value)} kpi={kpis.answerRate} definition="Answered Calls of forwarding attempts" />
      <KpiTile
        id="kpi-good-leads"
        label="Good Leads"
        value={count.format(kpis.goodLeads.value ?? 0)}
        detail={goodLeadForms > 0 ? `${count.format(goodLeadForms)} from Forms` : undefined}
        kpi={kpis.goodLeads}
        definition="Good Lead Calls and Form Submissions"
      />
      <KpiTile
        id="kpi-average-duration"
        label="Average Duration"
        value={kpis.averageConnectedSeconds.value === null ? "-" : formatClock(kpis.averageConnectedSeconds.value)}
        kpi={kpis.averageConnectedSeconds}
        definition="Connected talk time of Answered Calls"
      />
    </Frame>
  );
}

export function AnalyticsKpiSkeleton() {
  return (
    <Frame className={kpiGrid} aria-busy="true">
      {["Total Calls", "Answer Rate", "Good Leads", "Average Duration"].map((label) => (
        <FramePanel key={label} className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">{label}</p>
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-4 w-36" />
        </FramePanel>
      ))}
    </Frame>
  );
}

function tickLabel(interval: AnalyticsTrendInterval, start: string): string {
  const date = new Date(`${start}T00:00:00Z`);
  return interval === "month" ? monthTick.format(date) : dayTick.format(date);
}

function LegendSwatch({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg aria-hidden="true" width="20" height="8" viewBox="0 0 20 8" className="shrink-0">
      <line x1="0" y1="4" x2="20" y2="4" stroke={color} strokeWidth="2" strokeDasharray={dash} />
    </svg>
  );
}

function SeriesDot({ cx, cy, color, shape }: { cx?: number; cy?: number; color: string; shape: (typeof series)[number]["dot"] }) {
  if (cx === undefined || cy === undefined) return null;
  if (shape === "square") return <rect x={cx - 3} y={cy - 3} width={6} height={6} fill={color} stroke="var(--card)" strokeWidth={1} />;
  if (shape === "diamond") return <path d={`M${cx},${cy - 4} L${cx + 4},${cy} L${cx},${cy + 4} L${cx - 4},${cy} Z`} fill={color} stroke="var(--card)" strokeWidth={1} />;
  return <circle cx={cx} cy={cy} r={3} fill={color} stroke="var(--card)" strokeWidth={1} />;
}

export function CallTrendsChart({ trend }: { trend: { interval: AnalyticsTrendInterval; points: AnalyticsTrendPoint[] } }) {
  const name = `Call trends by ${intervalNames[trend.interval]}`;
  const showDots = trend.points.length <= 31;
  return (
    <div className="flex flex-col gap-3">
      <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full" aria-hidden="true">
        <LineChart data={trend.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="start" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={(start: string) => tickLabel(trend.interval, start)} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                indicator="line"
                className="min-w-40 tabular-nums"
                labelFormatter={(_, payload) => (payload?.[0]?.payload as AnalyticsTrendPoint | undefined)?.label}
              />
            }
          />
          {series.map((item) => (
            <Line
              key={item.key}
              dataKey={item.key}
              type="monotone"
              stroke={`var(--color-${item.key})`}
              strokeWidth={2}
              strokeDasharray={item.dash}
              dot={showDots ? (props: { cx?: number; cy?: number; index?: number }) => <SeriesDot key={`${item.key}-${props.index}`} cx={props.cx} cy={props.cy} color={`var(--color-${item.key})`} shape={item.dot} /> : false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
      <ul aria-label="Chart legend" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5">
            <LegendSwatch color={item.color} dash={item.dash} />
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
          {trend.points.map((point) => (
            <tr key={point.start}>
              <th scope="row">{point.label}</th>
              {series.map((item) => (
                <td key={item.key}>{point[item.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CallTrendsSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-4 w-64" />
    </div>
  );
}

export function RegionRetry({ message, pending, onRetry }: { message: string; pending: boolean; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center text-sm">
      <p role="alert">{message}</p>
      <Button type="button" variant="outline" disabled={pending} onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

