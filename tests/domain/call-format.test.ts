/**
 * -------------------------------------------------------------------------
 * @file   call-format.test.ts
 * @brief  Tests the short timestamp every list and feed shows.
 *
 * @description
 *  Covers formatShortTime: a moment on the current day in the reporting
 *  timezone reads as a time of day, an earlier day in the same year as a
 *  short date, and an earlier year as a date with its year.
 *
 * @remarks
 *  "Today" is decided in the reporting timezone, not in UTC or the
 *  browser's zone, so a late-evening Call is not shown as tomorrow's.
 *
 * @see
 *  components/tracer/call-format.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { formatShortTime } from "@/components/tracer/call-format";

const zone = "America/Chicago";
const now = new Date("2026-11-19T02:30:00Z");

describe("formatShortTime", () => {
  it("shows the time of day for a moment on the same day in the reporting timezone", () => {
    expect(formatShortTime("2026-11-19T01:28:51Z", zone, now)).toBe("7:28 PM");
  });

  it("shows a short date for an earlier day in the same year", () => {
    expect(formatShortTime("2026-11-18T05:30:00Z", zone, now)).toBe("Nov 17");
  });

  it("adds the year for an earlier year", () => {
    expect(formatShortTime("2025-12-31T18:00:00Z", zone, now)).toBe("Dec 31, 2025");
  });
});
