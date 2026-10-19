/**
 * -------------------------------------------------------------------------
 * @file   analytics-range.ts
 * @brief  Parses the dashboard date range and derives its windows and trend buckets.
 *
 * @description
 *  Home and Workspace Overview offer 7 Days, 30 Days, 90 Days, All Time,
 *  and a custom range of calendar dates. A preset covers whole calendar
 *  days ending today, today included, in the scope timezone: the user's for
 *  all readable Workspaces and the Workspace reporting timezone for one
 *  Workspace. Each windowed range compares with the immediately preceding
 *  window of equal length; All Time has none. Trend points are daily for 7
 *  and 30 Days, weekly Monday through Sunday for 90 Days, and monthly for
 *  All Time; a custom range is daily up to 31 days, weekly up to 180 days,
 *  and monthly beyond. Buckets are clipped to the window and carry a label.
 *
 * @remarks
 *  The range lives in the URL as `range=7d|30d|90d|all`, or as the `from`
 *  and `to` calendar dates the Calls Started filter also reads, so View
 *  Calls can carry it over unchanged as the Calls Started filter. 30 Days is the default and is written
 *  as no params. Anything malformed falls back to the default. Calendar
 *  dates carry no timezone and date math runs in UTC, so a daylight saving
 *  change can never add or drop a day. This module has no server imports
 *  so the dashboard views can share it.
 *
 * @see
 *  data/analytics.ts
 *  data/call-list-query.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { calendarDate, callListSearchParams, defaultCallSort, emptyCallFilters } from "@/data/call-list-query";

export const analyticsPresetDays = [7, 30, 90] as const;

export type AnalyticsRange =
  | { kind: "days"; days: (typeof analyticsPresetDays)[number] }
  | { kind: "all" }
  | { kind: "custom"; from: string; to: string };

export interface AnalyticsWindow {
  from: string;
  to: string;
}

export type AnalyticsTrendInterval = "day" | "week" | "month";

export interface AnalyticsTrendBucket {
  start: string;
  end: string;
  label: string;
}

export const defaultAnalyticsRange: AnalyticsRange = { kind: "days", days: 30 };

type SearchParams = URLSearchParams | Readonly<Record<string, string | string[] | undefined>>;

function read(params: SearchParams, name: string): string {
  if (params instanceof URLSearchParams) return params.get(name) ?? "";
  const value = params[name];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const dayMs = 86_400_000;

function toTime(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function fromTime(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function addCalendarDays(date: string, days: number): string {
  return fromTime(toTime(date) + days * dayMs);
}

function windowDays(window: AnalyticsWindow): number {
  return Math.round((toTime(window.to) - toTime(window.from)) / dayMs) + 1;
}

// Bounds keep the prior window and trend buckets small and well formed.
const earliestCustomDate = "2000-01-01";
const maxCustomDays = 3660;

export function analyticsRangeFromSearchParams(params: SearchParams): AnalyticsRange {
  const from = calendarDate(read(params, "from"));
  const to = calendarDate(read(params, "to"));
  if (from && to && from <= to && from >= earliestCustomDate && windowDays({ from, to }) <= maxCustomDays) return { kind: "custom", from, to };
  if (from || to) return defaultAnalyticsRange;
  const range = read(params, "range");
  if (range === "all") return { kind: "all" };
  const days = analyticsPresetDays.find((preset) => range === `${preset}d`);
  return days ? { kind: "days", days } : defaultAnalyticsRange;
}

export function analyticsRangeSearchParams(range: AnalyticsRange): URLSearchParams {
  const params = new URLSearchParams();
  if (range.kind === "custom") {
    params.set("from", range.from);
    params.set("to", range.to);
  } else if (range.kind === "all") params.set("range", "all");
  else if (range.days !== 30) params.set("range", `${range.days}d`);
  return params;
}

export function calendarDateInTimeZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function analyticsWindow(range: AnalyticsRange, today: string): AnalyticsWindow | null {
  if (range.kind === "all") return null;
  if (range.kind === "custom") return { from: range.from, to: range.to };
  return { from: addCalendarDays(today, 1 - range.days), to: today };
}

export function analyticsCallsHref(path: string, range: AnalyticsRange, today: string): string {
  const window = analyticsWindow(range, today);
  const search = callListSearchParams({ page: 1, sort: defaultCallSort, filters: { ...emptyCallFilters, startedFrom: window?.from ?? null, startedTo: window?.to ?? null } }).toString();
  return `${path}${search ? `?${search}` : ""}`;
}

export function previousAnalyticsWindow(window: AnalyticsWindow | null): AnalyticsWindow | null {
  if (!window) return null;
  const length = windowDays(window);
  return { from: addCalendarDays(window.from, -length), to: addCalendarDays(window.from, -1) };
}

export function analyticsTrendInterval(range: AnalyticsRange): AnalyticsTrendInterval {
  if (range.kind === "all") return "month";
  const days = range.kind === "days" ? range.days : windowDays(range);
  return days <= 31 ? "day" : days <= 180 ? "week" : "month";
}

export function analyticsBucketStart(interval: AnalyticsTrendInterval, date: string): string {
  if (interval === "day") return date;
  if (interval === "month") return `${date.slice(0, 7)}-01`;
  const weekday = new Date(toTime(date)).getUTCDay();
  return addCalendarDays(date, -((weekday + 6) % 7));
}

function nextBucketStart(interval: AnalyticsTrendInterval, start: string): string {
  if (interval === "day") return addCalendarDays(start, 1);
  if (interval === "week") return addCalendarDays(start, 7);
  const date = new Date(toTime(start));
  return fromTime(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

const dayLabel = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const monthLabel = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });

function bucketLabel(interval: AnalyticsTrendInterval, start: string): string {
  const date = new Date(toTime(start));
  if (interval === "month") return monthLabel.format(date);
  return interval === "week" ? `Week of ${dayLabel.format(date)}` : dayLabel.format(date);
}

export function analyticsTrendBuckets(interval: AnalyticsTrendInterval, window: AnalyticsWindow): AnalyticsTrendBucket[] {
  const buckets: AnalyticsTrendBucket[] = [];
  for (let start = analyticsBucketStart(interval, window.from); start <= window.to; start = nextBucketStart(interval, start)) {
    const end = addCalendarDays(nextBucketStart(interval, start), -1);
    buckets.push({ start: start < window.from ? window.from : start, end: end > window.to ? window.to : end, label: bucketLabel(interval, start) });
  }
  return buckets;
}
