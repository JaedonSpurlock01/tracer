/**
 * -------------------------------------------------------------------------
 * @file   report-period.test.ts
 * @brief  Verifies how report periods resolve to calendar dates and UTC instants.
 *
 * @description
 *  Checks that Previous Week is the most recently completed Monday through
 *  Sunday and Previous Month the most recently completed calendar month in
 *  the report timezone, that All Time is unbounded, and that a Custom Range
 *  reuses the dashboard custom range bounds. Each bounded period resolves
 *  to inclusive calendar dates and a half-open UTC instant range from local
 *  midnight to local midnight.
 *
 * @remarks
 *  Clocks use non-round instants. America/New_York covers the 2026-03-08
 *  and 2026-11-01 daylight saving changes, and Asia/Tokyo covers a local
 *  date ahead of the UTC date.
 *
 * @see
 *  data/report-period.ts
 *  data/analytics-range.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { resolveReportPeriod } from "@/data/report-period";
import { ReportRequestError } from "@/data/report-request";

describe("Report period", () => {
  it("resolves Previous Week to the last completed Monday through Sunday in the report timezone", () => {
    expect(resolveReportPeriod({ kind: "previousWeek" }, "America/Chicago", new Date("2026-10-14T15:23:47.512Z"))).toEqual({
      window: { from: "2026-10-05", to: "2026-10-11" },
      start: new Date("2026-10-05T05:00:00Z"),
      end: new Date("2026-10-12T05:00:00Z"),
    });
  });

  it("treats the week that ended at the start of a Monday as Previous Week on that Monday", () => {
    expect(resolveReportPeriod({ kind: "previousWeek" }, "America/Chicago", new Date("2026-10-12T05:17:09.004Z"))?.window).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(resolveReportPeriod({ kind: "previousWeek" }, "America/Chicago", new Date("2026-10-12T04:59:59.999Z"))?.window).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  });

  it("resolves Previous Week across daylight saving changes to local midnights", () => {
    expect(resolveReportPeriod({ kind: "previousWeek" }, "America/New_York", new Date("2026-03-11T13:41:05.250Z"))).toEqual({
      window: { from: "2026-03-02", to: "2026-03-08" },
      start: new Date("2026-03-02T05:00:00Z"),
      end: new Date("2026-03-09T04:00:00Z"),
    });
    expect(resolveReportPeriod({ kind: "previousWeek" }, "America/New_York", new Date("2026-11-04T19:07:33.871Z"))).toEqual({
      window: { from: "2026-10-26", to: "2026-11-01" },
      start: new Date("2026-10-26T04:00:00Z"),
      end: new Date("2026-11-02T05:00:00Z"),
    });
  });

  it("resolves Previous Week from the local date when a timezone east of UTC is already on the next day", () => {
    expect(resolveReportPeriod({ kind: "previousWeek" }, "Asia/Tokyo", new Date("2026-10-18T16:31:12.090Z"))).toEqual({
      window: { from: "2026-10-12", to: "2026-10-18" },
      start: new Date("2026-10-11T15:00:00Z"),
      end: new Date("2026-10-18T15:00:00Z"),
    });
  });

  it("resolves Previous Month to the last completed calendar month in the report timezone", () => {
    expect(resolveReportPeriod({ kind: "previousMonth" }, "America/Chicago", new Date("2026-01-14T15:23:47.512Z"))).toEqual({
      window: { from: "2025-12-01", to: "2025-12-31" },
      start: new Date("2025-12-01T06:00:00Z"),
      end: new Date("2026-01-01T06:00:00Z"),
    });
    expect(resolveReportPeriod({ kind: "previousMonth" }, "America/New_York", new Date("2026-04-02T11:12:13.141Z"))).toEqual({
      window: { from: "2026-03-01", to: "2026-03-31" },
      start: new Date("2026-03-01T05:00:00Z"),
      end: new Date("2026-04-01T04:00:00Z"),
    });
    expect(resolveReportPeriod({ kind: "previousMonth" }, "America/New_York", new Date("2026-12-03T22:45:01.618Z"))).toEqual({
      window: { from: "2026-11-01", to: "2026-11-30" },
      start: new Date("2026-11-01T04:00:00Z"),
      end: new Date("2026-12-01T05:00:00Z"),
    });
    expect(resolveReportPeriod({ kind: "previousMonth" }, "Asia/Tokyo", new Date("2026-10-31T15:30:27.182Z"))).toEqual({
      window: { from: "2026-10-01", to: "2026-10-31" },
      start: new Date("2026-09-30T15:00:00Z"),
      end: new Date("2026-10-31T15:00:00Z"),
    });
  });

  it("leaves All Time unbounded", () => {
    expect(resolveReportPeriod({ kind: "all" }, "Asia/Tokyo", new Date("2026-10-18T16:31:12.090Z"))).toBeNull();
  });

  it("resolves a Custom Range from local midnight on its first day to local midnight after its last", () => {
    const now = new Date("2026-10-18T16:31:12.090Z");
    expect(resolveReportPeriod({ kind: "custom", from: "2026-03-08", to: "2026-11-01" }, "America/New_York", now)).toEqual({
      window: { from: "2026-03-08", to: "2026-11-01" },
      start: new Date("2026-03-08T05:00:00Z"),
      end: new Date("2026-11-02T05:00:00Z"),
    });
    expect(resolveReportPeriod({ kind: "custom", from: "2026-10-04", to: "2026-10-04" }, "Australia/Sydney", now)).toEqual({
      window: { from: "2026-10-04", to: "2026-10-04" },
      start: new Date("2026-10-03T14:00:00Z"),
      end: new Date("2026-10-04T13:00:00Z"),
    });
  });

  it("rejects a malformed, reversed, pre-2000, or over-ten-year Custom Range with the dashboard bounds", () => {
    const now = new Date("2026-10-18T16:31:12.090Z");
    for (const [from, to] of [["2026-02-30", "2026-03-04"], ["2026-03-09", "2026-03-04"], ["1999-12-31", "2000-01-05"], ["2000-01-01", "2010-01-08"], ["", "2026-03-04"]]) {
      expect(() => resolveReportPeriod({ kind: "custom", from, to }, "UTC", now)).toThrow(new ReportRequestError("invalid_period"));
    }
    expect(resolveReportPeriod({ kind: "custom", from: "2000-01-01", to: "2010-01-07" }, "UTC", now)?.window).toEqual({ from: "2000-01-01", to: "2010-01-07" });
  });
});
