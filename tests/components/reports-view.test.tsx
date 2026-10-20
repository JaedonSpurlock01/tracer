/**
 * -------------------------------------------------------------------------
 * @file   reports-view.test.tsx
 * @brief  Verifies the Reports page and Workspace Reports tab.
 *
 * @description
 *  Covers the Report history columns from DESIGN, Skeleton rows while the
 *  history loads, the on-demand Empty state with Generate Report, inline
 *  Retry after a failed load, and each status's row actions: Download per
 *  completed file, Generating without blocking the page, Failed with its
 *  reason and Retry, Expired with Regenerate, and View Parameters showing
 *  stored report and Calls export parameters readably. Workspace Reports
 *  keeps the Workspace tabs, lists only jobs covering that Workspace, and
 *  fixes the Generate Report scope.
 *
 * @remarks
 *  The history comes from the shared jobs provider, so each test renders
 *  the view inside it.
 *
 * @see
 *  components/tracer/reports-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReportJobsProvider } from "@/components/tracer/report-jobs";
import ReportsView from "@/components/tracer/reports-view";
import type { GenerateReportScope } from "@/components/tracer/generate-report-dialog";
import { emptyCallFilters } from "@/data/call-list-query";
import { generatingJob, reportJob, requestsTo, respond, routedFetch, stubBrowser } from "./report-fixtures";

const globalScope: GenerateReportScope = {
  kind: "global",
  workspaces: [{ id: "workspace-1", name: "Acme Plumbing" }, { id: "workspace-2", name: "Quiet Dental" }],
  accountTimeZone: "America/Chicago",
};

const workspaceScope: GenerateReportScope = { kind: "workspace", workspace: { id: "workspace-2", name: "Quiet Dental", reportingTimezone: "America/Denver" } };

function renderView(scope: GenerateReportScope = globalScope, operator = true) {
  return render(
    <ReportJobsProvider>
      <ReportsView scope={scope} operator={operator} />
    </ReportJobsProvider>,
  );
}

function row(text: string): HTMLElement {
  return screen.getByText(text, { selector: "td *, td" }).closest("tr") as HTMLElement;
}

beforeEach(() => {
  stubBrowser();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-18T15:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ReportsView", () => {
  it("shows Skeleton rows while history loads, then the DESIGN columns", async () => {
    let resolve: (response: Response) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    const { container } = renderView();

    expect(screen.getByRole("heading", { name: "Reports" })).toBeVisible();
    await waitFor(() => expect(container.querySelector(".animate-pulse")).not.toBeNull());

    resolve(respond({ jobs: [reportJob()] }));
    await screen.findByRole("link", { name: "Download PDF" });
    expect(container.querySelector(".animate-pulse")).toBeNull();
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent?.trim())).toEqual(["Requested", "Requested By", "Scope", "Period", "Files", "Status", "Expires", "Actions"]);
  });

  it("explains on-demand generation when there are no reports and offers Generate Report", async () => {
    vi.stubGlobal("fetch", routedFetch({ "GET /api/reports": { jobs: [] }, "POST /api/reports/preview": { preview: { matchedCalls: 2 }, recordingExportLimit: 500 } }));
    renderView();

    expect(await screen.findByText("Reports generate on demand from your Calls. Generate one to see it here.")).toBeVisible();
    const buttons = screen.getAllByRole("button", { name: "Generate Report" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    expect(await screen.findByRole("dialog", { name: "Generate Report" })).toBeVisible();
  });

  it("offers an inline Retry when history fails to load", async () => {
    let fail = true;
    const fetch = routedFetch({ "GET /api/reports": () => (fail ? respond({ error: "unavailable" }, 500) : respond({ jobs: [reportJob()] })) });
    vi.stubGlobal("fetch", fetch);
    renderView();

    expect(await screen.findByText("Report history is unavailable.")).toBeVisible();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: "Download PDF" })).toBeVisible();
  });

  it("downloads each completed file and shows the row's requester, scope, period, files, and expiry", async () => {
    vi.stubGlobal("fetch", routedFetch({ "GET /api/reports": { jobs: [reportJob()] } }));
    renderView();

    const download = await screen.findByRole("link", { name: "Download PDF" });
    const cells = within(download.closest("tr") as HTMLElement).getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells.slice(0, 7)).toEqual([
      "Oct 18, 2026, 9:00:00 AM",
      "Example Operator",
      "Acme Plumbing",
      "Previous Week, Oct 5, 2026 - Oct 11, 2026",
      "PDF, CSV",
      "Completed",
      "Oct 25, 2026",
    ]);
    expect(download).toHaveAttribute("href", "/api/reports/job-1/files/pdf");
    expect(screen.getByRole("link", { name: "Download CSV" })).toHaveAttribute("href", "/api/reports/job-1/files/csv");
    expect(screen.queryByRole("button", { name: "Regenerate" })).not.toBeInTheDocument();
  });

  it("shows a Generating row without downloads while the page stays usable", async () => {
    vi.stubGlobal("fetch", routedFetch({ "GET /api/reports": { jobs: [generatingJob()] } }));
    renderView();

    expect(await screen.findByText("Generating")).toBeVisible();
    expect(screen.queryByRole("link", { name: /Download/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate Report" })).toBeEnabled();
  });

  it("shows a Failed row's reason and retries it into a new job", async () => {
    const failed = reportJob({ id: "job-3", status: "Failed", failureReason: "Report generation failed.", files: [{ file: "pdf", downloadable: false, href: null }], expiresAt: null, canRegenerate: true });
    const fetch = routedFetch({ "GET /api/reports": { jobs: [failed] }, "POST /api/reports/job-3/regenerate": () => respond({ job: generatingJob({ id: "job-4" }) }, 201) });
    vi.stubGlobal("fetch", fetch);
    renderView();

    expect(await screen.findByText("Report generation failed.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Generating")).toBeVisible();
    expect(requestsTo(fetch, "POST", "/api/reports/job-3/regenerate")).toHaveLength(1);
  });

  it("keeps an Expired row and offers Regenerate, mapping a refusal to a concise message", async () => {
    const expired = reportJob({ id: "job-5", files: [{ file: "pdf", downloadable: false, href: null }], expiresAt: "2026-10-11T00:00:00.000Z", canRegenerate: true });
    vi.stubGlobal("fetch", routedFetch({ "GET /api/reports": { jobs: [expired] }, "POST /api/reports/job-5/regenerate": () => respond({ error: "not_regenerable" }, 409) }));
    renderView();

    expect(await screen.findByText("Expired")).toBeVisible();
    expect(screen.queryByRole("link", { name: /Download/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This job can no longer be regenerated.");
  });

  it("shows a report's stored parameters readably", async () => {
    vi.stubGlobal("fetch", routedFetch({ "GET /api/reports": { jobs: [reportJob({ scope: [{ id: "workspace-1", name: "Acme Plumbing" }, { id: "workspace-2", name: null }] })] } }));
    renderView();

    fireEvent.click(await screen.findByRole("button", { name: "View Parameters" }));
    const dialog = await screen.findByRole("dialog", { name: "Report parameters" });
    expect(within(dialog).getByText("Acme Plumbing, Unavailable Workspace")).toBeVisible();
    expect(within(dialog).getByText("Previous Week, Oct 5, 2026 - Oct 11, 2026")).toBeVisible();
    expect(within(dialog).getByText("America/Chicago")).toBeVisible();
    expect(within(dialog).getByText("PDF, CSV")).toBeVisible();
  });

  it("shows a Calls export's filters readably", async () => {
    const exportJob = reportJob({
      id: "job-6",
      kind: "call_export",
      parameters: { selection: { kind: "filters", filters: { ...emptyCallFilters, search: "312", outcomes: ["Answered", "Voicemail"], startedFrom: "2026-10-01", startedTo: "2026-10-07" } }, files: ["zip"] },
      files: [{ file: "zip", downloadable: true, href: "/api/reports/job-6/files/zip" }],
    });
    vi.stubGlobal("fetch", routedFetch({ "GET /api/reports": { jobs: [exportJob] } }));
    renderView();

    expect(await screen.findByRole("link", { name: "Download ZIP" })).toHaveAttribute("href", "/api/reports/job-6/files/zip");
    expect(row("Calls filters")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View Parameters" }));
    const dialog = await screen.findByRole("dialog", { name: "Recording export parameters" });
    expect(within(dialog).getByText("Search: 312")).toBeVisible();
    expect(within(dialog).getByText("Started: Oct 1, 2026 - Oct 7, 2026")).toBeVisible();
    expect(within(dialog).getByText("Call Outcome: Answered, Voicemail")).toBeVisible();
  });

  it("keeps the Workspace tabs and lists only jobs covering the Workspace in Workspace Reports", async () => {
    const other = reportJob({ id: "job-7", scope: [{ id: "workspace-1", name: "Acme Plumbing" }] });
    const covering = reportJob({ id: "job-8", scope: [{ id: "workspace-2", name: "Quiet Dental" }], files: [{ file: "pdf", downloadable: true, href: "/api/reports/job-8/files/pdf" }] });
    vi.stubGlobal("fetch", routedFetch({ "GET /api/reports": { jobs: [other, covering] }, "POST /api/reports/preview": { preview: { matchedCalls: 2 }, recordingExportLimit: 500 } }));
    renderView(workspaceScope, false);

    expect(within(screen.getByRole("navigation", { name: "Workspace" })).getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByRole("link", { name: "Download PDF" })).toHaveAttribute("href", "/api/reports/job-8/files/pdf");
    expect(screen.getAllByRole("link", { name: "Download PDF" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Generate Report" }));
    expect(await screen.findByText("Quiet Dental, in America/Denver")).toBeVisible();
  });
});
