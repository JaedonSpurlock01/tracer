/**
 * -------------------------------------------------------------------------
 * @file   activity-view.test.tsx
 * @brief  Verifies the day-grouped Activity timeline and its refresh.
 *
 * @description
 *  Covers Today, Yesterday, and calendar date labels in the result's
 *  timezone, the entry header opening Call Detail with the Activity back
 *  context, expanding an entry to show only the steps that occurred with
 *  neutral pending steps, the freshness label, the 30-second refresh that
 *  runs only while the document is visible, refresh merging by Call id
 *  without duplicates, a refresh error keeping entries with Retry, Load
 *  more appending older Calls with its failure isolated to its region,
 *  the No Activity and No results states, and filter changes kept in the
 *  URL with timeline Skeletons.
 *
 * @remarks
 *  Only intervals and the clock are faked, so Testing Library's polling
 *  keeps real timeouts. Server authorization is covered by the Activity
 *  integration suite; this suite checks presentation and the requests the
 *  view sends.
 *
 * @see
 *  components/tracer/activity-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ActivityView from "@/components/tracer/activity-view";
import type { ActivityEntry, ActivityResult } from "@/data/activity";
import { emptyCallFilters } from "@/data/call-list-query";

const today: ActivityEntry = {
  id: "call-1",
  workspace: { id: "workspace-1", name: "Acme Plumbing" },
  callerNumber: "+13125550142",
  state: "Completed",
  outcome: "Answered",
  startedAt: "2026-10-18T14:04:05.000Z",
  connectedDurationSeconds: 83,
  effectiveLeadClassification: { classification: "Not Good Lead", source: "review" },
  day: "2026-10-18",
  cursor: "2026-10-18T14:04:05.000000Z,call-1",
  steps: [
    { id: "1", kind: "call_received", occurredAt: "2026-10-18T14:04:05.000Z" },
    { id: "2", kind: "forwarding_attempted", occurredAt: "2026-10-18T14:04:06.000Z" },
    { id: "3", kind: "call_completed", occurredAt: "2026-10-18T14:05:40.000Z", outcome: "Answered" },
    { id: "4", kind: "recording_transferred", occurredAt: "2026-10-18T14:06:00.000Z" },
    { id: "5", kind: "lead_review_added", occurredAt: "2026-10-18T14:30:00.000Z", classification: "Not Good Lead", reviewerName: "Example Operator" },
  ],
};
const yesterday: ActivityEntry = {
  ...today,
  id: "call-2",
  callerNumber: "+13125550199",
  state: "Completed",
  outcome: "Voicemail",
  startedAt: "2026-10-17T20:00:00.000Z",
  connectedDurationSeconds: 0,
  effectiveLeadClassification: null,
  day: "2026-10-17",
  cursor: "2026-10-17T20:00:00.000000Z,call-2",
  steps: [
    { id: "6", kind: "call_received", occurredAt: "2026-10-17T20:00:00.000Z" },
    { id: "7", kind: "call_completed", occurredAt: "2026-10-17T20:01:00.000Z", outcome: "Voicemail" },
    { id: "8", kind: "recording_transferred", occurredAt: "2026-10-17T20:02:00.000Z" },
    { id: "transcript_pending", kind: "transcript_pending", occurredAt: null },
  ],
};
const earlier: ActivityEntry = {
  ...today,
  id: "call-3",
  workspace: { id: "workspace-2", name: "Quiet Dental" },
  callerNumber: null,
  state: "In Progress",
  outcome: null,
  startedAt: "2026-10-14T16:00:00.000Z",
  connectedDurationSeconds: null,
  effectiveLeadClassification: null,
  day: "2026-10-14",
  cursor: "2026-10-14T16:00:00.000000Z,call-3",
  steps: [{ id: "9", kind: "call_received", occurredAt: "2026-10-14T16:00:00.000Z" }],
};
const result: ActivityResult = { entries: [today, yesterday, earlier], hasMore: true, hasCalls: true, timeZone: "America/Chicago" };
const workspaceOptions = [{ id: "workspace-1", name: "Acme Plumbing" }, { id: "workspace-2", name: "Quiet Dental" }];

let visibility: DocumentVisibilityState = "visible";

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function requestParams(fetch: { mock: { calls: unknown[][] } }, index = -1): URLSearchParams {
  return new URL(String(fetch.mock.calls.at(index)?.[0]), "http://localhost").searchParams;
}

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function entry(caller: string): HTMLElement {
  return screen.getByRole("link", { name: new RegExp(caller.replace("+", "\\+")) }).closest("[data-slot=timeline-item]") as HTMLElement;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-18T15:00:00.000Z"));
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(Element.prototype, "getAnimations", { value: () => [], configurable: true });
  window.history.replaceState(null, "", "/activity");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ActivityView", () => {
  it("renders the server entries under Today, Yesterday, and calendar date labels in the result timezone without Skeletons", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const { container } = render(<ActivityView initialResult={result} initialFilters={emptyCallFilters} workspaceOptions={workspaceOptions} />);
    expect(screen.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
    expect(screen.getByText("3 Calls in view")).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Today", "Yesterday", "Oct 14, 2026"]);
    expect(container.querySelector(".animate-pulse")).toBeNull();
    const first = entry("+13125550142");
    expect(within(first).getByRole("link")).toHaveTextContent("9:04:05 AM");
    expect(within(first).getByText("Acme Plumbing")).toBeVisible();
    expect(within(first).getByText("Answered")).toBeVisible();
    expect(within(first).getByText("Not Good Lead")).toBeVisible();
    expect(within(first).getByText("1:23")).toBeVisible();
    const pending = entry("Unknown caller");
    expect(within(pending).getByText("In Progress")).toBeVisible();
    expect(within(pending).getByText("Quiet Dental")).toBeVisible();
  });

  it("opens Call Detail from the entry header with the Activity back context and filters", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<ActivityView initialResult={result} initialFilters={{ ...emptyCallFilters, outcomes: ["Answered"] }} workspaceOptions={workspaceOptions} />);
    expect(screen.getByRole("link", { name: /\+13125550142/ })).toHaveAttribute("href", "/workspaces/workspace-1/calls/call-1?back=%2Factivity%3Foutcome%3DAnswered");
  });
  it("expands an entry to show only the steps that occurred, each with one status Badge, and a neutral pending step", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<ActivityView initialResult={result} initialFilters={emptyCallFilters} workspaceOptions={workspaceOptions} />);
    const first = entry("+13125550142");
    expect(within(first).queryByRole("list")).toBeNull();
    fireEvent.click(within(first).getByRole("button", { name: /Acme Plumbing/ }));
    const steps = await within(first).findAllByRole("listitem");
    expect(steps.map((step) => step.querySelector("[data-step-label]")?.textContent)).toEqual([
      "Call received",
      "Forwarding attempted",
      "Call answered",
      "Recording transferred",
      "Lead Review added by Example Operator",
    ]);
    expect(steps.map((step) => step.querySelectorAll("[data-slot=badge]").length)).toEqual([1, 1, 1, 1, 1]);
    expect(within(steps[0]).getByText("9:04:05 AM")).toBeVisible();
    expect(within(steps[2]).getByText("Answered")).toBeVisible();
    expect(within(steps[4]).getByText("Not Good Lead")).toBeVisible();
    expect(within(first).queryByText(/Spam gate|Transcript|Lead Assessment/)).toBeNull();

    const second = entry("+13125550199");
    fireEvent.click(within(second).getByRole("button", { name: /Acme Plumbing/ }));
    const pendingStep = (await within(second).findAllByRole("listitem")).at(-1)!;
    expect(pendingStep).toHaveTextContent("Transcript pending");
    expect(within(pendingStep).getByText("Pending")).toHaveClass("border-border");
  });

  it("labels a Media purged step with its Purged Badge", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const purged: ActivityEntry = { ...today, steps: [...today.steps, { id: "10", kind: "media_purged", occurredAt: "2026-10-18T14:45:00.000Z" }] };
    render(<ActivityView initialResult={{ ...result, entries: [purged] }} initialFilters={emptyCallFilters} workspaceOptions={workspaceOptions} />);
    const first = entry("+13125550142");
    fireEvent.click(within(first).getByRole("button", { name: /Acme Plumbing/ }));
    const purgedStep = (await within(first).findAllByRole("listitem")).at(-1)!;
    expect(purgedStep.querySelector("[data-step-label]")).toHaveTextContent("Media purged");
    expect(within(purgedStep).getByText("Purged")).toBeVisible();
  });
  it("refreshes the loaded window every 30 seconds only while the document is visible, and promptly when it returns stale", async () => {
    const fetch = vi.fn(async () => respond(result));
    vi.stubGlobal("fetch", fetch);
    render(<ActivityView initialResult={result} initialFilters={emptyCallFilters} workspaceOptions={workspaceOptions} />);
    expect(screen.getByText("Updated just now")).toBeVisible();
    await act(async () => vi.advanceTimersByTime(29_999));
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toMatch(/^\/api\/activity\?/);
    expect(requestParams(fetch).get("through")).toBe(earlier.cursor);
    await waitFor(() => expect(screen.getByText("Updated just now")).toBeVisible());

    setVisibility("hidden");
    setVisibility("visible");
    expect(fetch).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    await act(async () => vi.advanceTimersByTime(120_000));
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockImplementation(() => new Promise<Response>(() => undefined));
    setVisibility("visible");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Updated 2 min ago")).toBeVisible();
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("merges a refresh by Call id, updating entries in place without duplicates and keeping older loaded entries past a capped refresh", async () => {
    const arrived: ActivityEntry = { ...today, id: "call-0", callerNumber: "+13125550111", startedAt: "2026-10-18T14:50:00.000Z", cursor: "2026-10-18T14:50:00.000000Z,call-0" };
    const fetch = vi.fn(async () => respond({ ...result, entries: [arrived, { ...today, outcome: "Missed" }] }));
    vi.stubGlobal("fetch", fetch);
    render(<ActivityView initialResult={result} initialFilters={emptyCallFilters} workspaceOptions={workspaceOptions} />);
    const before = entry("+13125550142");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByText("4 Calls in view")).toBeVisible());
    expect(screen.getAllByRole("link", { name: /\+13125550142/ })).toHaveLength(1);
    expect(entry("+13125550142")).toBe(before);
    expect(within(before).getByText("Missed")).toBeVisible();
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(["9:50:00 AM+13125550111", "9:04:05 AM+13125550142", "3:00:00 PM+13125550199", "11:00:00 AMUnknown caller"]);
  });
  it("keeps existing entries visible after a refresh error, marks freshness unavailable, and retries inline", async () => {
    const fetch = vi.fn(async () => respond({ error: "unavailable" }, 500));
    vi.stubGlobal("fetch", fetch);
    render(<ActivityView initialResult={result} initialFilters={emptyCallFilters} workspaceOptions={workspaceOptions} />);
    await act(async () => vi.advanceTimersByTime(30_000));
    await waitFor(() => expect(screen.getByText("Updates unavailable")).toBeVisible());
    expect(screen.getByText("3 Calls in view")).toBeVisible();
    expect(screen.getByRole("link", { name: /\+13125550142/ })).toBeVisible();
    fetch.mockImplementation(async () => respond(result));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Updated just now")).toBeVisible());
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
  it("loads older Calls before the oldest entry and isolates a Load more failure to its region", async () => {
    const older: ActivityEntry = { ...earlier, id: "call-4", callerNumber: "+13125550177", startedAt: "2026-10-09T16:00:00.000Z", day: "2026-10-09", cursor: "2026-10-09T16:00:00.000000Z,call-4" };
    let answer: (response: Response) => void = () => undefined;
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const { container } = render(<ActivityView initialResult={result} initialFilters={{ ...emptyCallFilters, outcomes: ["Answered"] }} workspaceOptions={workspaceOptions} />);
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(requestParams(fetch).get("before")).toBe(earlier.cursor);
    expect(requestParams(fetch).get("outcome")).toBe("Answered");
    expect(container.querySelector("[data-region=load-more] .animate-pulse")).not.toBeNull();
    await act(async () => answer(respond({ error: "unavailable" }, 500)));
    const region = container.querySelector("[data-region=load-more]") as HTMLElement;
    await waitFor(() => expect(within(region).getByRole("alert")).toHaveTextContent("Older Activity is unavailable."));
    expect(screen.getByText("Updated just now")).toBeVisible();
    expect(screen.getByText("3 Calls in view")).toBeVisible();
    fireEvent.click(within(region).getByRole("button", { name: "Retry" }));
    await act(async () => answer(respond({ ...result, entries: [earlier, older], hasMore: false })));
    await waitFor(() => expect(screen.getByText("4 Calls in view")).toBeVisible());
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Today", "Yesterday", "Oct 14, 2026", "Oct 9, 2026"]);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
  it("explains that call events appear after the first inbound Call when there is no Activity", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<ActivityView initialResult={{ entries: [], hasMore: false, hasCalls: false, timeZone: "America/Chicago" }} initialFilters={emptyCallFilters} workspaceOptions={workspaceOptions} />);
    expect(screen.getByText("0 Calls in view")).toBeVisible();
    expect(screen.getByText("Call events appear after the first inbound Call.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Clear Filters" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
  it("preserves filters that match nothing and offers Clear Filters, which reloads the first page with timeline Skeletons and a plain URL", async () => {
    let answer: (response: Response) => void = () => undefined;
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; }));
    vi.stubGlobal("fetch", fetch);
    window.history.replaceState(null, "", "/activity?outcome=Missed&analysis=Pending");
    const { container } = render(
      <ActivityView initialResult={{ entries: [], hasMore: false, hasCalls: true, timeZone: "America/Chicago" }} initialFilters={{ ...emptyCallFilters, outcomes: ["Missed"], analysisStatus: ["Pending"] }} workspaceOptions={workspaceOptions} />,
    );
    expect(screen.getByText("No Calls match these filters.")).toBeVisible();
    expect(screen.getByText("Processing State")).toBeVisible();
    expect(screen.queryByText("Call events appear after the first inbound Call.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/activity", { cache: "no-store" }));
    expect(window.location.pathname + window.location.search).toBe("/activity");
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    await act(async () => answer(respond(result)));
    await waitFor(() => expect(screen.getByText("3 Calls in view")).toBeVisible());
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });

  it("searches caller numbers and keeps the search in the URL", async () => {
    const fetch = vi.fn(async () => respond({ ...result, entries: [today] }));
    vi.stubGlobal("fetch", fetch);
    render(<ActivityView initialResult={result} initialFilters={emptyCallFilters} workspaceOptions={workspaceOptions} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search caller number" }), { target: { value: "312-555" } });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/activity?q=312-555", { cache: "no-store" }));
    await waitFor(() => expect(screen.getByText("1 Call in view")).toBeVisible());
    expect(window.location.search).toBe("?q=312-555");
    expect(screen.getByRole("link", { name: /\+13125550142/ })).toHaveAttribute("href", "/workspaces/workspace-1/calls/call-1?back=%2Factivity%3Fq%3D312-555");
  });
});
