/**
 * -------------------------------------------------------------------------
 * @file   call-export.test.tsx
 * @brief  Verifies the Calls export confirmations and Export Call.
 *
 * @description
 *  Covers Export Recordings and Export CSV on global and Workspace Calls,
 *  each confirming matched Calls, retained Recordings, expired media, and
 *  Calls without recordings for the current URL filters before it creates
 *  the job; a Recording export blocked above 500 retained Recordings or
 *  with none, with guidance to change the filters; a Calls CSV that is not
 *  capped; error codes mapped to concise messages; and Export Call on Call
 *  Detail requesting a single-Call ZIP. A created job appears in the
 *  notification popover.
 *
 * @remarks
 *  The preview counts come from the Reports preview route, stubbed here;
 *  the Reports API integration suite covers how the server counts them.
 *
 * @see
 *  components/tracer/call-export.tsx
 *  components/tracer/calls-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExportCallButton } from "@/components/tracer/call-export";
import CallsView from "@/components/tracer/calls-view";
import { ReportJobsProvider } from "@/components/tracer/report-jobs";
import ReportNotifications from "@/components/tracer/report-notifications";
import { callListSearchParams, emptyCallFilters, type CallListQuery } from "@/data/call-list-query";
import type { CallListResult } from "@/data/calls";
import { generatingJob, requestsTo, respond, routedFetch, stubBrowser } from "./report-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const result: CallListResult = { calls: [], total: 640, page: 1, pageSize: 25, timeZone: "America/Chicago", workspace: null, hasCalls: true };
const filteredQuery: CallListQuery = { page: 2, sort: { column: "startedAt", direction: "desc" }, filters: { ...emptyCallFilters, outcomes: ["Answered"], startedFrom: "2026-10-01", startedTo: "2026-10-07" } };
const listResponse = { calls: [], total: 640, page: 2, pageSize: 25, timeZone: "America/Chicago", workspace: null, hasCalls: true };

function preview(overrides: Partial<{ matchedCalls: number; retainedRecordings: number; expiredMedia: number; callsWithoutRecording: number }> = {}) {
  return {
    preview: { matchedCalls: 640, retainedRecordings: 420, expiredMedia: 30, callsWithoutRecording: 190, processingRecordings: 0, failedRecordings: 0, ...overrides },
    recordingExportLimit: 500,
  };
}

function lastBody(fetch: ReturnType<typeof routedFetch>, path: string) {
  return JSON.parse(String(requestsTo(fetch, "POST", path).at(-1)?.body));
}

function confirmation(name: string) {
  return screen.findByRole("dialog", { name });
}

function stat(dialog: HTMLElement, label: string): string | null | undefined {
  return within(dialog).getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
}

beforeEach(() => stubBrowser());

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Calls exports", () => {
  it("confirms a Recording export for the current filters with its counts, then requests it into the notifications", async () => {
    const fetch = routedFetch({
      "GET /api/calls": listResponse,
      "GET /api/reports": { jobs: [] },
      "POST /api/reports/preview": preview(),
      "POST /api/reports": () => respond({ job: generatingJob({ id: "job-zip", kind: "call_export" }) }, 201),
    });
    vi.stubGlobal("fetch", fetch);
    render(
      <ReportJobsProvider>
        <ReportNotifications />
        <CallsView initialResult={result} initialQuery={filteredQuery} />
      </ReportJobsProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Export Recordings" }));
    const dialog = await confirmation("Export Recordings");
    await waitFor(() => expect(stat(dialog, "Matched Calls")).toBe("640"));
    expect(stat(dialog, "Retained Recordings")).toBe("420");
    expect(stat(dialog, "Expired media")).toBe("30");
    expect(stat(dialog, "Calls without recordings")).toBe("190");
    expect(lastBody(fetch, "/api/reports/preview")).toEqual({ kind: "call_export", scope: { kind: "global" }, file: "zip", query: callListSearchParams(filteredQuery).toString() });

    fireEvent.click(within(dialog).getByRole("button", { name: "Export Recordings" }));
    expect(await within(dialog).findByText("Export requested. Download it from notifications when it completes; closing this dialog does not cancel it.")).toBeVisible();
    expect(lastBody(fetch, "/api/reports")).toEqual(lastBody(fetch, "/api/reports/preview"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("button", { name: "Notifications, 1 in progress" })).toBeVisible();
  });

  it("blocks a Recording export above 500 retained Recordings and asks for narrower filters", async () => {
    const fetch = routedFetch({ "GET /api/calls": listResponse, "POST /api/reports/preview": preview({ retainedRecordings: 501 }) });
    vi.stubGlobal("fetch", fetch);
    render(<CallsView initialResult={result} initialQuery={filteredQuery} />);

    fireEvent.click(screen.getByRole("button", { name: "Export Recordings" }));
    const dialog = await confirmation("Export Recordings");
    expect(await within(dialog).findByText("A Recording export holds at most 500 retained Recordings. Narrow the filters and try again.")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Export Recordings" })).toBeDisabled();
    expect(requestsTo(fetch, "POST", "/api/reports")).toHaveLength(0);
  });

  it("blocks a Recording export with no retained Recordings", async () => {
    vi.stubGlobal("fetch", routedFetch({ "GET /api/calls": listResponse, "POST /api/reports/preview": preview({ retainedRecordings: 0, expiredMedia: 40 }) }));
    render(<CallsView initialResult={result} initialQuery={filteredQuery} />);

    fireEvent.click(screen.getByRole("button", { name: "Export Recordings" }));
    const dialog = await confirmation("Export Recordings");
    expect(await within(dialog).findByText("No retained Recordings match. Change the filters to include Calls with Recordings.")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Export Recordings" })).toBeDisabled();
  });

  it("does not cap a Calls CSV export and scopes Workspace Calls to the Workspace", async () => {
    const fetch = routedFetch({ "GET /api/calls": listResponse, "POST /api/reports/preview": preview({ retainedRecordings: 900, matchedCalls: 1200 }) });
    vi.stubGlobal("fetch", fetch);
    render(<CallsView initialResult={{ ...result, workspace: { id: "workspace-1", name: "Acme Plumbing" } }} initialQuery={filteredQuery} workspace={{ id: "workspace-1", name: "Acme Plumbing" }} />);

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    const dialog = await confirmation("Export CSV");
    await waitFor(() => expect(stat(dialog, "Matched Calls")).toBe("1200"));
    expect(within(dialog).getByRole("button", { name: "Export CSV" })).toBeEnabled();
    expect(lastBody(fetch, "/api/reports/preview")).toEqual({ kind: "call_export", scope: { kind: "workspace", workspaceId: "workspace-1" }, file: "csv", query: callListSearchParams(filteredQuery).toString() });
  });

  it("blocks an export that matches no Calls", async () => {
    vi.stubGlobal("fetch", routedFetch({ "GET /api/calls": listResponse, "POST /api/reports/preview": preview({ matchedCalls: 0, retainedRecordings: 0, expiredMedia: 0, callsWithoutRecording: 0 }) }));
    render(<CallsView initialResult={result} initialQuery={filteredQuery} />);

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    const dialog = await confirmation("Export CSV");
    expect(await within(dialog).findByText("No Calls match these filters. Change the filters and try again.")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Export CSV" })).toBeDisabled();
  });

  it("maps a refused export to a concise message", async () => {
    vi.stubGlobal("fetch", routedFetch({ "GET /api/calls": listResponse, "POST /api/reports/preview": preview(), "POST /api/reports": () => respond({ error: "export_too_large" }, 422) }));
    render(<CallsView initialResult={result} initialQuery={filteredQuery} />);

    fireEvent.click(screen.getByRole("button", { name: "Export Recordings" }));
    const dialog = await confirmation("Export Recordings");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Export Recordings" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "Export Recordings" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("More than 500 retained Recordings match. Narrow the filters and try again.");
  });

  it("shows an inline Retry when the counts are unavailable", async () => {
    let fail = true;
    vi.stubGlobal("fetch", routedFetch({ "GET /api/calls": listResponse, "POST /api/reports/preview": () => (fail ? respond({ error: "unavailable" }, 500) : respond(preview())) }));
    render(<CallsView initialResult={result} initialQuery={filteredQuery} />);

    fireEvent.click(screen.getByRole("button", { name: "Export Recordings" }));
    const dialog = await confirmation("Export Recordings");
    expect(await within(dialog).findByText("Export counts are unavailable.")).toBeVisible();
    fail = false;
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(stat(dialog, "Matched Calls")).toBe("640"));
  });
});

describe("Export Call", () => {
  it("confirms and requests a single-Call Recording ZIP", async () => {
    const fetch = routedFetch({ "POST /api/reports/preview": preview({ matchedCalls: 1, retainedRecordings: 1, expiredMedia: 0, callsWithoutRecording: 0 }), "POST /api/reports": () => respond({ job: generatingJob() }, 201) });
    vi.stubGlobal("fetch", fetch);
    render(<ExportCallButton workspaceId="workspace-1" callId="call-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Export Call" }));
    const dialog = await confirmation("Export Call");
    await waitFor(() => expect(stat(dialog, "Retained Recordings")).toBe("1"));
    expect(lastBody(fetch, "/api/reports/preview")).toEqual({ kind: "call_export", scope: { kind: "workspace", workspaceId: "workspace-1" }, callId: "call-1", file: "zip" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Export Call" }));
    expect(await within(dialog).findByText("Export requested. Download it from notifications when it completes; closing this dialog does not cancel it.")).toBeVisible();
    expect(lastBody(fetch, "/api/reports")).toEqual({ kind: "call_export", scope: { kind: "workspace", workspaceId: "workspace-1" }, callId: "call-1", file: "zip" });
  });
});
