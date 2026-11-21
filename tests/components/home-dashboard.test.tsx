/**
 * -------------------------------------------------------------------------
 * @file   home-dashboard.test.tsx
 * @brief  Verifies the Home dashboard regions and their states.
 *
 * @description
 *  Covers the Briefing layout: the header sentence with the date controls
 *  and Generate Report on one row, the stat strip that merges the KPIs
 *  with the Operator-only money, the Workspaces list shown only when the
 *  summary carries Workspace performance, Recent Calls as one-line rows
 *  linking to Call Detail with the global Calls list as its source and
 *  View Calls carrying the range, a failed region showing Retry while
 *  every other region stays, the Operator first-Workspace state, zero
 *  stats with an explanation before the first inbound Call, and a Client
 *  Viewer never seeing cost, revenue, or profit.
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
  goodLeadForms: 0,
  trend: { interval: "day", points: [{ start: "2026-10-18", end: "2026-10-18", label: "Oct 18, 2026", totalCalls: 26, answeredCalls: 15, goodLeads: 9, formSubmissions: 0 }] },
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
  reportScope: {
    kind: "global" as const,
    workspaces: [{ id: "workspace-1", name: "Acme Plumbing" }, { id: "workspace-2", name: "Quiet Dental" }],
    accountTimeZone: "America/Chicago",
  },
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
  Object.defineProperty(Element.prototype, "getAnimations", { value: () => [], configurable: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HomeDashboard", () => {
  it("states the scope and range beside the date controls and Generate Report", () => {
    const { rerender } = render(<HomeDashboard {...props} />);
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    expect(screen.getByText("All Workspaces, the last 7 days.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Generate Report" })).toBeEnabled();
    expect(within(screen.getByRole("group", { name: "Date range" })).getByRole("button", { name: "7 Days" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "90 Days" }));
    expect(router.push).toHaveBeenCalledWith("/?range=90d", { scroll: false });

    rerender(<HomeDashboard {...props} operator={false} workspaceCount={3} range={{ kind: "all" }} />);
    expect(screen.getByText("3 Workspaces, all time.")).toBeVisible();
  });

  it("opens Generate Report over every accessible Workspace", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ preview: { matchedCalls: 5 }, recordingExportLimit: 500 }), { status: 200 })));
    render(<HomeDashboard {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Report" }));
    expect(await screen.findByRole("dialog", { name: "Generate Report" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Acme Plumbing" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Quiet Dental" })).toBeChecked();
  });

  it("shows the headline numbers in one stat strip with their change", () => {
    render(<HomeDashboard {...props} summary={{ ...summary, goodLeadForms: 2 }} />);
    expect(within(screen.getByRole("group", { name: "Total Calls" })).getByText("26")).toBeVisible();
    expect(within(screen.getByRole("group", { name: "Total Calls" })).getByText("+100%")).toBeVisible();
    expect(within(screen.getByRole("group", { name: "Answer Rate" })).getByText("75%")).toBeVisible();
    expect(within(screen.getByRole("group", { name: "Answer Rate" })).getByText("+25 pts")).toBeVisible();
    expect(screen.getByRole("group", { name: "Good Leads" })).toHaveAccessibleDescription("Good Lead Calls and Form Submissions, 2 from Forms");
    expect(within(screen.getByRole("group", { name: "Average Duration" })).getByText("1:35")).toBeVisible();
  });

  it("lists the Workspaces only when the summary carries Workspace performance", () => {
    const { rerender } = render(<HomeDashboard {...props} />);
    const list = screen.getByRole("region", { name: "Workspaces" });
    const north = within(list).getByRole("link", { name: /North Plumbing/ });
    expect(north).toHaveAttribute("href", "/workspaces/north");
    expect(north).toHaveTextContent("+14155550101");
    expect(north).toHaveTextContent("17 Calls");
    expect(north).toHaveTextContent("5 Good Leads");
    expect(north).toHaveTextContent("63.6% answered");
    const setup = within(list).getByRole("link", { name: /Setup Roofing/ });
    expect(setup).toHaveTextContent("No Tracking Number");
    expect(setup).toHaveTextContent("0 Calls");
    expect(setup).not.toHaveTextContent("answered");
    expect(within(list).getByRole("link", { name: "View all" })).toHaveAttribute("href", "/workspaces");

    rerender(<HomeDashboard {...props} summary={{ ...summary, workspacePerformance: null }} />);
    expect(screen.queryByRole("region", { name: "Workspaces" })).not.toBeInTheDocument();
  });

  it("lists the five newest Calls as one-line rows linking to Call Detail, with View Calls carrying the range", () => {
    render(<HomeDashboard {...props} />);
    const recent = screen.getByRole("region", { name: "Recent Calls" });
    const rows = within(recent).getAllByRole("link").filter((link) => link.getAttribute("href")?.includes("/calls/"));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveAttribute("href", "/workspaces/north/calls/call-7?back=%2Fcalls");
    expect(rows[0]).toHaveTextContent("+13125550142");
    expect(rows[0]).toHaveTextContent("North Plumbing");
    expect(rows[0]).toHaveTextContent("Oct 18");
    expect(rows[0]).toHaveTextContent("1:23");
    expect(rows[0]).toHaveTextContent("Good Lead");
    expect(within(rows[0]).getByTitle("Oct 18, 2026, 10:04:05 AM")).toBeVisible();
    expect(rows[1]).toHaveTextContent("Unknown caller");
    expect(rows[1]).toHaveTextContent("In Progress");
    expect(within(recent).getByRole("link", { name: "View Calls" })).toHaveAttribute("href", "/calls?from=2026-10-12&to=2026-10-18");
  });

  it("fails only the analytics regions and retries while Recent Calls stays readable", () => {
    render(<HomeDashboard {...props} summary={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Analytics are unavailable.");
    expect(screen.queryByRole("region", { name: "Leads generated" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Recent Calls" })).getAllByRole("link", { name: /\+13125550142/ })[0]).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(router.refresh).toHaveBeenCalled();
  });

  it("fails only Recent Calls and keeps the stats and the chart", () => {
    render(<HomeDashboard {...props} recentCalls={null} />);
    expect(within(screen.getByRole("region", { name: "Recent Calls" })).getByRole("alert")).toHaveTextContent("Recent Calls are unavailable.");
    expect(within(screen.getByRole("group", { name: "Total Calls" })).getByText("26")).toBeVisible();
    expect(screen.getByRole("region", { name: "Leads generated" })).toBeVisible();
  });

  it("explains the Twilio number an Operator needs before the first Workspace", () => {
    render(<HomeDashboard {...props} workspaceCount={0} summary={null} recentCalls={null} />);
    expect(screen.getByText("Tracer needs an imported Twilio number before it can track Calls. Create a Workspace to assign one.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Create Workspace" })).toHaveAttribute("href", "/workspaces");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the stats at zero and explains that activity appears after the first inbound Call", () => {
    const empty: AnalyticsSummary = {
      ...summary,
      kpis: {
        totalCalls: { value: 0, comparison: { previous: 0, change: null, unit: "relative" } },
        answerRate: { value: null, comparison: { previous: null, change: null, unit: "points" } },
        goodLeads: { value: 0, comparison: { previous: 0, change: null, unit: "relative" } },
        averageConnectedSeconds: { value: null, comparison: { previous: null, change: null, unit: "relative" } },
      },
      goodLeadForms: 0,
      trend: { interval: "day", points: [{ start: "2026-10-18", end: "2026-10-18", label: "Oct 18, 2026", totalCalls: 0, answeredCalls: 0, goodLeads: 0, formSubmissions: 0 }] },
    };
    render(<HomeDashboard {...props} summary={empty} recentCalls={{ ...recentCalls, calls: [], total: 0, hasCalls: false }} />);
    expect(within(screen.getByRole("group", { name: "Total Calls" })).getByText("0")).toBeVisible();
    expect(within(screen.getByRole("group", { name: "Good Leads" })).getByText("0")).toBeVisible();
    expect(within(screen.getByRole("group", { name: "Average Duration" })).getByText("None")).toBeVisible();
    expect(screen.getAllByText("Activity appears after the first inbound Call.").length).toBeGreaterThan(0);
  });
});

const money = {
  month: "October 2026",
  totals: { costCents: 1244, yearlyCostCents: 14_928, revenueCents: 98_333, profitCents: 97_089 },
  byWorkspace: { north: { costCents: 878, revenueCents: 5000 } },
};

describe("HomeDashboard money", () => {
  it("adds Monthly Revenue and Profit to the stat strip, names the cost beneath it, and shows each Workspace's profit", () => {
    render(<HomeDashboard {...props} money={money} />);
    expect(within(screen.getByRole("group", { name: "Monthly Revenue" })).getByText("$983.33")).toBeVisible();
    expect(screen.getByRole("group", { name: "Monthly Revenue" })).toHaveAccessibleDescription("Open Deals for October 2026");
    expect(within(screen.getByRole("group", { name: "Profit" })).getByText("$970.89")).toHaveClass("text-success");
    expect(screen.getByText(/Monthly Cost \$12\.44, projected \$149\.28 per year\./)).toBeVisible();
    expect(screen.getByRole("link", { name: "Pricing guide" })).toHaveAttribute("href", "/pricing");
    const list = screen.getByRole("region", { name: "Workspaces" });
    expect(within(list).getByRole("link", { name: /North Plumbing/ })).toHaveTextContent("$41.22 profit");
    expect(within(list).getByRole("link", { name: /Setup Roofing/ })).toHaveTextContent("$0.00 profit");
  });

  it("colors a loss in the destructive color and shows Retry when cost and revenue fail", () => {
    render(<HomeDashboard {...props} money={{ ...money, totals: { ...money.totals, profitCents: -1244, revenueCents: 0 } }} />);
    expect(within(screen.getByRole("group", { name: "Profit" })).getByText("-$12.44")).toHaveClass("text-destructive");
    cleanup();
    render(<HomeDashboard {...props} money={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Cost and revenue are unavailable.");
    expect(within(screen.getByRole("group", { name: "Total Calls" })).getByText("26")).toBeVisible();
  });

  it("never shows a Client Viewer cost, revenue, or profit", () => {
    render(<HomeDashboard {...props} operator={false} workspaceCount={3} money={money} />);
    expect(screen.getAllByRole("group").map((group) => group.getAttribute("aria-labelledby") && document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent).filter(Boolean)).toEqual(["Total Calls", "Answer Rate", "Good Leads", "Average Duration"]);
    expect(screen.queryByText(/cost|revenue|profit/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Pricing guide" })).not.toBeInTheDocument();
  });
});
