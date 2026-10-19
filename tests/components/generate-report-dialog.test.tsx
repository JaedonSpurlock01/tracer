/**
 * -------------------------------------------------------------------------
 * @file   generate-report-dialog.test.tsx
 * @brief  Verifies the Generate Report dialog.
 *
 * @description
 *  Covers the defaults (every accessible Workspace, Previous Week, PDF on,
 *  CSV off), the document timezone shown only for more than one Workspace
 *  and defaulting to the account timezone, the fixed Workspace scope, the
 *  live matched Call count from the preview route, No matching Calls
 *  blocking generation, a Custom Range, error codes mapped to concise
 *  messages, and a submission that adds the job to the shared jobs list
 *  and confirms that closing the dialog does not cancel it.
 *
 * @remarks
 *  The preview waits for selections to settle, so assertions wait for the
 *  request rather than advancing timers.
 *
 * @see
 *  components/tracer/generate-report-dialog.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GenerateReportButton, { type GenerateReportScope } from "@/components/tracer/generate-report-dialog";
import { ReportJobsProvider } from "@/components/tracer/report-jobs";
import ReportNotifications from "@/components/tracer/report-notifications";
import { generatingJob, requestsTo, respond, routedFetch, stubBrowser } from "./report-fixtures";

const globalScope: GenerateReportScope = {
  kind: "global",
  workspaces: [{ id: "workspace-1", name: "Acme Plumbing" }, { id: "workspace-2", name: "Quiet Dental" }],
  accountTimeZone: "America/New_York",
};

const workspaceScope: GenerateReportScope = { kind: "workspace", workspace: { id: "workspace-1", name: "Acme Plumbing", reportingTimezone: "America/Chicago" } };

function preview(matchedCalls: number) {
  return { preview: { matchedCalls, retainedRecordings: 0, expiredMedia: 0, callsWithoutRecording: matchedCalls, processingRecordings: 0, failedRecordings: 0 }, recordingExportLimit: 500 };
}

function lastBody(fetch: ReturnType<typeof routedFetch>, path: string) {
  const requests = requestsTo(fetch, "POST", path);
  return JSON.parse(String(requests.at(-1)?.body));
}

function submitButton() {
  return within(screen.getByRole("dialog", { name: "Generate Report" })).getByRole("button", { name: "Generate Report" });
}

async function openDialog(scope: GenerateReportScope) {
  render(<GenerateReportButton scope={scope} />);
  fireEvent.click(screen.getByRole("button", { name: "Generate Report" }));
  return screen.findByRole("dialog", { name: "Generate Report" });
}

beforeEach(() => stubBrowser());

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Generate Report dialog", () => {
  it("defaults to every accessible Workspace, Previous Week, the account timezone, and PDF only, and previews the matched Calls", async () => {
    const fetch = routedFetch({ "POST /api/reports/preview": preview(12) });
    vi.stubGlobal("fetch", fetch);
    await openDialog(globalScope);

    expect(screen.getByRole("checkbox", { name: "Acme Plumbing" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Quiet Dental" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Previous Week" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "Document timezone" })).toHaveTextContent("America/New_York");
    expect(screen.getByRole("checkbox", { name: "PDF report" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "CSV detail" })).not.toBeChecked();

    expect(await screen.findByText("12 matched Calls")).toBeVisible();
    expect(lastBody(fetch, "/api/reports/preview")).toEqual({
      kind: "report",
      scope: { kind: "global", workspaceIds: ["workspace-1", "workspace-2"], timeZone: "America/New_York" },
      period: { kind: "previousWeek" },
      files: ["pdf"],
    });
    expect(submitButton()).toBeEnabled();
  });

  it("asks for a document timezone only while more than one Workspace is selected", async () => {
    const fetch = routedFetch({ "POST /api/reports/preview": preview(3) });
    vi.stubGlobal("fetch", fetch);
    await openDialog(globalScope);
    await screen.findByText("3 matched Calls");

    fireEvent.click(screen.getByRole("checkbox", { name: "Quiet Dental" }));
    expect(screen.queryByRole("combobox", { name: "Document timezone" })).not.toBeInTheDocument();
    await waitFor(() => expect(lastBody(fetch, "/api/reports/preview").scope).toEqual({ kind: "global", workspaceIds: ["workspace-1"], timeZone: null }));

    fireEvent.click(screen.getByRole("checkbox", { name: "Acme Plumbing" }));
    expect(await screen.findByText("Select at least one Workspace.")).toBeVisible();
    expect(submitButton()).toBeDisabled();
  });

  it("fixes Workspace Reports to the Workspace and its reporting timezone", async () => {
    const fetch = routedFetch({ "POST /api/reports/preview": preview(1) });
    vi.stubGlobal("fetch", fetch);
    await openDialog(workspaceScope);

    expect(screen.queryByRole("checkbox", { name: "Acme Plumbing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Document timezone" })).not.toBeInTheDocument();
    expect(screen.getByText("Acme Plumbing, in America/Chicago")).toBeVisible();
    expect(await screen.findByText("1 matched Call")).toBeVisible();
    expect(lastBody(fetch, "/api/reports/preview").scope).toEqual({ kind: "workspace", workspaceId: "workspace-1" });
  });

  it("prevents generation when no Calls match and explains how to change scope or period", async () => {
    vi.stubGlobal("fetch", routedFetch({ "POST /api/reports/preview": preview(0) }));
    await openDialog(workspaceScope);

    expect(await screen.findByText("No matching Calls. Change the Workspaces or period to include Calls.")).toBeVisible();
    expect(submitButton()).toBeDisabled();
  });

  it("previews a Custom Range and maps an invalid period to a concise message", async () => {
    const fetch = routedFetch({ "POST /api/reports/preview": () => respond({ error: "invalid_period" }, 400) });
    vi.stubGlobal("fetch", fetch);
    await openDialog(workspaceScope);

    fireEvent.click(screen.getByRole("button", { name: "Custom Range" }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-10" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-01" } });

    expect(await screen.findByText("Choose a valid date range, with the start on or before the end.")).toBeVisible();
    expect(lastBody(fetch, "/api/reports/preview").period).toEqual({ kind: "custom", from: "2026-10-10", to: "2026-10-01" });
    expect(submitButton()).toBeDisabled();
  });

  it("asks for at least one file before previewing", async () => {
    const fetch = routedFetch({ "POST /api/reports/preview": preview(4) });
    vi.stubGlobal("fetch", fetch);
    await openDialog(workspaceScope);
    await screen.findByText("4 matched Calls");

    fireEvent.click(screen.getByRole("checkbox", { name: "PDF report" }));
    expect(await screen.findByText("Select at least one file.")).toBeVisible();
    expect(submitButton()).toBeDisabled();
  });

  it("shows a concise message when the request fails", async () => {
    vi.stubGlobal("fetch", routedFetch({ "POST /api/reports/preview": preview(4), "POST /api/reports": () => respond({ error: "generation_unavailable" }, 503) }));
    await openDialog(workspaceScope);
    await screen.findByText("4 matched Calls");

    fireEvent.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Report generation is not configured yet. Try again later.");
  });

  it("requests the report, adds it to the notifications, and keeps it running after the dialog closes", async () => {
    const job = generatingJob({ id: "job-9" });
    const fetch = routedFetch({ "GET /api/reports": { jobs: [] }, "POST /api/reports/preview": preview(4), "POST /api/reports": () => respond({ job }, 201) });
    vi.stubGlobal("fetch", fetch);
    render(
      <ReportJobsProvider>
        <ReportNotifications />
        <GenerateReportButton scope={globalScope} />
      </ReportJobsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate Report" }));
    await screen.findByText("4 matched Calls");
    fireEvent.click(screen.getByRole("checkbox", { name: "CSV detail" }));
    await waitFor(() => expect(lastBody(fetch, "/api/reports/preview").files).toEqual(["pdf", "csv"]));
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.click(submitButton());

    expect(await screen.findByText("Report requested. Track it in notifications and Report history; closing this dialog does not cancel it.")).toBeVisible();
    expect(lastBody(fetch, "/api/reports")).toEqual({
      kind: "report",
      scope: { kind: "global", workspaceIds: ["workspace-1", "workspace-2"], timeZone: "America/New_York" },
      period: { kind: "previousWeek" },
      files: ["pdf", "csv"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Generate Report" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Notifications, 1 in progress" })).toBeVisible();
    expect(fetch.mock.calls.every(([url]) => !String(url).includes("cancel"))).toBe(true);
  });
});
