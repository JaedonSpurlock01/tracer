/**
 * -------------------------------------------------------------------------
 * @file   report-notifications.test.tsx
 * @brief  Verifies the report and export notification popover.
 *
 * @description
 *  Covers the in-progress indicator, the recent jobs with their status,
 *  failure reason, and download links for completed files, the link to
 *  Reports, polling every 30 seconds only while the tab is visible and a
 *  job is Queued or Generating, a refresh when the popover opens, and a
 *  job requested elsewhere on the page appearing without a refetch.
 *
 * @remarks
 *  Fake interval timers and a stubbed `document.visibilityState` drive the
 *  polling, as in the Activity suite.
 *
 * @see
 *  components/tracer/report-notifications.tsx
 *  components/tracer/report-jobs.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReportJobsProvider, useReportJobs } from "@/components/tracer/report-jobs";
import ReportNotifications from "@/components/tracer/report-notifications";
import { generatingJob, reportJob, requestsTo, routedFetch, stubBrowser } from "./report-fixtures";

let visibility: DocumentVisibilityState = "visible";

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function historyRequests(fetch: ReturnType<typeof routedFetch>) {
  return requestsTo(fetch, "GET", "/api/reports").length;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2026-10-18T15:00:00.000Z"));
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  stubBrowser();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPopover() {
  return render(
    <ReportJobsProvider>
      <ReportNotifications />
    </ReportJobsProvider>,
  );
}

describe("ReportNotifications", () => {
  it("lists recent jobs with status, failure reason, completed downloads, and a link to Reports", async () => {
    const failed = reportJob({ id: "job-3", status: "Failed", failureReason: "Report generation failed.", files: [{ file: "pdf", downloadable: false, href: null }], canRegenerate: true });
    vi.stubGlobal("fetch", routedFetch({ "GET /api/reports": { jobs: [generatingJob(), reportJob(), failed] } }));
    renderPopover();

    const trigger = await screen.findByRole("button", { name: "Notifications, 1 in progress" });
    fireEvent.click(trigger);
    const popover = await screen.findByRole("dialog", { name: "Reports and exports" });

    expect(within(popover).getByText("Generating")).toBeVisible();
    expect(within(popover).getByText("Completed")).toBeVisible();
    expect(within(popover).getByText("Failed")).toBeVisible();
    expect(within(popover).getByText("Report generation failed.")).toBeVisible();
    expect(within(popover).getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", "/api/reports/job-1/files/pdf");
    expect(within(popover).getByRole("link", { name: "Download CSV" })).toHaveAttribute("href", "/api/reports/job-1/files/csv");
    expect(within(popover).getAllByRole("link", { name: /Download/ })).toHaveLength(2);
    expect(within(popover).getByRole("link", { name: "View Reports" })).toHaveAttribute("href", "/reports");
  });

  it("explains an empty history", async () => {
    vi.stubGlobal("fetch", routedFetch({ "GET /api/reports": { jobs: [] } }));
    renderPopover();
    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("Reports and exports you request appear here.")).toBeVisible();
  });

  it("polls every 30 seconds while a job is Generating and the tab is visible", async () => {
    const fetch = routedFetch({ "GET /api/reports": { jobs: [generatingJob()] } });
    vi.stubGlobal("fetch", fetch);
    renderPopover();
    await screen.findByRole("button", { name: "Notifications, 1 in progress" });
    expect(historyRequests(fetch)).toBe(1);

    await act(async () => vi.advanceTimersByTime(29_999));
    expect(historyRequests(fetch)).toBe(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(historyRequests(fetch)).toBe(2);

    setVisibility("hidden");
    await act(async () => vi.advanceTimersByTime(120_000));
    expect(historyRequests(fetch)).toBe(2);

    setVisibility("visible");
    await waitFor(() => expect(historyRequests(fetch)).toBe(3));
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(historyRequests(fetch)).toBe(4);
  });

  it("stops polling once no job is Queued or Generating and refreshes when the popover opens", async () => {
    let jobs = [generatingJob()];
    const fetch = routedFetch({ "GET /api/reports": () => new Response(JSON.stringify({ jobs }), { status: 200 }) });
    vi.stubGlobal("fetch", fetch);
    renderPopover();
    await screen.findByRole("button", { name: "Notifications, 1 in progress" });

    jobs = [reportJob({ id: "job-2" })];
    await act(async () => vi.advanceTimersByTime(30_000));
    await screen.findByRole("button", { name: "Notifications" });
    expect(historyRequests(fetch)).toBe(2);

    await act(async () => vi.advanceTimersByTime(120_000));
    expect(historyRequests(fetch)).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    await waitFor(() => expect(historyRequests(fetch)).toBe(3));
  });

  it("does not poll when every job has finished", async () => {
    const fetch = routedFetch({ "GET /api/reports": { jobs: [reportJob()] } });
    vi.stubGlobal("fetch", fetch);
    renderPopover();
    await screen.findByRole("button", { name: "Notifications" });
    await act(async () => vi.advanceTimersByTime(120_000));
    expect(historyRequests(fetch)).toBe(1);
  });

  it("shows a job requested elsewhere on the page and starts polling for it", async () => {
    const fetch = routedFetch({ "GET /api/reports": { jobs: [] } });
    vi.stubGlobal("fetch", fetch);
    function RequestButton() {
      const { addJob } = useReportJobs();
      return <button type="button" onClick={() => addJob(generatingJob())}>Request</button>;
    }
    render(
      <ReportJobsProvider>
        <ReportNotifications />
        <RequestButton />
      </ReportJobsProvider>,
    );
    await screen.findByRole("button", { name: "Notifications" });
    fireEvent.click(screen.getByRole("button", { name: "Request" }));
    expect(await screen.findByRole("button", { name: "Notifications, 1 in progress" })).toBeVisible();
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(historyRequests(fetch)).toBe(2);
  });
});
