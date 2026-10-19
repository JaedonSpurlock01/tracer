/**
 * -------------------------------------------------------------------------
 * @file   home-dashboard.test.tsx
 * @brief  Verifies the Home dashboard regions and their states.
 *
 * @description
 *  Covers the header scope, date controls, and disabled Generate Report;
 *  Workspace performance shown only when the summary carries it; Recent
 *  Calls linking to Call Detail with the global Calls list as its source
 *  and View Calls carrying the range; a failed region showing Retry while
 *  every other region stays; the Operator first-Workspace state; and zero
 *  KPIs with an explanation before the first inbound Call.
 *
 * @remarks
 *  Navigation is faked at the next/navigation boundary. ResizeObserver is
 *  stubbed because jsdom lacks it.
 *
 * @see
 *  components/tracer/home-dashboard.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HomeDashboard from "@/components/tracer/home-dashboard";
import type { AnalyticsSummary } from "@/data/analytics";
import type { CallListItem, CallListResult } from "@/data/calls";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/" }));

const summary: AnalyticsSummary = {
  timeZone: "America/Chicago",
  workspace: null,
  window: { from: "2026-10-12", to: "2026-10-18" },
  previousWindow: { from: "2026-10-05", to: "2026-10-11" },
  kpis: {
    totalCalls: { value: 26, comparison: { previous: 13, change: 1, unit: "relative" } },
    answerRate: { value: 0.75, comparison: { previous: 0.5, change: 0.25, unit: "points" } },
    goodLeads: { value: 9, comparison: { previous: 3, change: 2, unit: "relative" } },
    averageConnectedSeconds: { value: 95, comparison: { previous: 60, change: 95 / 60 - 1, unit: "relative" } },
  },
  trend: { interval: "day", points: [{ start: "2026-10-18", end: "2026-10-18", label: "Oct 18, 2026", totalCalls: 26, answeredCalls: 15, goodLeads: 9 }] },
  workspacePerformance: [
    { workspace: { id: "north", name: "North Plumbing" }, trackingNumber: "+14155550101", totalCalls: 17, answerRate: 7 / 11, goodLeads: 5, leadRate: 5 / 17 },
    { workspace: { id: "setup", name: "Setup Roofing" }, trackingNumber: null, totalCalls: 0, answerRate: null, goodLeads: 0, leadRate: null },
  ],
};

function call(id: string, overrides: Partial<CallListItem> = {}): CallListItem {
  return {
    id,
    workspace: { id: "north", name: "North Plumbing" },
    callerNumber: "+13125550142",
    state: "Completed",
    outcome: "Answered",
    startedAt: "2026-10-18T15:04:05.000Z",
    connectedDurationSeconds: 83,
    effectiveLeadClassification: { classification: "Good Lead", source: "review" },
    leadScore: null,
    recording: "Unavailable",
    mp3RecordingId: null,
    ...overrides,
  };
}

const recentCalls: CallListResult = {
  calls: [call("call-7"), call("call-6", { callerNumber: null, outcome: null, state: "In Progress", connectedDurationSeconds: null, effectiveLeadClassification: null }), call("call-5"), call("call-4"), call("call-3"), call("call-2")],
  total: 6,
  page: 1,
  pageSize: 25,
  timeZone: "America/Chicago",
  workspace: null,
  hasCalls: true,
};

const props = {
  operator: true,
  workspaceCount: 2,
  range: { kind: "days" as const, days: 7 as const },
  summary,
  recentCalls,
  callsHref: "/calls?from=2026-10-12&to=2026-10-18",
};

beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HomeDashboard", () => {
  it("shows the scope, the date controls, and Generate Report disabled until Reports exist", () => {
    const { rerender } = render(<HomeDashboard {...props} />);
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    expect(screen.getByText("All Workspaces")).toBeVisible();
    expect(screen.getByRole("button", { name: "Generate Report" })).toBeDisabled();
    expect(within(screen.getByRole("group", { name: "Date range" })).getByRole("button", { name: "7 Days" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "90 Days" }));
    expect(router.push).toHaveBeenCalledWith("/?range=90d", { scroll: false });

    rerender(<HomeDashboard {...props} operator={false} workspaceCount={3} />);
    expect(screen.getByText("3 Workspaces")).toBeVisible();
  });

  it("compares Workspaces only when the summary carries Workspace performance", () => {
    const { rerender } = render(<HomeDashboard {...props} />);
    const grid = screen.getByRole("region", { name: "Workspace performance" });
    expect(within(grid).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Workspace", "Tracking Number", "Total Calls", "Answer Rate", "Good Leads", "Lead Rate"]);
    const north = within(grid).getByRole("link", { name: "North Plumbing" });
    expect(north).toHaveAttribute("href", "/workspaces/north");
    expect(within(north.closest("tr")!).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["North Plumbing", "+14155550101", "17", "63.6%", "5", "29.4%"]);
    expect(within(within(grid).getByRole("link", { name: "Setup Roofing" }).closest("tr")!).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Setup Roofing", "-", "0", "-", "0", "-"]);

    rerender(<HomeDashboard {...props} summary={{ ...summary, workspacePerformance: null }} />);
    expect(screen.queryByRole("region", { name: "Workspace performance" })).not.toBeInTheDocument();
  });

  it("lists the five newest Calls linking to Call Detail from the Calls list, with View Calls carrying the range", () => {
    render(<HomeDashboard {...props} />);
    const recent = screen.getByRole("region", { name: "Recent Calls" });
    const rows = within(recent).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(5);
    expect(within(rows[0]).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Answered", "+13125550142", "North Plumbing", "Oct 18, 2026, 10:04:05 AM", "1:23", "Good Lead"]);
    expect(within(rows[1]).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["In Progress", "Unknown caller", "North Plumbing", "Oct 18, 2026, 10:04:05 AM", "-", "-"]);
    expect(within(rows[0]).getByRole("link")).toHaveAttribute("href", "/workspaces/north/calls/call-7?back=%2Fcalls");
    fireEvent.click(rows[2]);
    expect(router.push).toHaveBeenCalledWith("/workspaces/north/calls/call-5?back=%2Fcalls");
    expect(within(recent).getByRole("link", { name: "View Calls" })).toHaveAttribute("href", "/calls?from=2026-10-12&to=2026-10-18");
  });

  it("fails only the analytics regions and retries without blanking the page", () => {
    render(<HomeDashboard {...props} summary={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Analytics are unavailable.");
    expect(within(screen.getByRole("region", { name: "Recent Calls" })).getAllByRole("row")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(router.refresh).toHaveBeenCalled();
  });

  it("fails only Recent Calls and keeps the KPIs", () => {
    render(<HomeDashboard {...props} recentCalls={null} />);
    expect(within(screen.getByRole("region", { name: "Recent Calls" })).getByRole("alert")).toHaveTextContent("Recent Calls are unavailable.");
    expect(within(screen.getByRole("group", { name: "Total Calls" })).getByText("26")).toBeVisible();
  });

  it("explains the Twilio number an Operator needs before the first Workspace", () => {
    render(<HomeDashboard {...props} workspaceCount={0} summary={null} recentCalls={null} />);
    expect(screen.getByText("Tracer needs an imported Twilio number before it can track Calls. Create a Workspace to assign one.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Create Workspace" })).toHaveAttribute("href", "/workspaces");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the KPIs at zero and explains that activity appears after the first inbound Call", () => {
    const empty: AnalyticsSummary = {
      ...summary,
      kpis: {
        totalCalls: { value: 0, comparison: { previous: 0, change: null, unit: "relative" } },
        answerRate: { value: null, comparison: { previous: null, change: null, unit: "points" } },
        goodLeads: { value: 0, comparison: { previous: 0, change: null, unit: "relative" } },
        averageConnectedSeconds: { value: null, comparison: { previous: null, change: null, unit: "relative" } },
      },
      trend: { interval: "day", points: [{ start: "2026-10-18", end: "2026-10-18", label: "Oct 18, 2026", totalCalls: 0, answeredCalls: 0, goodLeads: 0 }] },
    };
    render(<HomeDashboard {...props} summary={empty} recentCalls={{ ...recentCalls, calls: [], total: 0, hasCalls: false }} />);
    expect(within(screen.getByRole("group", { name: "Total Calls" })).getByText("0")).toBeVisible();
    expect(within(screen.getByRole("group", { name: "Good Leads" })).getByText("0")).toBeVisible();
    expect(screen.getAllByText("Activity appears after the first inbound Call.").length).toBeGreaterThan(0);
  });
});
