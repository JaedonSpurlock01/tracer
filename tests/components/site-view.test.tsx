/**
 * -------------------------------------------------------------------------
 * @file   site-view.test.tsx
 * @brief  Verifies the Workspace Site page view.
 *
 * @description
 *  Covers the Workspace header with Open Site and Replace Site, the hero
 *  preview with its cache-busted image and definition list, the KPI row
 *  with Visit-to-Call, the Traffic and Calls series joined by day, Top
 *  pages, Referrers, Performance thresholds, the Search panel with its
 *  score, trend, and Keyword positions, the Operator-only Hosting
 *  panel with Refresh Preview, the Client Viewer read-only view, and the
 *  No Site, Syncing, Preview pending, Cloudflare disconnected, and Down
 *  states.
 *
 * @remarks
 *  Navigation is faked at the next/navigation boundary and requests at
 *  the public HTTP boundary.
 *
 * @see
 *  components/tracer/site-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/workspaces/workspace-1/site" }));
const { refreshClientCache } = vi.hoisted(() => ({ refreshClientCache: vi.fn(async () => undefined) }));
vi.mock("@/data/client-cache", () => ({ refreshClientCache }));

import SiteView, { trafficAndCallsSeries, type SiteViewSite, type SiteViewSummary } from "@/components/tracer/site-view";
import type { AnalyticsSummary } from "@/data/analytics";
import type { SiteSearch } from "@/data/site-search";

const workspace = {
  id: "workspace-1",
  name: "Pocatello Paving",
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

const site: SiteViewSite = {
  id: "site-1",
  scriptName: "asphalt-paving-pocatello",
  primaryHostname: "pocatelloasphaltpaving.com",
  hostnames: [
    { hostname: "pocatelloasphaltpaving.com", zoneId: "zone-1", certificateId: "cert-apex", enabled: true },
    { hostname: "www.pocatelloasphaltpaving.com", zoneId: "zone-1", certificateId: "cert-www", enabled: true },
  ],
  liveVersionId: "e2e-site-version-1",
  lastDeployedAt: "2026-10-11T23:12:59.000Z",
  lastDeployment: { versionId: "e2e-site-version-1", source: "wrangler", authorEmail: "operator@example.com", deployedAt: "2026-10-11T23:12:59.000Z" },
  deployments: [
    { versionId: "e2e-site-version-1", source: "wrangler", authorEmail: "operator@example.com", deployedAt: "2026-10-11T23:12:59.000Z" },
    { versionId: "e2e-site-version-0", source: "dash", authorEmail: null, deployedAt: "2026-10-01T09:00:00.000Z" },
  ],
  latestPreview: { versionId: "e2e-site-version-1", capturedAt: "2026-10-18T13:00:00.000Z" },
  latestCheck: { checkedAt: "2026-10-18T15:04:05.000Z", ok: true, statusCode: 200, responseMs: 312 },
  uptime30d: { ratio: 0.992, medianResponseMs: 184, checks: 720 },
  health: "Healthy",
  healthReason: null,
  lastSyncedAt: "2026-10-18T15:00:00.000Z",
  linkedAt: "2026-10-01T00:00:00.000Z",
};

const summary: SiteViewSummary = {
  visits: 1234,
  pageViews: 2468,
  requests: 9000,
  errors: 12,
  topPaths: [["/", 900], ["/services", 450]],
  referrers: [["", 700], ["www.google.com", 300]],
  devices: [["mobile", 860], ["desktop", 374]],
  vitals: { lcpMs: 1200, inpMs: 250, cls: 0.02 },
  daily: [
    { day: "2026-10-17", visits: 600, pageViews: 1200 },
    { day: "2026-10-18", visits: 634, pageViews: 1268 },
  ],
};

const analytics: AnalyticsSummary = {
  timeZone: "America/Chicago",
  workspace: { id: "workspace-1", name: "Pocatello Paving" },
  window: { from: "2026-10-17", to: "2026-10-18" },
  previousWindow: { from: "2026-10-15", to: "2026-10-16" },
  kpis: {
    totalCalls: { value: 17, comparison: { previous: 6, change: 11 / 6, unit: "relative" } },
    answerRate: { value: 0.5, comparison: { previous: null, change: null, unit: "points" } },
    goodLeads: { value: 5, comparison: { previous: 2, change: 1.5, unit: "relative" } },
    averageConnectedSeconds: { value: 95, comparison: { previous: null, change: null, unit: "relative" } },
  },
  goodLeadForms: 0,
  trend: {
    interval: "day",
    points: [
      { start: "2026-10-17", end: "2026-10-17", label: "Oct 17, 2026", totalCalls: 10, answeredCalls: 5, goodLeads: 2, formSubmissions: 0 },
      { start: "2026-10-18", end: "2026-10-18", label: "Oct 18, 2026", totalCalls: 7, answeredCalls: 2, goodLeads: 3, formSubmissions: 0 },
    ],
  },
  workspacePerformance: null,
};

const range = { kind: "days" as const, days: 30 as const };

const search: SiteSearch = {
  score: 42,
  trend: Array.from({ length: 30 }, (_, index) => ({ day: new Date(Date.UTC(2026, 9, 18) - (29 - index) * 86_400_000).toISOString().slice(0, 10), score: index < 5 ? null : 61 + index })),
  keywords: [
    { id: "keyword-1", phrase: "asphalt paving pocatello", weight: 5, position: 2, change7d: 3, rankingUrl: "https://pocatelloasphaltpaving.com/", topResults: [{ position: 1, domain: "www.idahopaving.example", url: "https://www.idahopaving.example/", title: "Idaho Paving" }], checkedAt: "2026-10-18T06:41:00.000Z" },
    { id: "keyword-2", phrase: "driveway paving pocatello", weight: 1, position: 14, change7d: -2, rankingUrl: "https://pocatelloasphaltpaving.com/driveways", topResults: [], checkedAt: "2026-10-18T06:41:00.000Z" },
    { id: "keyword-3", phrase: "paving contractor pocatello", weight: 2, position: 7, change7d: 0, rankingUrl: "https://pocatelloasphaltpaving.com/", topResults: [], checkedAt: "2026-10-18T06:41:00.000Z" },
    { id: "keyword-4", phrase: "sealcoating pocatello", weight: 1, position: null, change7d: null, rankingUrl: null, topResults: [], checkedAt: "2026-10-18T06:41:00.000Z" },
  ],
  serviceArea: { city: "Pocatello", region: "Idaho", country: "United States" },
  checkedAt: "2026-10-18T06:41:00.000Z",
};

function renderView(overrides: Partial<Parameters<typeof SiteView>[0]> = {}) {
  return render(<SiteView workspace={workspace} site={site} summary={summary} analytics={analytics} range={range} search={search} cloudflareConnected {...overrides} />);
}

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
  refreshClientCache.mockClear();
});

describe("SiteView", () => {
  it("renders the Workspace header with Open Site, Replace Site, and the primary hostname", () => {
    renderView();
    expect(screen.getByRole("heading", { level: 1, name: "Pocatello Paving" })).toBeVisible();
    expect(screen.getByText("Active")).toBeVisible();
    expect(screen.getByText("Tracking +14155550100")).toBeVisible();
    expect(screen.getByText("America/Chicago")).toBeVisible();
    const open = screen.getByRole("link", { name: "Open Site" });
    expect(open).toHaveAttribute("href", "https://pocatelloasphaltpaving.com");
    expect(open).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("button", { name: "Replace Site" })).toBeVisible();
  });

  it("shows the hero preview with a cache-busted image, health, uptime, last check, deploy, hostnames, and Worker name", () => {
    renderView();
    const hero = screen.getByRole("region", { name: "Site preview" });
    expect(within(hero).getByRole("img", { name: "Preview of pocatelloasphaltpaving.com" })).toHaveAttribute("src", expect.stringMatching(/\/api\/workspaces\/workspace-1\/site\/preview\?v=1792328400000$/));
    expect(within(hero).getByRole("link", { name: /Open/ })).toHaveAttribute("href", "https://pocatelloasphaltpaving.com");
    expect(within(hero).getByText("Healthy")).toBeVisible();
    expect(within(hero).getByText("Uptime, 30 days")).toBeVisible();
    expect(within(hero).getByText("99.2% · 184 ms")).toBeVisible();
    expect(within(hero).getByText("Last check")).toBeVisible();
    expect(within(hero).getByText(/200, 312 ms/)).toBeVisible();
    expect(within(hero).getByText("Oct 11, 2026, 6:12:59 PM")).toBeVisible();
    expect(within(hero).getByText("www.pocatelloasphaltpaving.com")).toBeVisible();
    expect(within(hero).getByText("asphalt-paving-pocatello")).toBeVisible();
    expect(within(hero).getByText(/^Preview captured /)).toBeVisible();
  });

  it("renders Visits, Page Views, Calls, and Visit-to-Call in the accent over the range", () => {
    renderView();
    const tile = (name: string) => within(screen.getByRole("group", { name }));
    expect(tile("Visits").getByText("1,234")).toBeVisible();
    expect(tile("Page Views").getByText("2,468")).toBeVisible();
    expect(tile("Calls").getByText("17")).toBeVisible();
    const funnel = tile("Visit-to-Call").getByText("1.4%");
    expect(funnel).toHaveClass("text-[var(--chart-1)]");
  });

  it("changes the range in the URL like the Overview", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "7 Days" }));
    expect(router.push).toHaveBeenCalledWith("/workspaces/workspace-1/site?range=7d", { scroll: false });
  });

  it("joins Visits and Calls by period for the Traffic and Calls chart", () => {
    expect(trafficAndCallsSeries(summary.daily, analytics.trend)).toEqual([
      { start: "2026-10-17", label: "Oct 17, 2026", visits: 600, calls: 10 },
      { start: "2026-10-18", label: "Oct 18, 2026", visits: 634, calls: 7 },
    ]);
    expect(
      trafficAndCallsSeries(summary.daily, { interval: "week", points: [{ start: "2026-10-12", end: "2026-10-18", label: "Oct 12 - Oct 18, 2026", totalCalls: 17, answeredCalls: 7, goodLeads: 5, formSubmissions: 0 }] }),
    ).toEqual([{ start: "2026-10-12", label: "Oct 12 - Oct 18, 2026", visits: 1234, calls: 17 }]);
    renderView();
    const table = within(screen.getByRole("region", { name: "Traffic and Calls" })).getByRole("table", { name: "Traffic and Calls by day" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Period", "Visits", "Calls"]);
    expect(within(table).getByRole("row", { name: /Oct 18, 2026/ })).toHaveTextContent("634");
    expect(within(table).getByRole("row", { name: /Oct 18, 2026/ })).toHaveTextContent("7");
  });

  it("lists Top pages and Referrers with direct traffic and the device split", () => {
    renderView();
    const pages = screen.getByRole("region", { name: "Top pages" });
    expect(within(pages).getByText("/services")).toBeVisible();
    expect(within(pages).getByText("450")).toBeVisible();
    const referrers = screen.getByRole("region", { name: "Referrers" });
    expect(within(referrers).getByText("(direct)")).toBeVisible();
    expect(within(referrers).getByText("www.google.com")).toBeVisible();
    expect(within(referrers).getByText("mobile 70%, desktop 30%")).toBeVisible();
  });

  it("grades Core Web Vitals at the Good thresholds", () => {
    renderView();
    const performance = screen.getByRole("region", { name: "Performance" });
    const lcp = within(performance).getByRole("group", { name: "Largest Contentful Paint" });
    expect(within(lcp).getByText("1.2 s")).toBeVisible();
    expect(within(lcp).getByText("Good")).toBeVisible();
    const inp = within(performance).getByRole("group", { name: "Interaction to Next Paint" });
    expect(within(inp).getByText("250 ms")).toBeVisible();
    expect(within(inp).getByText("Needs work")).toBeVisible();
    const cls = within(performance).getByRole("group", { name: "Cumulative Layout Shift" });
    expect(within(cls).getByText("0.02")).toBeVisible();
    expect(within(cls).getByText("Good")).toBeVisible();
  });

  it("renders the Search panel with the score, the 30-day trend, and Keyword positions with their 7-day change", () => {
    renderView();
    const panel = screen.getByRole("region", { name: "Search" });
    expect(within(panel).getByText("42")).toBeVisible();
    expect(within(panel).getByText("/100")).toBeVisible();
    expect(within(panel).getByText(/Pocatello, Idaho, United States/)).toBeVisible();
    expect(within(panel).getByText(/Checked Oct 18, 2026/)).toBeVisible();
    const trend = within(panel).getByRole("table", { name: "Search Visibility by day" });
    expect(within(trend).getAllByRole("row")).toHaveLength(31);
    expect(within(trend).getByRole("row", { name: /Oct 18, 2026/ })).toHaveTextContent("90");
    const table = within(panel).getByRole("table", { name: "Keywords" });
    const rows = within(table).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["asphalt paving pocatello", "5", "2", "+3"],
      ["driveway paving pocatello", "1", "14", "-2"],
      ["paving contractor pocatello", "2", "7", "0"],
      ["sealcoating pocatello", "1", "Not ranking", "-"],
    ]);
    expect(within(table).getByText("+3")).toBeVisible();
    expect(within(table).getByText("-2")).toBeVisible();
    expect(within(table).getByText("0")).toHaveClass("text-muted-foreground");
    expect(within(table).getByText("Not ranking")).toHaveClass("text-muted-foreground");
    expect(within(table).getByRole("link", { name: "asphalt paving pocatello" })).toHaveAttribute("href", "https://pocatelloasphaltpaving.com/");
  });

  it("shows No rankings yet with a Keywords link for Operators before any check and a Retry when Search is unavailable", () => {
    renderView({ search: { ...search, score: null, checkedAt: null, trend: search.trend.map((point) => ({ ...point, score: null })), keywords: [] } });
    const panel = screen.getByRole("region", { name: "Search" });
    expect(within(panel).getByText("No rankings yet")).toBeVisible();
    expect(within(panel).getByRole("link", { name: "Keywords" })).toHaveAttribute("href", "/workspaces/workspace-1/settings/site");
    cleanup();
    renderView({ readOnly: true, search: { ...search, score: null, checkedAt: null, keywords: [] } });
    expect(within(screen.getByRole("region", { name: "Search" })).queryByRole("link", { name: "Keywords" })).not.toBeInTheDocument();
    cleanup();
    renderView({ search: null });
    expect(within(screen.getByRole("region", { name: "Search" })).getByRole("alert")).toHaveTextContent("Search rankings are unavailable.");
  });

  it("shows the Operator Hosting panel with requests, errors, certificates, deployments, and Refresh Preview", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 202 }));
    vi.stubGlobal("fetch", fetch);
    renderView();
    const hosting = screen.getByRole("region", { name: "Hosting" });
    expect(within(hosting).getByText("9,000")).toBeVisible();
    expect(within(hosting).getByText("12")).toBeVisible();
    expect(within(hosting).getByText("2 certificates")).toBeVisible();
    const deployments = within(hosting).getAllByRole("listitem");
    expect(deployments).toHaveLength(2);
    expect(deployments[0]).toHaveTextContent("e2e-site");
    expect(deployments[0]).toHaveTextContent("wrangler");
    expect(within(deployments[0]).getByText("Live")).toBeVisible();
    expect(deployments[1]).toHaveTextContent("dash");
    expect(deployments[1]).toHaveTextContent("Oct 1, 2026, 4:00:00 AM");
    expect(within(deployments[1]).queryByText("Live")).not.toBeInTheDocument();
    fireEvent.click(within(hosting).getByRole("button", { name: "Refresh Preview" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/workspaces/workspace-1/site/preview/refresh", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(refreshClientCache).toHaveBeenCalled());
    expect(await within(hosting).findByRole("status")).toHaveTextContent("Preview refresh requested.");
  });

  it("hides Hosting, Replace Site, and the Worker name from a Client Viewer", () => {
    const viewerSite: SiteViewSite = {
      id: site.id,
      primaryHostname: site.primaryHostname,
      hostnames: site.hostnames.slice(0, 1),
      lastDeployedAt: site.lastDeployedAt,
      latestPreview: { versionId: null, capturedAt: site.latestPreview!.capturedAt },
      latestCheck: site.latestCheck,
      uptime30d: site.uptime30d,
      health: site.health,
      healthReason: null,
      lastSyncedAt: site.lastSyncedAt,
      linkedAt: site.linkedAt,
    };
    const viewerSummary: SiteViewSummary = { visits: summary.visits, pageViews: summary.pageViews, topPaths: summary.topPaths, referrers: summary.referrers, devices: summary.devices, vitals: summary.vitals, daily: summary.daily };
    renderView({ readOnly: true, site: viewerSite, summary: viewerSummary });
    expect(screen.getAllByText("pocatelloasphaltpaving.com").length).toBeGreaterThan(0);
    expect(screen.queryByText("www.pocatelloasphaltpaving.com")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Hosting" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replace Site" })).not.toBeInTheDocument();
    expect(screen.queryByText("asphalt-paving-pocatello")).not.toBeInTheDocument();
    expect(screen.getByText("99.2% · 184 ms")).toBeVisible();
    expect(screen.getByRole("group", { name: "Visits" })).toBeVisible();
  });

  it("shows the No Site state with Link Site for an Operator and an explanation for a Client Viewer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ sites: [], total: 0, page: 1, pageSize: 5 }), { status: 200 })));
    renderView({ site: null, summary: null });
    expect(screen.getByText("No Site is linked to this Workspace")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Link Site" }));
    expect(await screen.findByRole("heading", { name: "Link Site" })).toBeVisible();
    cleanup();
    renderView({ site: null, summary: null, readOnly: true });
    expect(screen.getByText("No Site is linked to this Workspace")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Link Site" })).not.toBeInTheDocument();
  });

  it("shows Skeleton tiles with First sync in progress before the first sync", () => {
    const { container } = renderView({ site: { ...site, lastSyncedAt: null, health: "Unknown", latestPreview: null, latestCheck: null, uptime30d: { ratio: null, medianResponseMs: null, checks: 0 } }, summary: null });
    expect(screen.getByText("First sync in progress")).toBeVisible();
    expect(screen.getByText("No checks yet")).toBeVisible();
    expect(screen.getByText("No check yet")).toBeVisible();
    expect(container.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Visits" })).not.toBeInTheDocument();
  });

  it("shows Preview pending while no capture exists", () => {
    renderView({ site: { ...site, latestPreview: null } });
    expect(screen.getByText("Preview pending")).toBeVisible();
    expect(screen.queryByRole("img", { name: /Preview of/ })).not.toBeInTheDocument();
  });

  it("warns when Cloudflare is disconnected and links Operators to Integrations", () => {
    renderView({ cloudflareConnected: false });
    const warning = screen.getByRole("alert");
    expect(warning).toHaveTextContent("Cloudflare is disconnected. Showing the last synced data.");
    expect(within(warning).getByRole("link", { name: "Integrations" })).toHaveAttribute("href", "/integrations");
  });

  it("reads Down with the reason and the last check time", () => {
    renderView({
      site: { ...site, health: "Down", healthReason: "The last two checks failed.", latestCheck: { checkedAt: "2026-10-18T15:04:05.000Z", ok: false, statusCode: 503, responseMs: 900 } },
    });
    const hero = screen.getByRole("region", { name: "Site preview" });
    expect(within(hero).getByText("Down")).toBeVisible();
    expect(within(hero).getByText("The last two checks failed.")).toBeVisible();
    expect(within(hero).getByText(/Oct 18, 2026, 10:04:05 AM/)).toBeVisible();
  });

  it("shows a Retry when the traffic summary is unavailable", () => {
    renderView({ summary: null });
    expect(screen.getByRole("alert")).toHaveTextContent("Site traffic is unavailable.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(router.refresh).toHaveBeenCalled();
  });
});

const money = {
  month: "October 2026",
  workspaceId: "workspace-1",
  telephonyCents: 368,
  processingCents: 147,
  hostingCents: 250,
  searchCents: 5,
  domainCents: 108,
  costCents: 878,
  revenueCents: 5000,
  profitCents: 4122,
  goodLeads: 2,
  costPerGoodLeadCents: 439,
  deal: { id: "deal-1", workspaceId: "workspace-1", kind: "Per Lead" as const, amountCents: 2500, startedOn: "2026-10-01", endedOn: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" },
};

describe("SiteView Deal and cost", () => {
  it("shows the Deal, cost, and profit per month with what cost includes, edits the Deal, and ends it", async () => {
    const fetch = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (url === "/api/workspaces/workspace-1/deal/deal-1" && init?.method === "PATCH") return new Response(JSON.stringify({ deal: { ...money.deal, ...body } }), { status: 200 });
      if (url === "/api/workspaces/workspace-1/deal/deal-1/end" && init?.method === "POST") return new Response(JSON.stringify({ deal: { ...money.deal, endedOn: body.endedOn } }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    renderView({ money });
    const panel = screen.getByRole("region", { name: "Deal and cost" });
    expect(within(panel).getByText("Deal").closest("div")).toHaveTextContent("Per Lead, $25.00 per Good Lead, since Oct 1, 2026");
    expect(within(panel).getByText("Cost").closest("div")).toHaveTextContent("$8.78");
    expect(within(panel).getByText("$41.22")).toHaveClass("text-success");
    expect(within(panel).getByText(/Cost includes/)).toHaveTextContent("Cost includes Telephony $3.68, Processing $1.47, Hosting $2.50, Search $0.05, and Domain $1.08 for October 2026, at $4.39 per Good Lead.");
    expect(within(panel).getByRole("link", { name: "Pricing guide" })).toHaveAttribute("href", "/pricing");

    fireEvent.click(within(panel).getByRole("button", { name: "Edit Deal" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Deal" });
    expect(within(dialog).getByRole("combobox", { name: "Deal kind" })).toHaveTextContent("Per Lead");
    expect(within(dialog).getByLabelText("Amount")).toHaveValue(25);
    expect(within(dialog).getByLabelText("Start date")).toHaveValue("2026-10-01");
    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "30" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Deal" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/workspaces/workspace-1/deal/deal-1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ kind: "Per Lead", amountCents: 3000, startedOn: "2026-10-01" }) })));
    await waitFor(() => expect(within(panel).getByText("Deal").closest("div")).toHaveTextContent("$30.00 per Good Lead"));
    expect(refreshClientCache).toHaveBeenCalled();

    fireEvent.click(within(panel).getByRole("button", { name: "End Deal" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.change(within(confirm).getByLabelText("End date"), { target: { value: "2026-10-31" } });
    fireEvent.click(within(confirm).getByRole("button", { name: "End Deal" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/workspaces/workspace-1/deal/deal-1/end", expect.objectContaining({ method: "POST", body: JSON.stringify({ endedOn: "2026-10-31" }) })));
    await waitFor(() => expect(within(panel).getByText("Deal").closest("div")).toHaveTextContent("No Deal"));
    expect(within(panel).getByRole("button", { name: "Add Deal" })).toBeVisible();
  });

  it("shows a negative profit in the destructive color and adds a Deal when none is open", async () => {
    const fetch = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (String(request) === "/api/workspaces/workspace-1/deal" && init?.method === "POST") return new Response(JSON.stringify({ deal: { id: "deal-2", workspaceId: "workspace-1", ...body, endedOn: null, createdAt: "", updatedAt: "" } }), { status: 201 });
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    renderView({ money: { ...money, deal: null, revenueCents: 0, profitCents: -878, goodLeads: 0, costPerGoodLeadCents: null } });
    const panel = screen.getByRole("region", { name: "Deal and cost" });
    expect(within(panel).getByText("-$8.78")).toHaveClass("text-destructive");
    expect(within(panel).getByText(/Cost includes/)).toHaveTextContent("for October 2026.");
    expect(within(panel).queryByRole("button", { name: "End Deal" })).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Add Deal" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Deal" });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Deal kind" }));
    const option = await screen.findByRole("option", { name: "Monthly" });
    option.focus();
    fireEvent.keyDown(option, { key: "Enter" });
    fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "500" } });
    fireEvent.change(within(dialog).getByLabelText("Start date"), { target: { value: "2026-10-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Deal" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/workspaces/workspace-1/deal", expect.objectContaining({ method: "POST", body: JSON.stringify({ kind: "Monthly", amountCents: 50000, startedOn: "2026-10-01" }) })));
    await waitFor(() => expect(within(panel).getByText("Deal").closest("div")).toHaveTextContent("Monthly, $500.00 per month, since Oct 1, 2026"));
  });

  it("hides Deal and cost from a Client Viewer and shows Retry when the money region fails", () => {
    renderView({ readOnly: true });
    expect(screen.queryByRole("region", { name: "Deal and cost" })).not.toBeInTheDocument();
    cleanup();
    renderView({ money: null });
    expect(within(screen.getByRole("region", { name: "Deal and cost" })).getByRole("alert")).toHaveTextContent("Cost and revenue are unavailable.");
  });
});
