/**
 * -------------------------------------------------------------------------
 * @file   report-period.ts
 * @brief  Resolves a report period to calendar dates and a UTC instant range.
 *
 * @description
 *  Reports offer Previous Week, Previous Month, All Time, and a Custom
 *  Range. Previous Week is the most recently completed Monday through
 *  Sunday and Previous Month the most recently completed calendar month,
 *  both in the report timezone relative to now. A bounded period resolves
 *  to its inclusive calendar dates and to the half-open UTC instant range
 *  from local midnight on the first day to local midnight after the last.
 *
 * @remarks
 *  Calendar date math reuses the dashboard range module, so a daylight
 *  saving change moves only the instants, never the days covered.
 *
 * @see
 *  data/analytics-range.ts
 *  data/report-request.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import {
  addCalendarDays,
  analyticsBucketStart,
  calendarDateInTimeZone,
  customAnalyticsWindow,
  startOfCalendarDateInTimeZone,
  type AnalyticsWindow,
} from "@/data/analytics-range";
import { ReportRequestError } from "@/data/report-request";

export type ReportPeriod = { kind: "previousWeek" } | { kind: "previousMonth" } | { kind: "all" } | { kind: "custom"; from: string; to: string };

export interface ReportInterval {
  window: AnalyticsWindow;
  start: Date;
  end: Date;
}

function periodWindow(period: Exclude<ReportPeriod, { kind: "all" }>, today: string): AnalyticsWindow {
  if (period.kind === "custom") {
    const window = customAnalyticsWindow(period.from, period.to);
    if (!window) throw new ReportRequestError("invalid_period");
    return window;
  }
  if (period.kind === "previousWeek") {
    const weekStart = analyticsBucketStart("week", today);
    return { from: addCalendarDays(weekStart, -7), to: addCalendarDays(weekStart, -1) };
  }
  const lastDay = addCalendarDays(analyticsBucketStart("month", today), -1);
  return { from: analyticsBucketStart("month", lastDay), to: lastDay };
}

export function resolveReportPeriod(period: ReportPeriod, timeZone: string, now: Date): ReportInterval | null {
  if (period.kind === "all") return null;
  const window = periodWindow(period, calendarDateInTimeZone(now, timeZone));
  return {
    window,
    start: startOfCalendarDateInTimeZone(window.from, timeZone),
    end: startOfCalendarDateInTimeZone(addCalendarDays(window.to, 1), timeZone),
  };
}
