/**
 * -------------------------------------------------------------------------
 * @file   calls-view.test.tsx
 * @brief  Verifies the server-backed Calls Data Grid.
 *
 * @description
 *  Covers the DESIGN column order with the Workspace column omitted in
 *  Workspace scope, dates in the result's timezone, the In Progress badge,
 *  the effective Lead classification and Lead Score, disabled export
 *  actions, the No Calls Empty state, a fetch error with Retry inside the
 *  grid, Open Call and Play Recording only for a playable Recording, row
 *  selection, server sorting and paging kept in the URL with Skeleton rows
 *  only while a client-side page loads, the search box and basic and
 *  advanced filters editing one filter query that returns to the first
 *  page, condition groups and the And or Or combinator in the advanced
 *  popover reaching the `adv` tree, and the no-matches Empty state with
 *  Clear Filters apart from the No Calls state.
 *
 * @remarks
 *  Server authorization is covered by the Calls integration suite; this
 *  suite checks presentation and the requests the grid sends.
 *
 * @see
 *  components/tracer/calls-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CallsView from "@/components/tracer/calls-view";
import { emptyCallFilters, type CallListQuery } from "@/data/call-list-query";
import type { CallListItem, CallListResult } from "@/data/calls";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const answered: CallListItem = {
  id: "call-1",
  workspace: { id: "workspace-1", name: "Acme Plumbing" },
  callerNumber: "+13125550142",
  state: "Completed",
  outcome: "Answered",
  startedAt: "2026-10-17T15:04:05.000Z",
  connectedDurationSeconds: 83,
  effectiveLeadClassification: { classification: "Not Good Lead", source: "review" },
  leadScore: 82,
  recording: "Ready",
};
const inProgress: CallListItem = {
  id: "call-2",
  workspace: { id: "workspace-2", name: "Quiet Dental" },
  callerNumber: null,
  state: "In Progress",
  outcome: null,
  startedAt: "2026-10-17T16:00:00.000Z",
  connectedDurationSeconds: null,
  effectiveLeadClassification: null,
  leadScore: null,
  recording: "Unavailable",
};
const result: CallListResult = { calls: [inProgress, answered], total: 2, page: 1, pageSize: 25, timeZone: "America/Chicago", workspace: null, hasCalls: true };
const defaultQuery: CallListQuery = { page: 1, sort: { column: "startedAt", direction: "desc" }, filters: emptyCallFilters };
const workspaceOptions = [{ id: "workspace-1", name: "Acme Plumbing" }, { id: "workspace-2", name: "Quiet Dental" }];

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function lastRequest(fetch: { mock: { calls: unknown[][] } }): URLSearchParams {
  return new URL(String(fetch.mock.calls.at(-1)?.[0]), "http://localhost").searchParams;
}

function headers(): string[] {
  return screen.getAllByRole("columnheader").map((header) => header.textContent?.trim() ?? "");
}

beforeEach(() => {
  push.mockReset();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(Element.prototype, "getAnimations", { value: () => [], configurable: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CallsView", () => {
  it("renders the server page immediately in DESIGN column order with dates in the result timezone", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const { container } = render(<CallsView initialResult={result} initialQuery={defaultQuery} />);
    expect(screen.getByRole("heading", { level: 1, name: "Calls" })).toBeVisible();
    expect(screen.getByText("2 Calls")).toBeVisible();
    expect(headers()).toEqual(["Started", "Caller", "Workspace", "Call Outcome", "Connected Duration", "Effective Lead Classification", "Lead Score", "Recording Availability", "Actions"]);
    expect(container.querySelector(".animate-pulse")).toBeNull();
    const row = screen.getByRole("row", { name: /\+13125550142/ });
    expect(within(row).getByRole("link", { name: "Oct 17, 2026, 10:04:05 AM" })).toHaveAttribute("href", "/workspaces/workspace-1/calls/call-1?back=%2Fcalls");
    expect(within(row).getByText("Acme Plumbing")).toBeVisible();
    expect(within(row).getByText("Answered")).toBeVisible();
    expect(within(row).getByText("1:23")).toBeVisible();
    expect(within(row).getByText("Not Good Lead")).toBeVisible();
    expect(within(row).getByText("82")).toBeVisible();
    expect(within(row).getByText("Available")).toBeVisible();
    const pending = screen.getByRole("row", { name: /Unknown caller/ });
    expect(within(pending).getByText("In Progress")).toBeVisible();
    expect(within(pending).getByText("Not available")).toBeVisible();
  });

  it("omits the Workspace column and requests the fixed Workspace scope in Workspace Calls", async () => {
    const fetch = vi.fn(async () => respond({ ...result, calls: [answered], total: 1, timeZone: "America/Los_Angeles" }));
    vi.stubGlobal("fetch", fetch);
    render(<CallsView initialResult={{ ...result, calls: [answered], total: 1, timeZone: "America/Los_Angeles" }} initialQuery={defaultQuery} workspace={{ id: "workspace-1", name: "Acme Plumbing" }} />);
    expect(headers()).not.toContain("Workspace");
    expect(screen.getByText("1 Call in Acme Plumbing")).toBeVisible();
    expect(screen.getByRole("link", { name: "Oct 17, 2026, 8:04:05 AM" })).toBeVisible();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/calls?workspaceId=workspace-1", { cache: "no-store" }));
  });

  it("renders the Workspace tabs below the header in Workspace Calls with Calls current, and none on global Calls", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const { rerender } = render(<CallsView initialResult={result} initialQuery={defaultQuery} workspace={{ id: "workspace-1", name: "Acme Plumbing" }} operator={false} />);
    const nav = screen.getByRole("navigation", { name: "Workspace" });
    expect(screen.getByRole("heading", { level: 1, name: "Calls" }).compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.compareDocumentPosition(screen.getByRole("searchbox", { name: "Search Calls" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(["Overview", "Calls"]);
    expect(within(nav).getByRole("link", { name: "Calls" })).toHaveAttribute("aria-current", "page");

    rerender(<CallsView initialResult={result} initialQuery={defaultQuery} workspace={{ id: "workspace-1", name: "Acme Plumbing" }} operator />);
    expect(within(screen.getByRole("navigation", { name: "Workspace" })).getAllByRole("link").map((link) => link.textContent)).toEqual(["Overview", "Calls", "Flow", "Settings"]);

    rerender(<CallsView initialResult={result} initialQuery={defaultQuery} />);
    expect(screen.queryByRole("navigation", { name: "Workspace" })).toBeNull();
  });

  it("shows Export Recordings and Export CSV disabled until exports arrive", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<CallsView initialResult={result} initialQuery={defaultQuery} />);
    const recordings = screen.getByRole("button", { name: "Export Recordings" });
    expect(recordings).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    fireEvent.focus(recordings.parentElement!);
    expect(await screen.findAllByText("Exports arrive in a later release.")).not.toHaveLength(0);
  });

  it("offers Play Recording only for a playable Recording and opens Call Detail from a row", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<CallsView initialResult={result} initialQuery={defaultQuery} />);
    const row = screen.getByRole("row", { name: /\+13125550142/ });
    expect(within(row).getByRole("link", { name: "Play Recording" })).toHaveAttribute("href", "/workspaces/workspace-1/calls/call-1?back=%2Fcalls&play=1");
    expect(within(row).getByRole("link", { name: "Open Call" })).toHaveAttribute("href", "/workspaces/workspace-1/calls/call-1?back=%2Fcalls");
    const pending = screen.getByRole("row", { name: /Unknown caller/ });
    expect(within(pending).queryByRole("link", { name: "Play Recording" })).toBeNull();
    expect(within(pending).getByRole("link", { name: "Open Call" })).toHaveAttribute("href", "/workspaces/workspace-2/calls/call-2?back=%2Fcalls");
    fireEvent.click(within(pending).getByText("Quiet Dental"));
    expect(push).toHaveBeenCalledWith("/workspaces/workspace-2/calls/call-2?back=%2Fcalls");
  });

  it("opens Call Detail carrying the list's page, sort, and filters from rows and row actions", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const query: CallListQuery = { page: 2, sort: { column: "leadScore", direction: "asc" }, filters: { ...emptyCallFilters, search: "312", outcomes: ["Answered"] } };
    const back = encodeURIComponent("/workspaces/workspace-1/calls?page=2&sort=leadScore&order=asc&q=312&outcome=Answered");
    render(<CallsView initialResult={{ ...result, calls: [answered], total: 30, page: 2 }} initialQuery={query} workspace={{ id: "workspace-1", name: "Acme Plumbing" }} />);
    const row = screen.getByRole("row", { name: /\+13125550142/ });
    expect(within(row).getByRole("link", { name: "Open Call" })).toHaveAttribute("href", `/workspaces/workspace-1/calls/call-1?back=${back}`);
    expect(within(row).getByRole("link", { name: "Play Recording" })).toHaveAttribute("href", `/workspaces/workspace-1/calls/call-1?back=${back}&play=1`);
    fireEvent.click(within(row).getByText("Answered"));
    expect(push).toHaveBeenCalledWith(`/workspaces/workspace-1/calls/call-1?back=${back}`);
  });

  it("explains that Calls appear after inbound traffic when there are none", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<CallsView initialResult={{ ...result, calls: [], total: 0, hasCalls: false }} initialQuery={defaultQuery} />);
    expect(screen.getByText("0 Calls")).toBeVisible();
    expect(within(screen.getByRole("table")).getByText("Calls appear after inbound traffic reaches an assigned Tracking Number.")).toBeVisible();
  });

  it("renders a fetch error with Retry inside the grid while keeping the header actions", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    const paged = { ...result, total: 30 };
    const fetch = vi.fn(async () => respond(paged));
    vi.stubGlobal("fetch", fetch);
    render(<CallsView initialResult={paged} initialQuery={defaultQuery} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fetch.mockImplementationOnce(async () => respond({ error: "unavailable" }, 500));
    fireEvent.click(screen.getByRole("button", { name: "Go to next page" }));
    const table = screen.getByRole("table");
    expect(await within(table).findByRole("alert")).toHaveTextContent("Calls are unavailable.");
    expect(screen.getByRole("button", { name: "Export Recordings" })).toBeVisible();
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/?page=2");
    fireEvent.click(within(table).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("row", { name: /\+13125550142/ })).toBeVisible();
    expect(fetch).toHaveBeenLastCalledWith("/api/calls?page=2", { cache: "no-store" });
  });

  it("sorts on the server, keeps the sort in the URL, and shows Skeleton rows while the new page loads", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    let resolveSorted: (response: Response) => void = () => undefined;
    const fetch = vi.fn(async () => respond(result));
    vi.stubGlobal("fetch", fetch);
    const { container } = render(<CallsView initialResult={result} initialQuery={defaultQuery} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/calls", { cache: "no-store" }));
    fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveSorted = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Caller" }));
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith("/api/calls?sort=callerNumber&order=asc", { cache: "no-store" }));
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/?sort=callerNumber&order=asc");
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    resolveSorted(respond({ ...result, calls: [answered], total: 1 }));
    await waitFor(() => expect(container.querySelector(".animate-pulse")).toBeNull());
    expect(screen.getByText("1 Call")).toBeVisible();
  });

  it("flips Started to ascending rather than clearing to the same default sort", async () => {
    const fetch = vi.fn(async () => respond(result));
    vi.stubGlobal("fetch", fetch);
    render(<CallsView initialResult={result} initialQuery={defaultQuery} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Started" }));
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith("/api/calls?sort=startedAt&order=asc", { cache: "no-store" }));
  });

  it("shows the URL's search and filters in the toolbar and the advanced filter popover", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const filtered: CallListQuery = { ...defaultQuery, filters: { ...emptyCallFilters, search: "Acme", startedFrom: "2026-10-01", startedTo: "2026-10-17", outcomes: ["Voicemail"], workspaceIds: ["workspace-2"], leadScoreMin: 40 } };
    render(<CallsView initialResult={result} initialQuery={filtered} workspaceOptions={workspaceOptions} />);
    expect(screen.getByRole("searchbox", { name: "Search Calls" })).toHaveValue("Acme");
    const toolbar = screen.getByRole("toolbar", { name: "Filters" });
    expect(within(toolbar).getByText("Call Outcome")).toBeVisible();
    expect(within(toolbar).getByText("Voicemail")).toBeVisible();
    expect(within(toolbar).getByText("Quiet Dental")).toBeVisible();
    expect(within(toolbar).getByText("Started")).toBeVisible();
    expect(toolbar).toHaveTextContent("Startedis betweenOct 1, 2026 to Oct 17, 2026");
    expect(within(toolbar).queryByText("Lead Score")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Advanced Filters/ }));
    const advanced = await screen.findByRole("dialog");
    expect(within(advanced).getAllByText("Lead Score")[0]).toBeVisible();
    expect(advanced).toHaveTextContent("Lead Scoreis at least40");
  });

  it("edits one filter query from the toolbar and the advanced popover, returning to the first page each time", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    const fetch = vi.fn(async () => respond({ ...result, total: 60 }));
    vi.stubGlobal("fetch", fetch);
    const filtered: CallListQuery = { ...defaultQuery, page: 3, filters: { ...emptyCallFilters, outcomes: ["Voicemail"], leadScoreMin: 40 } };
    render(<CallsView initialResult={{ ...result, total: 60, page: 3 }} initialQuery={filtered} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/calls?page=3&outcome=Voicemail&scoreMin=40", { cache: "no-store" }));
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Filters" })).getByRole("button", { name: "Call Outcome filter options" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith("/api/calls?scoreMin=40", { cache: "no-store" }));
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/?scoreMin=40");
    expect(screen.queryByText("Voicemail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Advanced Filters/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Lead Score filter options" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith("/api/calls", { cache: "no-store" }));
  });

  it("adds a Call Outcome filter from the toolbar picker", async () => {
    const fetch = vi.fn(async () => respond(result));
    vi.stubGlobal("fetch", fetch);
    render(<CallsView initialResult={result} initialQuery={defaultQuery} workspaceOptions={workspaceOptions} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Add Filter" }));
    fireEvent.click(await screen.findByRole("option", { name: /Call Outcome/ }));
    fireEvent.click(await screen.findByRole("option", { name: "is any of" }));
    fireEvent.click(await screen.findByRole("option", { name: /Missed/ }));
    fireEvent.click(await screen.findByRole("option", { name: /In Progress/ }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith("/api/calls?outcome=Missed&outcome=In+Progress", { cache: "no-store" }));
  });

  it("adds a condition group in the advanced popover and sends it in the adv tree, returning to the first page", async () => {
    const fetch = vi.fn(async () => respond({ ...result, total: 60 }));
    vi.stubGlobal("fetch", fetch);
    const filtered: CallListQuery = { ...defaultQuery, page: 3, filters: { ...emptyCallFilters, leadScoreMin: 40 } };
    render(<CallsView initialResult={{ ...result, total: 60, page: 3 }} initialQuery={filtered} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/calls?page=3&scoreMin=40", { cache: "no-store" }));
    fireEvent.click(screen.getByRole("button", { name: /Advanced Filters/ }));
    const advanced = await screen.findByRole("dialog");
    fireEvent.click(within(advanced).getByRole("button", { name: "Add group" }));
    fireEvent.click(await within(advanced).findByRole("button", { name: "Add filter to this group" }));
    fireEvent.click(await screen.findByRole("option", { name: /Call Outcome/ }));
    fireEvent.click(await screen.findByRole("option", { name: "is any of" }));
    fireEvent.click(await screen.findByRole("option", { name: /Voicemail/ }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(lastRequest(fetch).has("adv")).toBe(true));
    expect(lastRequest(fetch).has("page")).toBe(false);
    expect(JSON.parse(lastRequest(fetch).get("adv") ?? "")).toEqual({
      combinator: "and",
      rules: [{ field: "leadScore", min: 40, max: null }, { combinator: "or", rules: [{ field: "outcome", values: ["Voicemail"] }] }],
    });
  });

  it("switches the advanced popover between And and Or, sending an Or tree as adv and an And of distinct fields as flat keys", async () => {
    const fetch = vi.fn(async () => respond({ ...result, total: 60 }));
    vi.stubGlobal("fetch", fetch);
    const filtered: CallListQuery = { ...defaultQuery, page: 2, filters: { ...emptyCallFilters, leadScoreMin: 40, recordingAvailability: ["Ready"] } };
    render(<CallsView initialResult={{ ...result, total: 60, page: 2 }} initialQuery={filtered} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/calls?page=2&scoreMin=40&recording=Ready", { cache: "no-store" }));
    fireEvent.click(screen.getByRole("button", { name: /Advanced Filters/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "And, change combinator" }));
    await waitFor(() => expect(lastRequest(fetch).has("adv")).toBe(true));
    expect([...lastRequest(fetch).keys()]).toEqual(["adv"]);
    expect(JSON.parse(lastRequest(fetch).get("adv") ?? "")).toEqual({
      combinator: "or",
      rules: [{ field: "leadScore", min: 40, max: null }, { field: "recording", values: ["Ready"] }],
    });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Or, change combinator" }));
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith("/api/calls?scoreMin=40&recording=Ready", { cache: "no-store" }));
  });

  it("searches once typing settles and returns to the first page", async () => {
    const fetch = vi.fn(async () => respond({ ...result, total: 60 }));
    vi.stubGlobal("fetch", fetch);
    render(<CallsView initialResult={{ ...result, total: 60, page: 2 }} initialQuery={{ ...defaultQuery, page: 2 }} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/calls?page=2", { cache: "no-store" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Calls" }), { target: { value: "(312) 555" } });
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith("/api/calls?q=%28312%29+555", { cache: "no-store" }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the filters when nothing matches and offers Clear Filters to return to every Call", async () => {
    const fetch = vi.fn(async () => respond({ ...result, calls: [], total: 0 }));
    vi.stubGlobal("fetch", fetch);
    const filtered: CallListQuery = { ...defaultQuery, filters: { ...emptyCallFilters, search: "Gamma", outcomes: ["Missed"], analysisStatus: ["Failed"] } };
    const { container } = render(<CallsView initialResult={{ ...result, calls: [], total: 0 }} initialQuery={filtered} />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("No Calls match these filters.")).toBeVisible();
    expect(within(table).queryByText("Calls appear after inbound traffic reaches an assigned Tracking Number.")).toBeNull();
    expect(screen.getByText("0 Calls")).toBeVisible();
    expect(within(screen.getByRole("toolbar", { name: "Filters" })).getByText("Missed")).toBeVisible();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    let resolveCleared: (response: Response) => void = () => undefined;
    fetch.mockImplementation(() => new Promise<Response>((resolve) => { resolveCleared = resolve; }));
    fireEvent.click(within(table).getByRole("button", { name: "Clear Filters" }));
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith("/api/calls", { cache: "no-store" }));
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    resolveCleared(respond(result));
    expect(screen.getByRole("searchbox", { name: "Search Calls" })).toHaveValue("");
    expect(within(screen.getByRole("toolbar", { name: "Filters" })).queryByText("Missed")).toBeNull();
    expect(await screen.findByRole("row", { name: /\+13125550142/ })).toBeVisible();
  });

  it("explains that Calls appear after inbound traffic when the scope has no Calls, even with filters set", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const filtered: CallListQuery = { ...defaultQuery, filters: { ...emptyCallFilters, outcomes: ["Missed"] } };
    render(<CallsView initialResult={{ ...result, calls: [], total: 0, hasCalls: false }} initialQuery={filtered} />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("Calls appear after inbound traffic reaches an assigned Tracking Number.")).toBeVisible();
    expect(within(table).queryByRole("button", { name: "Clear Filters" })).toBeNull();
  });
});

