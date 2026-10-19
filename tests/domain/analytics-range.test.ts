/**
 * -------------------------------------------------------------------------
 * @file   analytics-range.test.ts
 * @brief  Verifies the dashboard date range, its prior window, and its trend buckets.
 *
 * @description
 *  Checks that the 7, 30, and 90 Days, All Time, and custom ranges read from
 *  and write back to URL search params, that malformed or reversed custom
 *  dates fall back to the 30 Days default, that a range resolves to whole
 *  calendar days ending today in the scope timezone, that each comparison
 *  window is the immediately preceding window of equal length with none for
 *  All Time, and that trend buckets are daily, weekly Monday through Sunday,
 *  or monthly as the range requires, clipped to the window and labeled.
 *  View Calls carries a windowed range as the Calls Started filter.
 *
 * @remarks
 *  Calendar dates carry no timezone; the scope timezone only decides which
 *  calendar day an instant falls on.
 *
 * @see
 *  data/analytics-range.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import {
  analyticsCallsHref,
  analyticsRangeFromSearchParams,
  analyticsRangeSearchParams,
  analyticsTrendBuckets,
  analyticsTrendInterval,
  analyticsWindow,
  calendarDateInTimeZone,
  defaultAnalyticsRange,
  previousAnalyticsWindow,
} from "@/data/analytics-range";

describe("Analytics range", () => {
  it("reads presets, All Time, and custom dates from the URL and writes them back", () => {
    expect(analyticsRangeFromSearchParams(new URLSearchParams("range=7d"))).toEqual({ kind: "days", days: 7 });
    expect(analyticsRangeFromSearchParams(new URLSearchParams("range=90d"))).toEqual({ kind: "days", days: 90 });
    expect(analyticsRangeFromSearchParams({ range: "all" })).toEqual({ kind: "all" });
    expect(analyticsRangeFromSearchParams(new URLSearchParams("from=2026-09-03&to=2026-10-11"))).toEqual({ kind: "custom", from: "2026-09-03", to: "2026-10-11" });
    expect(analyticsRangeFromSearchParams(new URLSearchParams())).toEqual(defaultAnalyticsRange);
    expect(defaultAnalyticsRange).toEqual({ kind: "days", days: 30 });

    expect(analyticsRangeSearchParams({ kind: "days", days: 7 }).toString()).toBe("range=7d");
    expect(analyticsRangeSearchParams({ kind: "all" }).toString()).toBe("range=all");
    expect(analyticsRangeSearchParams({ kind: "custom", from: "2026-09-03", to: "2026-10-11" }).toString()).toBe("from=2026-09-03&to=2026-10-11");
    expect(analyticsRangeSearchParams(defaultAnalyticsRange).toString()).toBe("");
  });

  it("falls back to 30 Days for unknown presets and malformed, partial, reversed, pre-2000, or over-ten-year custom dates", () => {
    for (const query of ["range=14d", "from=2026-02-30&to=2026-03-04", "from=2026-03-01", "from=2026-03-09&to=2026-03-04", "to=2026-03-04", "from=0001-01-01&to=2026-10-18", "from=1999-12-31&to=2000-01-05", "from=2026-01-01&to=9999-12-31"]) {
      expect(analyticsRangeFromSearchParams(new URLSearchParams(query))).toEqual(defaultAnalyticsRange);
    }
  });

  it("resolves today in the scope timezone across midnight", () => {
    const instant = new Date("2026-10-13T04:30:00Z");
    expect(calendarDateInTimeZone(instant, "America/Chicago")).toBe("2026-10-12");
    expect(calendarDateInTimeZone(instant, "UTC")).toBe("2026-10-13");
    expect(calendarDateInTimeZone(new Date("2026-11-01T06:30:00Z"), "America/Chicago")).toBe("2026-11-01");
  });

  it("resolves whole calendar days ending today and an equal prior window", () => {
    const seven = analyticsWindow({ kind: "days", days: 7 }, "2026-10-18");
    expect(seven).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(previousAnalyticsWindow(seven)).toEqual({ from: "2026-10-05", to: "2026-10-11" });

    const ninety = analyticsWindow({ kind: "days", days: 90 }, "2026-03-01");
    expect(ninety).toEqual({ from: "2025-12-02", to: "2026-03-01" });
    expect(previousAnalyticsWindow(ninety)).toEqual({ from: "2025-09-03", to: "2025-12-01" });

    const custom = analyticsWindow({ kind: "custom", from: "2026-02-27", to: "2026-03-02" }, "2026-10-18");
    expect(custom).toEqual({ from: "2026-02-27", to: "2026-03-02" });
    expect(previousAnalyticsWindow(custom)).toEqual({ from: "2026-02-23", to: "2026-02-26" });

    expect(analyticsWindow({ kind: "all" }, "2026-10-18")).toBeNull();
    expect(previousAnalyticsWindow(null)).toBeNull();
  });

  it("chooses daily, weekly, or monthly points by range", () => {
    expect(analyticsTrendInterval({ kind: "days", days: 7 })).toBe("day");
    expect(analyticsTrendInterval({ kind: "days", days: 30 })).toBe("day");
    expect(analyticsTrendInterval({ kind: "days", days: 90 })).toBe("week");
    expect(analyticsTrendInterval({ kind: "all" })).toBe("month");
    expect(analyticsTrendInterval({ kind: "custom", from: "2026-01-01", to: "2026-01-31" })).toBe("day");
    expect(analyticsTrendInterval({ kind: "custom", from: "2026-01-01", to: "2026-02-01" })).toBe("week");
    expect(analyticsTrendInterval({ kind: "custom", from: "2026-01-01", to: "2026-06-29" })).toBe("week");
    expect(analyticsTrendInterval({ kind: "custom", from: "2026-01-01", to: "2026-06-30" })).toBe("month");
  });

  it("builds one bucket for every calendar day of a daily window", () => {
    const buckets = analyticsTrendBuckets("day", { from: "2026-10-30", to: "2026-11-02" });
    expect(buckets).toEqual([
      { start: "2026-10-30", end: "2026-10-30", label: "Oct 30, 2026" },
      { start: "2026-10-31", end: "2026-10-31", label: "Oct 31, 2026" },
      { start: "2026-11-01", end: "2026-11-01", label: "Nov 1, 2026" },
      { start: "2026-11-02", end: "2026-11-02", label: "Nov 2, 2026" },
    ]);
  });

  it("builds Monday through Sunday weeks clipped to the window", () => {
    const buckets = analyticsTrendBuckets("week", { from: "2026-10-01", to: "2026-10-20" });
    expect(buckets).toEqual([
      { start: "2026-10-01", end: "2026-10-04", label: "Week of Sep 28, 2026" },
      { start: "2026-10-05", end: "2026-10-11", label: "Week of Oct 5, 2026" },
      { start: "2026-10-12", end: "2026-10-18", label: "Week of Oct 12, 2026" },
      { start: "2026-10-19", end: "2026-10-20", label: "Week of Oct 19, 2026" },
    ]);
  });

  it("builds calendar months clipped to the window", () => {
    const buckets = analyticsTrendBuckets("month", { from: "2025-12-17", to: "2026-02-09" });
    expect(buckets).toEqual([
      { start: "2025-12-17", end: "2025-12-31", label: "December 2025" },
      { start: "2026-01-01", end: "2026-01-31", label: "January 2026" },
      { start: "2026-02-01", end: "2026-02-09", label: "February 2026" },
    ]);
  });

  it("carries a windowed range to View Calls as the Started filter and All Time as no filter", () => {
    expect(analyticsCallsHref("/calls", { kind: "days", days: 7 }, "2026-10-18")).toBe("/calls?from=2026-10-12&to=2026-10-18");
    expect(analyticsCallsHref("/workspaces/north/calls", { kind: "custom", from: "2026-09-01", to: "2026-09-30" }, "2026-10-18")).toBe("/workspaces/north/calls?from=2026-09-01&to=2026-09-30");
    expect(analyticsCallsHref("/calls", { kind: "all" }, "2026-10-18")).toBe("/calls");
  });
});
