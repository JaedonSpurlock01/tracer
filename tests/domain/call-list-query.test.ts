/**
 * -------------------------------------------------------------------------
 * @file   call-list-query.test.ts
 * @brief  Verifies how the Calls list reads and writes its page and sort in the URL.
 *
 * @description
 *  Checks that the page and an allow-listed sort column and direction come
 *  from URL search params, that anything outside the allow-list falls back
 *  to Started descending on the first page, that writing the query back
 *  omits the defaults so the plain Calls URL is the default view, and that
 *  the filter query round-trips through the URL while unknown, malformed,
 *  or out-of-range filter values are dropped. It also checks that an
 *  advanced condition tree with nested groups round-trips through the one
 *  `adv` param beside the flat keys, that a flat-key link still reads with
 *  no tree, and that a structurally invalid or oversized tree is rejected
 *  whole while bad condition values are dropped like the flat filters.
 *
 * @remarks
 *  The fallback is what keeps user-supplied sort input out of SQL.
 *
 * @see
 *  data/call-list-query.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import {
  callListQueryFromSearchParams,
  callListSearchParams,
  emptyCallFilters,
  maxCallFilterDepth,
  maxCallFilterNodes,
  type CallFilterGroup,
  type CallFilterNode,
  type CallFilters,
  type CallListQuery,
} from "@/data/call-list-query";

const filtered: CallFilters = {
  search: "(312) 555",
  startedFrom: "2026-10-01",
  startedTo: "2026-10-17",
  workspaceIds: ["granted-active", "granted-quiet"],
  outcomes: ["Answered", "In Progress"],
  leadClassifications: ["Not Good Lead", "None"],
  leadScoreMin: 40,
  leadScoreMax: 90,
  recordingAvailability: ["Ready", "Expired"],
  analysisStatus: ["Failed", "Not applicable"],
  connectedSecondsMin: 15,
  connectedSecondsMax: 600,
  advanced: null,
};

const advanced: CallFilterGroup = {
  combinator: "or",
  rules: [
    { field: "outcome", values: ["Answered"] },
    {
      combinator: "and",
      rules: [
        { field: "outcome", values: ["Voicemail", "In Progress"] },
        { field: "leadScore", min: 60, max: null },
        {
          combinator: "or",
          rules: [
            { field: "startedAt", from: "2026-10-01", to: null },
            { field: "connectedDuration", min: null, max: 30 },
          ],
        },
      ],
    },
    { field: "workspace", values: ["granted-active"] },
    { field: "leadClassification", values: ["None"] },
    { field: "recording", values: ["Ready"] },
    { field: "analysis", values: ["Not applicable"] },
  ],
};

describe("Calls list query", () => {
  it("defaults to the first page sorted by Started descending", () => {
    expect(callListQueryFromSearchParams({})).toEqual({ page: 1, sort: { column: "startedAt", direction: "desc" }, filters: emptyCallFilters });
  });

  it("reads the page and an allow-listed sort from page props or URL search params", () => {
    expect(callListQueryFromSearchParams({ page: "3", sort: "leadScore", order: "asc" })).toEqual({ page: 3, sort: { column: "leadScore", direction: "asc" }, filters: emptyCallFilters });
    expect(callListQueryFromSearchParams(new URLSearchParams("sort=workspace&order=desc&page=2"))).toEqual({ page: 2, sort: { column: "workspace", direction: "desc" }, filters: emptyCallFilters });
    expect(callListQueryFromSearchParams({ page: ["4", "5"], sort: ["callerNumber"], order: ["asc"] })).toEqual({ page: 4, sort: { column: "callerNumber", direction: "asc" }, filters: emptyCallFilters });
  });

  it("falls back to the default for a sort column outside the allow-list, an unknown direction, or an invalid page", () => {
    const fallback = { page: 1, sort: { column: "startedAt", direction: "desc" }, filters: emptyCallFilters };
    expect(callListQueryFromSearchParams({ sort: "c.id; drop table call", order: "asc" })).toEqual(fallback);
    expect(callListQueryFromSearchParams({ sort: "callerNumber", order: "sideways" })).toEqual(fallback);
    expect(callListQueryFromSearchParams({ sort: "callerNumber" })).toEqual(fallback);
    expect(callListQueryFromSearchParams({ page: "0" })).toEqual(fallback);
    expect(callListQueryFromSearchParams({ page: "1.5" })).toEqual(fallback);
    expect(callListQueryFromSearchParams({ page: "-2" })).toEqual(fallback);
  });

  it("writes every filter to the URL and reads the same filter query back", () => {
    const params = callListSearchParams({ page: 1, sort: { column: "startedAt", direction: "desc" }, filters: filtered });
    expect(callListQueryFromSearchParams(params)).toEqual({ page: 1, sort: { column: "startedAt", direction: "desc" }, filters: filtered });
    expect(callListQueryFromSearchParams(Object.fromEntries([...new Set(params.keys())].map((key) => [key, params.getAll(key)])))).toMatchObject({ filters: filtered });
  });

  it("writes an advanced condition tree to one adv param beside the flat keys and reads the same tree back", () => {
    const query: CallListQuery = { page: 1, sort: { column: "startedAt", direction: "desc" }, filters: { ...emptyCallFilters, outcomes: ["Missed"], advanced } };
    const params = callListSearchParams(query);
    expect([...params.keys()]).toEqual(["outcome", "adv"]);
    expect(JSON.parse(params.get("adv") ?? "")).toEqual(advanced);
    expect(callListQueryFromSearchParams(params)).toEqual(query);
    expect(callListQueryFromSearchParams({ outcome: "Missed", adv: params.get("adv") ?? "" })).toEqual(query);
  });

  it("reads a shared flat-key link as flat filters with no advanced tree", () => {
    expect(callListQueryFromSearchParams(new URLSearchParams("outcome=Voicemail&scoreMin=40")).filters).toEqual({ ...emptyCallFilters, outcomes: ["Voicemail"], leadScoreMin: 40, advanced: null });
  });

  it("rejects the whole advanced tree when its shape, a field, or a combinator is unknown, or it is too deep, too large, or too long", () => {
    const advancedOf = (adv: unknown) => callListQueryFromSearchParams({ adv: typeof adv === "string" ? adv : JSON.stringify(adv) }).filters.advanced;
    const answered = { field: "outcome", values: ["Answered"] };
    const nested = (depth: number): CallFilterGroup => ({ combinator: "and", rules: [answered as CallFilterNode, ...(depth > 1 ? [nested(depth - 1)] : [])] });
    expect(maxCallFilterDepth).toBe(3);
    expect(maxCallFilterNodes).toBe(20);
    expect(advancedOf("{not json")).toBeNull();
    expect(advancedOf([answered])).toBeNull();
    expect(advancedOf({ combinator: "xor", rules: [answered] })).toBeNull();
    expect(advancedOf({ combinator: "or", rules: [answered, { field: "c.id; drop table call", values: ["x"] }] })).toBeNull();
    expect(advancedOf({ combinator: "or", rules: [answered, "Voicemail"] })).toBeNull();
    expect(advancedOf({ combinator: "or", rules: [answered, { combinator: "and", rules: [{ field: "callerNumber", values: ["+1"] }] }] })).toBeNull();
    expect(advancedOf(nested(maxCallFilterDepth))).toEqual(nested(maxCallFilterDepth));
    expect(advancedOf(nested(maxCallFilterDepth + 1))).toBeNull();
    expect(advancedOf({ combinator: "or", rules: Array.from({ length: maxCallFilterNodes }, () => answered) })).toMatchObject({ combinator: "or" });
    expect(advancedOf({ combinator: "or", rules: Array.from({ length: maxCallFilterNodes + 1 }, () => answered) })).toBeNull();
    expect(advancedOf({ combinator: "or", rules: [answered, { field: "workspace", values: ["w".repeat(128)] }, { field: "workspace", values: ["w".repeat(128)] }] })).toMatchObject({ combinator: "or" });
    expect(advancedOf({ combinator: "or", rules: [answered, ...Array.from({ length: 30 }, () => ({ combinator: "and", rules: [] }))] })).toBeNull();
    expect(advancedOf({ combinator: "or", rules: [answered, { field: "workspace", values: Array.from({ length: 40 }, (_, index) => `${"w".repeat(120)}-${index}`) }] })).toBeNull();
  });

  it("validates each advanced condition's values like the flat filters, dropping bad values, then empty conditions and groups", () => {
    const adv = JSON.stringify({
      combinator: "or",
      rules: [
        { field: "outcome", values: ["Answered", "answered'; drop table call; --", "Answered", 7] },
        { field: "leadScore", min: -1, max: 101 },
        { field: "connectedDuration", min: 1.5, max: 30 },
        { field: "startedAt", from: "2026-02-30", to: "2026-10-31" },
        { field: "workspace", values: ["", "granted-active", "w".repeat(200)] },
        { field: "leadClassification", values: ["Great Lead"] },
        { combinator: "and", rules: [{ field: "recording", values: ["Available"] }, { field: "analysis", values: [] }] },
      ],
    });
    expect(callListQueryFromSearchParams({ adv }).filters.advanced).toEqual({
      combinator: "or",
      rules: [
        { field: "outcome", values: ["Answered"] },
        { field: "connectedDuration", min: null, max: 30 },
        { field: "startedAt", from: null, to: "2026-10-31" },
        { field: "workspace", values: ["granted-active"] },
      ],
    });
    expect(callListQueryFromSearchParams({ adv: JSON.stringify({ combinator: "and", rules: [{ field: "outcome", values: ["Great"] }] }) }).filters.advanced).toBeNull();
  });

  it("drops unknown, malformed, and out-of-range filter values instead of passing them on", () => {
    const params = new URLSearchParams([
      ["q", `  ${"x".repeat(150)}  `],
      ["from", "2026-02-30"],
      ["to", "17/10/2026"],
      ["workspace", ""],
      ["workspace", "granted-active"],
      ["workspace", "granted-active"],
      ["workspace", "w".repeat(200)],
      ["outcome", "Answered"],
      ["outcome", "answered'; drop table call; --"],
      ["outcome", "Answered"],
      ["classification", "Great Lead"],
      ["scoreMin", "-1"],
      ["scoreMax", "101"],
      ["recording", "Available"],
      ["analysis", "Completed"],
      ["durationMin", "1.5"],
      ["durationMax", "1e3"],
    ]);
    expect(callListQueryFromSearchParams(params).filters).toEqual({
      ...emptyCallFilters,
      search: "x".repeat(100),
      workspaceIds: ["granted-active"],
      outcomes: ["Answered"],
      analysisStatus: ["Completed"],
    });
    expect(callListQueryFromSearchParams({ from: "2026-10-01", to: "2026-10-31", scoreMin: "0", durationMax: "0" }).filters).toMatchObject({ startedFrom: "2026-10-01", startedTo: "2026-10-31", leadScoreMin: 0, connectedSecondsMax: 0 });
  });

  it("writes only non-default page and sort back to the URL", () => {
    expect(callListSearchParams({ page: 1, sort: { column: "startedAt", direction: "desc" }, filters: emptyCallFilters }).toString()).toBe("");
    expect(callListSearchParams({ page: 2, sort: { column: "startedAt", direction: "desc" }, filters: emptyCallFilters }).toString()).toBe("page=2");
    expect(callListSearchParams({ page: 1, sort: { column: "startedAt", direction: "asc" }, filters: emptyCallFilters }).toString()).toBe("sort=startedAt&order=asc");
    expect(callListSearchParams({ page: 3, sort: { column: "leadScore", direction: "desc" }, filters: emptyCallFilters }).toString()).toBe("page=3&sort=leadScore&order=desc");
  });
});
