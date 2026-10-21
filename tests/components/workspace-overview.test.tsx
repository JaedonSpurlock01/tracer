/**
 * -------------------------------------------------------------------------
 * @file   workspace-overview.test.tsx
 * @brief  Verifies Workspace routing health and Call Flow summary.
 *
 * @description
 *  Covers routing health with webhook health and the last successful
 *  inbound Call, a webhook Warning isolated in routing health with an
 *  Operator-only recovery action, published flow steps, the header actions
 *  for Operators and Client Viewers, the KPI row and Leads generated in the
 *  Workspace timezone with date controls, a failed analytics region that
 *  keeps every other region, the Archived label, the Recent Calls list with
 *  its links to Call Detail, View Calls carrying the range, and Empty
 *  state, and the Workspace tabs below the header.
 *
 * @remarks
 *  Overview tests use the public component boundary. Navigation is faked at
 *  the next/navigation boundary.
 *
 * @see
 *  components/tracer/workspace-overview.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WorkspaceOverview from "@/components/tracer/workspace-overview";
import type { AnalyticsSummary } from "@/data/analytics";
import { generateInitialCallFlow } from "@/data/call-flow";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/workspaces/workspace-1" }));

const workspace = {
  id: "workspace-1",
  name: "Phoenix Office",
  reportingTimezone: "America/Chicago",
  state: "Active" as const,
  destinationNumber: "+14155550101",
  trackingNumber: "+14155550100",
  numberAssignmentStartedAt: "2026-01-01T00:00:00.000Z",
  publishedFlowVersion: { version: 1, publishedAt: "2026-01-02T00:00:00.000Z" },
  hasDraft: false,
  recordingEnabled: true,
  analysisEnabled: false,
  spamGateEnabled: true,
  whisperEnabled: false,
  whisperMessage: null,
  createdBy: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
};

const summary: AnalyticsSummary = {
  timeZone: "America/Chicago",
  workspace: { id: "workspace-1", name: "Phoenix Office" },
  window: { from: "2026-09-19", to: "2026-10-18" },
  previousWindow: { from: "2026-08-20", to: "2026-09-18" },
  kpis: {
    totalCalls: { value: 17, comparison: { previous: 6, change: 11 / 6, unit: "relative" } },
    answerRate: { value: 7 / 11, comparison: { previous: 3 / 4, change: 7 / 11 - 3 / 4, unit: "points" } },
    goodLeads: { value: 5, comparison: { previous: 2, change: 1.5, unit: "relative" } },
    averageConnectedSeconds: { value: 95, comparison: { previous: null, change: null, unit: "relative" } },
  },
  goodLeadForms: 0,
  trend: { interval: "day", points: [{ start: "2026-10-18", end: "2026-10-18", label: "Oct 18, 2026", totalCalls: 17, answeredCalls: 7, goodLeads: 5, formSubmissions: 0 }] },
  workspacePerformance: null,
};
const analytics = { range: { kind: "days" as const, days: 30 as const }, summary, callsHref: "/workspaces/workspace-1/calls?from=2026-09-19&to=2026-10-18" };
const linkedSite = {
  id: "site-1",
  scriptName: "asphalt-paving-pocatello",
  primaryHostname: "pocatelloasphaltpaving.com",
  hostnames: [{ hostname: "pocatelloasphaltpaving.com", zoneId: "zone-1", certificateId: "cert-1", enabled: true }],
  liveVersionId: "e2e-site-version-1",
  lastDeployedAt: "2026-10-11T23:12:59.000Z",
  lastDeployment: null,
  latestPreview: { versionId: "e2e-site-version-1", capturedAt: "2026-10-18T13:00:00.000Z" },
  latestCheck: { checkedAt: "2026-10-18T15:04:05.000Z", ok: true, statusCode: 200, responseMs: 312 },
  health: "Healthy" as const,
  healthReason: null,
  lastSyncedAt: "2026-10-18T15:00:00.000Z",
  linkedAt: "2026-10-01T00:00:00.000Z",
};
const siteSummary = {
  visits: 1234,
  pageViews: 2468,
  topPaths: [] as [string, number][],
  referrers: [] as [string, number][],
  devices: [] as [string, number][],
  vitals: { lcpMs: null, inpMs: null, cls: null },
  daily: [] as { day: string; visits: number; pageViews: number }[],
};
const healthy = { lastSuccessfulInboundCallAt: "2026-10-18T15:04:05.000Z", webhook: { status: "Healthy" as const, lastAcceptedVoiceWebhookAt: "2026-10-18T15:04:05.000Z" } };

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

function routingHealth(): HTMLElement {
  return screen.getByRole("region", { name: "Routing health" });
}

describe("WorkspaceOverview", () => {
  it("shows the Scorecard and the Site summary when a Site is linked", () => {
    render(<WorkspaceOverview workspace={workspace} analytics={analytics} site={{ record: linkedSite, summary: siteSummary }} />);
    const tile = (name: string) => within(screen.getByRole("group", { name }));
    expect(tile("Visits").getByText("1,234")).toBeVisible();
    expect(tile("Calls").getByText("17")).toBeVisible();
    expect(tile("Visit-to-Call").getByText("1.4%")).toHaveClass("text-[var(--chart-1)]");
    expect(screen.queryByRole("group", { name: "Search Visibility" })).not.toBeInTheDocument();
    const site = screen.getByRole("region", { name: "Site" });
    expect(within(site).getByRole("img", { name: "Preview of pocatelloasphaltpaving.com" })).toHaveAttribute("src", expect.stringMatching(/\/api\/workspaces\/workspace-1\/site\/preview\?v=1792328400000$/));
    expect(within(site).getByText("pocatelloasphaltpaving.com")).toBeVisible();
    expect(within(site).getByText("Healthy")).toBeVisible();
    expect(within(site).getByText(/200, 312 ms/)).toBeVisible();
    expect(within(site).getByText("Oct 11, 2026, 6:12:59 PM")).toBeVisible();
    expect(within(site).getByRole("link", { name: "View Site" })).toHaveAttribute("href", "/workspaces/workspace-1/site");
  });

  it("adds the Search Visibility tile to the Scorecard when the linked Site has a score", () => {
    render(<WorkspaceOverview workspace={workspace} analytics={analytics} site={{ record: linkedSite, summary: siteSummary, searchScore: 42 }} />);
    const tile = within(screen.getByRole("group", { name: "Search Visibility" }));
    expect(tile.getByText("42")).toBeVisible();
    expect(tile.getByText("of 100")).toBeVisible();
    cleanup();
    render(<WorkspaceOverview workspace={workspace} analytics={analytics} site={{ record: linkedSite, summary: siteSummary, searchScore: null }} />);
    expect(screen.queryByRole("group", { name: "Search Visibility" })).not.toBeInTheDocument();
  });

  it("omits the Scorecard without a Site and offers Link Site to Operators", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ sites: [], total: 0, page: 1, pageSize: 5 }), { status: 200 })));
    render(<WorkspaceOverview workspace={workspace} analytics={analytics} site={{ record: null, summary: null }} />);
    expect(screen.queryByRole("group", { name: "Visits" })).not.toBeInTheDocument();
    const site = screen.getByRole("region", { name: "Site" });
    fireEvent.click(within(site).getByRole("button", { name: "Link Site" }));
    expect(await screen.findByRole("heading", { name: "Link Site" })).toBeVisible();
  });

  it("explains the missing Site to a Client Viewer and shows Retry when the Site region fails", () => {
    render(<WorkspaceOverview workspace={workspace} analytics={analytics} readOnly site={{ record: null, summary: null }} />);
    const site = screen.getByRole("region", { name: "Site" });
    expect(within(site).getByText("No Site is linked to this Workspace.")).toBeVisible();
    expect(within(site).queryByRole("button", { name: "Link Site" })).not.toBeInTheDocument();
    cleanup();
    render(<WorkspaceOverview workspace={workspace} analytics={analytics} site={null} />);
    expect(within(screen.getByRole("region", { name: "Site" })).getByRole("alert")).toHaveTextContent("The Site summary is unavailable.");
  });

  it("renders routing health, Call Flow steps, and Edit Flow link", () => {
    render(
      <WorkspaceOverview
        workspace={workspace}
        flow={{
          published: {
            version: 1,
            graph: generateInitialCallFlow({
              destinationNumber: "+14155550101",
              recordingEnabled: false,
              spamGateEnabled: false,
              whisperEnabled: false,
              whisperMessage: null,
              disclosureVoice: "Polly.Joanna",
            }),
          },
        }}
      />,
    );
    expect(within(routingHealth()).getByText("+14155550100")).toBeVisible();
    expect(within(routingHealth()).getByText("+14155550101")).toBeVisible();
    expect(screen.getByText("Incoming Call")).toBeVisible();
    expect(screen.getByRole("link", { name: "Edit Flow" })).toHaveAttribute("href", "/workspaces/workspace-1/flow");
  });

  it("shows the published Call Flow as its main path with each side branch as an exit chip", () => {
    render(
      <WorkspaceOverview
        workspace={workspace}
        flow={{
          published: {
            version: 1,
            graph: generateInitialCallFlow({
              destinationNumber: "+14155550101",
              recordingEnabled: false,
              spamGateEnabled: true,
              whisperEnabled: false,
              whisperMessage: null,
              disclosureVoice: "Polly.Joanna",
            }),
          },
        }}
      />,
    );
    const steps = within(screen.getByRole("list", { name: "Call Flow steps" })).getAllByRole("listitem");
    expect(steps.map((item) => item.querySelector("strong")?.textContent)).toEqual(["Incoming Call", "Keypad Gate", "Forward Call", "Outcome"]);
    expect(steps[1]).toHaveTextContent(/Blocked\s*→\s*Blocked/);
    expect(steps[2]).toHaveTextContent("+14155550101 · rings 30s");
    expect(steps[2]).toHaveTextContent(/Missed\s*→\s*Missed/);
    expect(steps[2]).toHaveTextContent(/Failed\s*→\s*Failed/);
    expect(steps[3]).toHaveTextContent("Answered");
    expect(screen.getByText("v1")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open Flow" })).toHaveAttribute("href", "/workspaces/workspace-1/flow");
  });

it("shows a read-only Overview without Operator actions for a Client Viewer", () => {
    render(<WorkspaceOverview workspace={{ ...workspace, state: "Archived" }} flow={{ published: null }} readOnly />);
    expect(screen.getByText("Routing health")).toBeVisible();
    expect(screen.getByText("Call Flow")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Edit Flow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Workspace Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Restore" })).not.toBeInTheDocument();
  });

  it("lists Recent Calls with Call Outcome, caller, start time, and connected duration linking to Call Detail", () => {
    render(
      <WorkspaceOverview
        workspace={workspace}
        flow={{ published: null }}
        recentCalls={[
          { id: "call-2", callerNumber: "+13125550142", state: "Completed", outcome: "Answered", startedAt: "2026-10-16T20:04:05.000Z", connectedDurationSeconds: 83 },
          { id: "call-1", callerNumber: null, state: "In Progress", outcome: null, startedAt: "2026-10-16T19:00:00.000Z", connectedDurationSeconds: null },
        ]}
      />,
    );
    const recent = screen.getByRole("list", { name: "Recent Calls" });
    const rows = within(recent).getAllByRole("link");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("href", "/workspaces/workspace-1/calls/call-2");
    expect(rows[0]).toHaveTextContent("+13125550142");
    expect(rows[0]).toHaveTextContent("Answered");
    expect(rows[0]).toHaveTextContent("Oct 16, 2026, 3:04:05 PM");
    expect(rows[0]).toHaveTextContent("1:23");
    expect(rows[1]).toHaveTextContent("Unknown caller");
    expect(rows[1]).toHaveTextContent("In Progress");
    expect(screen.getByRole("link", { name: "View Calls" })).toHaveAttribute("href", "/workspaces/workspace-1/calls");
  });

  it("explains that Calls appear after the first inbound Call when the Workspace has none", () => {
    render(<WorkspaceOverview workspace={workspace} flow={{ published: null }} recentCalls={[]} />);
    expect(screen.getByText("Recent Calls")).toBeVisible();
    expect(screen.getByText("No Calls yet. Calls appear after the first inbound Call reaches the Tracking Number.")).toBeVisible();
  });

  it("reports Twilio webhook health and the last successful inbound Call in routing health", () => {
    render(<WorkspaceOverview workspace={workspace} flow={{ published: null }} routingHealth={healthy} />);
    const health = routingHealth();
    expect(within(health).getByText("Healthy")).toBeVisible();
    expect(within(health).getByText("Last successful inbound Call").nextElementSibling).toHaveTextContent("Oct 18, 2026, 10:04:05 AM");
    expect(screen.queryByText(/later milestone/)).not.toBeInTheDocument();
  });

  it("isolates a webhook Warning in routing health with a recovery action only for Operators", () => {
    const warning = { lastSuccessfulInboundCallAt: null, webhook: { status: "Warning" as const, lastAcceptedVoiceWebhookAt: null } };
    const { rerender } = render(<WorkspaceOverview workspace={workspace} flow={{ published: null }} routingHealth={warning} analytics={analytics} />);
    expect(within(routingHealth()).getByText("Needs attention")).toBeVisible();
    expect(within(routingHealth()).getByText("No accepted Twilio voice webhook for the current Tracking Number.")).toBeVisible();
    expect(within(routingHealth()).getByRole("link", { name: "Review Number Settings" })).toHaveAttribute("href", "/workspaces/workspace-1/settings/number");
    expect(within(screen.getByRole("group", { name: "Total Calls" })).getByText("17")).toBeVisible();

    rerender(<WorkspaceOverview workspace={workspace} flow={{ published: null }} routingHealth={warning} analytics={analytics} readOnly />);
    expect(within(routingHealth()).getByText("Needs attention")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Review Number Settings" })).not.toBeInTheDocument();
  });

  it("shows the KPI row and Leads generated in the Workspace reporting timezone with date controls", () => {
    render(<WorkspaceOverview workspace={workspace} flow={{ published: null }} analytics={analytics} recentCalls={[]} />);
    expect(screen.getAllByText("America/Chicago").length).toBeGreaterThan(0);
    expect(within(screen.getByRole("group", { name: "Answer Rate" })).getByText("-11.4 pts vs previous period")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Leads generated" })).getByRole("list", { name: "Chart legend" })).toBeVisible();
    fireEvent.click(within(screen.getByRole("group", { name: "Date range" })).getByRole("button", { name: "7 Days" }));
    expect(router.push).toHaveBeenCalledWith("/workspaces/workspace-1?range=7d", { scroll: false });
    expect(screen.getByRole("link", { name: "View Calls" })).toHaveAttribute("href", "/workspaces/workspace-1/calls?from=2026-09-19&to=2026-10-18");
    expect(screen.queryByRole("region", { name: "Workspace performance" })).not.toBeInTheDocument();
  });

  it("fails only the analytics region and keeps routing health, the Call Flow, and Recent Calls", () => {
    render(<WorkspaceOverview workspace={workspace} flow={{ published: null }} analytics={{ ...analytics, summary: null }} routingHealth={healthy} recentCalls={[]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Analytics are unavailable.");
    expect(within(routingHealth()).getByText("Healthy")).toBeVisible();
    expect(screen.getByText("Call Flow")).toBeVisible();
    expect(screen.getByText("Recent Calls")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(router.refresh).toHaveBeenCalled();
  });

  it("gives Operators Edit Flow and Workspace Settings, and Client Viewers Generate Report and Workspace Reports", async () => {
    const { rerender } = render(<WorkspaceOverview workspace={workspace} flow={{ published: null }} analytics={analytics} />);
    expect(screen.getByRole("link", { name: "Edit Flow" })).toHaveAttribute("href", "/workspaces/workspace-1/flow");
    expect(screen.getByRole("link", { name: "Workspace Settings" })).toHaveAttribute("href", "/workspaces/workspace-1/settings/general");
    expect(screen.queryByRole("button", { name: "Generate Report" })).not.toBeInTheDocument();

    rerender(<WorkspaceOverview workspace={workspace} flow={{ published: null }} analytics={analytics} readOnly />);
    expect(screen.getByRole("link", { name: "Reports" })).toHaveAttribute("href", "/workspaces/workspace-1/reports");
    expect(screen.queryByRole("link", { name: "Edit Flow" })).not.toBeInTheDocument();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ preview: { matchedCalls: 5 }, recordingExportLimit: 500 }), { status: 200 })));
    fireEvent.click(screen.getByRole("button", { name: "Generate Report" }));
    expect(await screen.findByRole("dialog", { name: "Generate Report" })).toBeVisible();
    expect(screen.getByText(`${workspace.name}, in ${workspace.reportingTimezone}`)).toBeVisible();
  });

  it("keeps historical analytics readable for an Archived Workspace and removes live-routing actions", () => {
    const archived = { ...workspace, state: "Archived" as const, archivedAt: "2026-10-01T17:00:00.000Z" };
    render(<WorkspaceOverview workspace={archived} flow={{ published: null }} analytics={analytics} routingHealth={{ ...healthy, webhook: { status: "Not applicable", lastAcceptedVoiceWebhookAt: null } }} />);
    expect(screen.getByText("Archived Oct 1, 2026. Historical analytics and Calls stay readable; routing is read-only.")).toBeVisible();
    expect(within(screen.getByRole("group", { name: "Total Calls" })).getByText("17")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Edit Flow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review Number Settings" })).not.toBeInTheDocument();
  });

  it("replaces the analytics with Resume Setup and its checklist while setup is incomplete", () => {
    const setup = { ...workspace, state: "Setup Required" as const, trackingNumber: null, publishedFlowVersion: null };
    render(<WorkspaceOverview workspace={setup} flow={{ published: null }} analytics={analytics} />);
    expect(screen.getByRole("link", { name: "Resume Setup" })).toHaveAttribute("href", "/workspaces?resume=workspace-1");
    expect(screen.getByRole("heading", { name: "Setup Required" })).toBeVisible();
    expect(screen.queryByRole("group", { name: "Total Calls" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit Flow" })).not.toBeInTheDocument();
  });
});

describe("WorkspaceOverview money tiles", () => {
  const money = { month: "October 2026", costCents: 878, profitCents: 4122, deal: { id: "deal-1", workspaceId: "workspace-1", kind: "Per Lead" as const, amountCents: 2500, startedOn: "2026-10-01", endedOn: null, createdAt: "", updatedAt: "" } };

  it("adds Monthly Cost with the yearly projection and Profit with the Deal to the Scorecard for Operators", () => {
    render(<WorkspaceOverview workspace={workspace} analytics={analytics} site={{ record: linkedSite, summary: siteSummary, searchScore: 42 }} money={money} />);
    const cost = within(screen.getByRole("group", { name: "Monthly Cost" }));
    expect(cost.getByText("$8.78")).toBeVisible();
    expect(cost.getByText("Projected $105.36 per year")).toBeVisible();
    const profit = within(screen.getByRole("group", { name: "Profit" }));
    expect(profit.getByText("$41.22")).toHaveClass("text-success");
    expect(profit.getByText("Per Lead, $25.00 per Good Lead, since Oct 1, 2026")).toBeVisible();
    expect(screen.getByRole("group", { name: "Visits" })).toBeVisible();
  });

  it("shows the money tiles without a Site and a loss in the destructive color", () => {
    render(<WorkspaceOverview workspace={workspace} analytics={analytics} site={{ record: null, summary: null }} money={{ ...money, profitCents: -878, deal: null }} />);
    expect(screen.queryByRole("group", { name: "Visits" })).not.toBeInTheDocument();
    const profit = within(screen.getByRole("group", { name: "Profit" }));
    expect(profit.getByText("-$8.78")).toHaveClass("text-destructive");
    expect(profit.getByText("No Deal")).toBeVisible();
  });

  it("never shows money to a Client Viewer", () => {
    render(<WorkspaceOverview workspace={workspace} analytics={analytics} readOnly site={{ record: linkedSite, summary: siteSummary }} />);
    expect(screen.queryByRole("group", { name: "Monthly Cost" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Profit" })).not.toBeInTheDocument();
  });
});
