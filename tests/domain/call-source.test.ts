/**
 * -------------------------------------------------------------------------
 * @file   call-source.test.ts
 * @brief  Verifies how Call Detail reads and validates the list it was opened from.
 *
 * @description
 *  Checks that a Call opened from global Calls or Workspace Calls carries
 *  that list's URL in one `back` param, that Call Detail reads it back as
 *  the source scope and Calls query, and that the back link is rebuilt
 *  from the parsed query so only list params survive. Anything that is not
 *  global Calls or this Call's own Workspace Calls is rejected: external
 *  URLs, other schemes, protocol-relative and backslash paths, another
 *  Workspace's Calls, dot segments, and percent-encoded separators.
 *
 * @remarks
 *  Rejection is what keeps the back link from becoming an open redirect.
 *
 * @see
 *  data/call-source.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { callDetailHref, callDetailNavigation, callSourceFromBack, callSourceListQuery } from "@/data/call-source";
import { defaultCallSort, emptyCallFilters } from "@/data/call-list-query";

describe("Call Detail source list", () => {
  it("carries the list URL in one back param on the Call Detail link and keeps Play Recording's play param", () => {
    expect(callDetailHref({ id: "call-1", workspaceId: "workspace-1" }, "/calls?sort=leadScore&order=asc&q=312")).toBe(
      "/workspaces/workspace-1/calls/call-1?back=%2Fcalls%3Fsort%3DleadScore%26order%3Dasc%26q%3D312",
    );
    expect(callDetailHref({ id: "call-1", workspaceId: "workspace-1" }, "/calls", { play: true })).toBe("/workspaces/workspace-1/calls/call-1?back=%2Fcalls&play=1");
    expect(callDetailHref({ id: "call-1", workspaceId: "workspace-1" }, null)).toBe("/workspaces/workspace-1/calls/call-1");
  });

  it("reads global Calls with its page, sort, search, flat filters, and adv tree", () => {
    const adv = { combinator: "or", rules: [{ field: "outcome", values: ["Voicemail"] }, { field: "leadScore", min: 40, max: null }] };
    const back = `/calls?page=2&sort=leadScore&order=asc&q=312&outcome=Answered&adv=${encodeURIComponent(JSON.stringify(adv))}`;
    const source = callSourceFromBack(back, "workspace-1");
    expect(source).toMatchObject({
      scope: "global",
      query: { page: 2, sort: { column: "leadScore", direction: "asc" }, filters: { search: "312", outcomes: ["Answered"], advanced: adv } },
    });
    expect(source?.href).toBe(back);
  });

  it("reads this Call's own Workspace Calls", () => {
    expect(callSourceFromBack("/workspaces/workspace-1/calls?recording=Ready", "workspace-1")).toEqual({
      scope: "workspace",
      query: { page: 1, sort: defaultCallSort, filters: { ...emptyCallFilters, recordingAvailability: ["Ready"] } },
      href: "/workspaces/workspace-1/calls?recording=Ready",
    });
  });

  it("rebuilds the back link from the parsed query so unknown params and fragments are dropped", () => {
    expect(callSourceFromBack("/calls?next=https://evil.example&sort=nope&outcome=Answered#x", "workspace-1")?.href).toBe("/calls?outcome=Answered");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["an array", ["/calls", "/calls"]],
    ["an external URL", "https://evil.example/calls"],
    ["a same-looking absolute URL", "http://localhost:3000/calls"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a protocol-relative URL", "//evil.example/calls"],
    ["a backslash path", "/\\evil.example/calls"],
    ["an encoded protocol-relative URL", "%2F%2Fevil.example%2Fcalls"],
    ["a relative path", "calls"],
    ["another Workspace's Calls", "/workspaces/workspace-2/calls"],
    ["another Workspace through dot segments", "/workspaces/workspace-1/../workspace-2/calls"],
    ["an encoded slash in the path", "/workspaces/workspace-1%2Fcalls"],
    ["an encoded dot segment", "/calls/%2e%2e/users"],
    ["a different page", "/users"],
    ["a Call Detail page", "/workspaces/workspace-1/calls/call-2"],
    ["a trailing slash", "/calls/"],
  ])("rejects %s", (_name, back) => {
    expect(callSourceFromBack(back, "workspace-1")).toBeNull();
  });

  it("lists the source's own scope, or the Call's Workspace in the default order without a source", () => {
    const global = callSourceFromBack("/calls?outcome=Voicemail", "workspace-1");
    expect(callSourceListQuery(global, "workspace-1")).toEqual({ ...global!.query, workspaceId: undefined });
    const workspace = callSourceFromBack("/workspaces/workspace-1/calls?sort=leadScore&order=asc", "workspace-1");
    expect(callSourceListQuery(workspace, "workspace-1")).toEqual({ ...workspace!.query, workspaceId: "workspace-1" });
    expect(callSourceListQuery(null, "workspace-1")).toEqual({ page: 1, sort: defaultCallSort, filters: emptyCallFilters, workspaceId: "workspace-1" });
  });

  it("links back to the source and to each neighbor's own Workspace route carrying the source, or to Workspace Calls without one", () => {
    const source = callSourceFromBack("/calls?outcome=Voicemail", "workspace-1");
    expect(callDetailNavigation(source, "workspace-1", { previous: { id: "call-0", workspaceId: "workspace-2" }, next: null })).toEqual({
      back: "/calls?outcome=Voicemail",
      previous: "/workspaces/workspace-2/calls/call-0?back=%2Fcalls%3Foutcome%3DVoicemail",
      next: null,
    });
    expect(callDetailNavigation(null, "workspace-1", { previous: null, next: { id: "call-2", workspaceId: "workspace-1" } })).toEqual({
      back: "/workspaces/workspace-1/calls",
      previous: null,
      next: "/workspaces/workspace-1/calls/call-2",
    });
    expect(callDetailNavigation(null, "workspace-1", null)).toEqual({ back: "/workspaces/workspace-1/calls", previous: null, next: null });
  });
});
