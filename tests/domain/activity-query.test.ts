/**
 * -------------------------------------------------------------------------
 * @file   activity-query.test.ts
 * @brief  Verifies the Activity filter subset and Load more cursors.
 *
 * @description
 *  Covers Activity reading only its search and filter fields from the
 *  shared Calls URL keys, and the Call cursor round-tripping with
 *  microsecond start times while malformed cursors are refused.
 *
 * @remarks
 *  Pure parsing behavior; the Activity read model has its own integration
 *  suite.
 *
 * @see
 *  data/activity-query.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { activityFiltersFromSearchParams, activitySearchParams, formatActivityCursor, parseActivityCursor } from "@/data/activity-query";
import { emptyCallFilters } from "@/data/call-list-query";

describe("Activity query", () => {
  it("keeps only the Activity search and filters from the Calls URL keys", () => {
    const params = new URLSearchParams("q=312&from=2026-10-01&workspace=w1&outcome=Missed&classification=None&analysis=Failed&scoreMin=10&recording=Ready&durationMin=5&adv=%7B%7D&page=3");
    const filters = activityFiltersFromSearchParams(params);
    expect(filters).toEqual({ ...emptyCallFilters, search: "312", startedFrom: "2026-10-01", workspaceIds: ["w1"], outcomes: ["Missed"], leadClassifications: ["None"], analysisStatus: ["Failed"] });
    expect(activitySearchParams(filters).toString()).toBe("q=312&from=2026-10-01&workspace=w1&outcome=Missed&classification=None&analysis=Failed");
  });

  it("round-trips a Call cursor with microseconds and refuses malformed ones", () => {
    const cursor = { startedAt: "2026-10-17T15:04:05.123456Z", id: "call-1" };
    expect(parseActivityCursor(formatActivityCursor(cursor))).toEqual(cursor);
    for (const value of [null, "", "call-1", "2026-10-17,call-1", "2026-13-45T99:99:99Z,call-1", `2026-10-17T15:04:05Z,${"x".repeat(129)}`, "2026-10-17T15:04:05Z,"]) {
      expect(parseActivityCursor(value)).toBeNull();
    }
  });
});
