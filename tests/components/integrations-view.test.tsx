/**
 * -------------------------------------------------------------------------
 * @file   integrations-view.test.tsx
 * @brief  Verifies the Operator Integrations page interactions.
 *
 * @description
 *  Covers provider health including unfinished media cleanup, Twilio
 *  credential actions, number inventory, the Cloudflare and DataForSEO
 *  connections, and platform provider test feedback through the public
 *  fetch boundary.
 *
 * @remarks
 *  Network calls are faked only at the public HTTP boundary.
 *
 * @see
 *  components/tracer/integrations-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CloudflareConnectionRecord, CloudflareSiteListEntry } from "@/data/cloudflare-connection";
import type { DataForSeoConnectionRecord } from "@/data/dataforseo-connection";
import type { TwilioConnectionRecord, TwilioNumberRecord } from "@/data/integrations";
import type { ProviderHealth } from "@/data/provider-health";
import IntegrationsView from "@/components/tracer/integrations-view";

const accountSid = "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const apiKeySid = "SK11111111111111111111111111111111";
const secret = "component-only-secret";

const providers: ProviderHealth[] = [
  { id: "twilio", name: "Twilio", state: "not_configured", identifier: null, lastSuccessAt: null, lastFailureAt: null, lastFailureDetail: null, testable: false, note: "No Organization Twilio credential is connected" },
  { id: "cloudflare", name: "Cloudflare", state: "not_configured", identifier: null, lastSuccessAt: null, lastFailureAt: null, lastFailureDetail: null, testable: false, note: "No Organization Cloudflare credential is connected" },
  { id: "dataforseo", name: "DataForSEO", state: "not_configured", identifier: null, lastSuccessAt: null, lastFailureAt: null, lastFailureDetail: null, testable: false, note: "No Organization DataForSEO credential is connected" },
  { id: "hyperdrive", name: "Hyperdrive", state: "configured", identifier: "HYPERDRIVE", lastSuccessAt: null, lastFailureAt: null, lastFailureDetail: null, testable: true, note: null },
  { id: "email", name: "Cloudflare Email Service", state: "configured", identifier: "auth@example.com", lastSuccessAt: null, lastFailureAt: null, lastFailureDetail: null, testable: true, note: null },
  { id: "r2", name: "Cloudflare R2", state: "not_configured", identifier: "R2", lastSuccessAt: null, lastFailureAt: null, lastFailureDetail: null, testable: false, note: "Test Connection arrives with its milestone" },
  { id: "openai", name: "OpenAI", state: "not_configured", identifier: "OPENAI_API_KEY", lastSuccessAt: null, lastFailureAt: null, lastFailureDetail: null, testable: false, note: "Test Connection arrives with its milestone" },
  { id: "triggerdev", name: "Trigger.dev", state: "not_configured", identifier: "TRIGGER_SECRET_KEY", lastSuccessAt: null, lastFailureAt: null, lastFailureDetail: null, testable: false, note: "Test Connection arrives with its milestone" },
];

const connected: TwilioConnectionRecord = {
  accountSid,
  apiKeySid,
  authTokenConfigured: true,
  accountFriendlyName: "Tracer Account",
  connectedAt: "2026-10-14T00:00:00.000Z",
  connectedBy: { id: "operator", name: "Example Operator" },
  lastVerifiedAt: "2026-10-14T01:00:00.000Z",
  lastFailureAt: null,
  lastFailureDetail: null,
  numbersSyncedAt: "2026-10-14T02:00:00.000Z",
  numberCount: 2,
};

const numbers: TwilioNumberRecord[] = [
  { id: "number-1", twilioSid: "PN11111111111111111111111111111111", phoneNumber: "+14155552671", friendlyName: "Support", voiceCapable: true, voiceUrl: null, voiceMethod: "POST", firstSeenAt: "2026-10-14T00:00:00.000Z", lastSeenAt: "2026-10-14T02:00:00.000Z", releasedAt: null },
  { id: "number-2", twilioSid: "PN22222222222222222222222222222222", phoneNumber: "+14155552672", friendlyName: "Released Line", voiceCapable: false, voiceUrl: null, voiceMethod: null, firstSeenAt: "2026-10-14T00:00:00.000Z", lastSeenAt: "2026-10-14T01:00:00.000Z", releasedAt: "2026-10-14T02:00:00.000Z" },
];

const cloudflareAccountId = "0123456789abcdef0123456789abcdef";
const cloudflareToken = "component-only-cloudflare-token";

const cloudflareConnected: CloudflareConnectionRecord = {
  accountId: cloudflareAccountId,
  connectedAt: "2026-10-20T00:00:00.000Z",
  connectedBy: { id: "operator", name: "Example Operator" },
  lastVerifiedAt: "2026-10-20T01:00:00.000Z",
  lastFailureAt: null,
  lastFailureDetail: null,
  lastSyncedAt: "2026-10-20T02:00:00.000Z",
  siteCount: 2,
};

const sites: CloudflareSiteListEntry[] = [
  { id: "site-1", scriptName: "asphalt-paving-pocatello", primaryHostname: "pocatelloasphaltpaving.com", hostnames: [{ hostname: "pocatelloasphaltpaving.com", certificateId: "cert-1", enabled: true }, { hostname: "www.pocatelloasphaltpaving.com", certificateId: "cert-2", enabled: true }], lastDeployedAt: "2026-10-11T23:12:59.000Z", liveVersionId: "9f8e7d6c-5b4a-4321-8765-4321fedcba98", linkedWorkspace: { id: "workspace-1", name: "Pocatello Paving" }, visits30d: 1234, health: "Unknown", healthReason: null },
  { id: "site-2", scriptName: "solar-panel-sites", primaryHostname: "carsoncitysolarinstallation.com", hostnames: [{ hostname: "carsoncitysolarinstallation.com", certificateId: "cert-3", enabled: true }], lastDeployedAt: null, liveVersionId: null, linkedWorkspace: null, visits30d: 0, health: "Unknown", healthReason: null },
];

const dataforseoLogin = "operator@example.com";
const dataforseoPassword = "component-only-dataforseo-password";

const dataforseoConnected: DataForSeoConnectionRecord = {
  login: dataforseoLogin,
  connectedAt: "2026-10-20T00:00:00.000Z",
  connectedBy: { id: "operator", name: "Example Operator" },
  lastVerifiedAt: "2026-10-20T01:00:00.000Z",
  lastFailureAt: null,
  lastFailureDetail: null,
  lastCheckedAt: "2026-10-20T06:41:00.000Z",
  lookupsThisMonth: 42,
  keywordCount: 15,
};

const dataforseoConnectedProviders = providers.map((provider) => provider.id === "dataforseo" ? { ...provider, state: "connected" as const, note: null, testable: true, identifier: dataforseoLogin, lastSuccessAt: dataforseoConnected.lastVerifiedAt } : provider);

const cloudflareConnectedProviders = providers.map((provider) => provider.id === "cloudflare" ? { ...provider, state: "connected" as const, note: null, testable: true, identifier: cloudflareAccountId, lastSuccessAt: cloudflareConnected.lastVerifiedAt } : provider);

function initialData(overrides: { providers?: ProviderHealth[]; twilio?: TwilioConnectionRecord | null; numbers?: TwilioNumberRecord[]; cloudflare?: CloudflareConnectionRecord | null; sites?: CloudflareSiteListEntry[]; dataforseo?: DataForSeoConnectionRecord | null } = {}) {
  const twilio = overrides.twilio ?? null;
  const cloudflare = overrides.cloudflare ?? null;
  return { providers: overrides.providers ?? providers, twilio, numbers: overrides.numbers ?? (twilio ? numbers : []), cloudflare, sites: overrides.sites ?? (cloudflare ? sites : []), dataforseo: overrides.dataforseo ?? null };
}

type RouteValue = { body: unknown; status?: number } | Array<{ body: unknown; status?: number }>;

function fetchStub(routes: Record<string, RouteValue>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    const route = routes[key];
    if (!route) throw new Error(`Unexpected route ${key}`);
    const value = Array.isArray(route) ? route.shift() : route;
    if (!value) throw new Error(`No response remaining for ${key}`);
    return new Response(JSON.stringify(value.body), { status: value.status ?? 200 });
  });
}

function responseRoutes(overrides: { connected?: boolean; providers?: ProviderHealth[]; cloudflare?: CloudflareConnectionRecord | null; dataforseo?: DataForSeoConnectionRecord | null } = {}) {
  const connectedState = overrides.connected ?? false;
  const cloudflare = overrides.cloudflare ?? null;
  return {
    "GET /api/integrations": { body: { providers: overrides.providers ?? providers, twilio: connectedState ? connected : null, cloudflare, dataforseo: overrides.dataforseo ?? null } },
    ...(connectedState ? { "GET /api/integrations/twilio/numbers": { body: { numbers } } } : {}),
    ...(cloudflare ? { "GET /api/integrations/cloudflare/sites": { body: { sites } } } : {}),
  };
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(Element.prototype, "getAnimations", { value: () => [], configurable: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("IntegrationsView", () => {
  it("renders provider frames and only offers Connect Twilio when the master key is available", async () => {
    vi.stubGlobal("fetch", fetchStub(responseRoutes()));
    render(<IntegrationsView initial={initialData()} />);
    expect(screen.getByRole("heading", { name: "Integrations" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Twilio" })).toBeVisible();
    expect(screen.getAllByRole("region")).toHaveLength(8);
    expect(screen.getByRole("button", { name: "Connect Twilio" })).toBeVisible();
    expect(screen.getAllByText("Not configured").length).toBeGreaterThan(0);

    cleanup();
    const missingMasterKeyProviders = providers.map((provider) => provider.id === "twilio" ? { ...provider, note: "The TWILIO_CREDENTIAL_MASTER_KEY deployment secret is missing" } : provider);
    vi.stubGlobal("fetch", fetchStub(responseRoutes({ providers: missingMasterKeyProviders })));
    render(<IntegrationsView initial={initialData({ providers: missingMasterKeyProviders })} />);
    expect(await screen.findByText("The TWILIO_CREDENTIAL_MASTER_KEY deployment secret is missing")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Connect Twilio" })).not.toBeInTheDocument();
  });

  it("connects Twilio without rendering the API secret", async () => {
    const fetch = fetchStub({
      ...responseRoutes(),
      "POST /api/integrations/twilio/connect": { body: { connection: connected }, status: 201 },
      "GET /api/integrations": [{ body: { providers, twilio: null, cloudflare: null } }, { body: { providers: providers.map((provider) => provider.id === "twilio" ? { ...provider, state: "connected", note: null, testable: true, identifier: accountSid } : provider), twilio: connected, cloudflare: null } }],
      "GET /api/integrations/twilio/numbers": { body: { numbers } },
    });
    vi.stubGlobal("fetch", fetch);
    render(<IntegrationsView initial={initialData()} />);
    await screen.findByRole("button", { name: "Connect Twilio" });
    fireEvent.click(screen.getByRole("button", { name: "Connect Twilio" }));
    fireEvent.change(screen.getByLabelText("Account SID"), { target: { value: accountSid } });
    fireEvent.change(screen.getByLabelText("API Key SID"), { target: { value: apiKeySid } });
    fireEvent.change(screen.getByLabelText("API Key Secret"), { target: { value: secret } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/integrations/twilio/connect", expect.objectContaining({ method: "POST", body: JSON.stringify({ accountSid, apiKeySid, apiKeySecret: secret }) })));
    expect(await screen.findByRole("status")).toHaveTextContent("Twilio connected.");
    expect(document.body.textContent).not.toContain(secret);
  });

  it("keeps the connect dialog open after a rejected credential", async () => {
    const fetch = fetchStub({ ...responseRoutes(), "POST /api/integrations/twilio/connect": { body: { error: "authentication_failed", detail: "Twilio rejected the credential (HTTP 401)" }, status: 422 } });
    vi.stubGlobal("fetch", fetch);
    render(<IntegrationsView initial={initialData()} />);
    await screen.findByRole("button", { name: "Connect Twilio" });
    fireEvent.click(screen.getByRole("button", { name: "Connect Twilio" }));
    fireEvent.change(screen.getByLabelText("Account SID"), { target: { value: accountSid } });
    fireEvent.change(screen.getByLabelText("API Key SID"), { target: { value: apiKeySid } });
    fireEvent.change(screen.getByLabelText("API Key Secret"), { target: { value: secret } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("Twilio rejected the credential. Twilio rejected the credential (HTTP 401)")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Connect Twilio" })).toBeVisible();
  });

  it("shows connected Twilio details, numbers, test feedback, and retry", async () => {
    const connectedProviders = providers.map((provider) => provider.id === "twilio" ? { ...provider, state: "connected" as const, note: null, testable: true, identifier: accountSid } : provider);
    const fetch = fetchStub({
      ...responseRoutes({ connected: true, providers: connectedProviders }),
      "POST /api/integrations/twilio/test": [{ body: { connection: connected } }, { body: { error: "provider_unavailable", detail: "Twilio is unavailable" }, status: 502 }],
      "POST /api/integrations/twilio/sync-numbers": { body: { numbers, syncedAt: connected.numbersSyncedAt, skipped: 0 } },
      "GET /api/integrations": [{ body: { providers: connectedProviders, twilio: connected, cloudflare: null } }, { body: { providers: connectedProviders, twilio: connected, cloudflare: null } }, { body: { providers: connectedProviders, twilio: connected, cloudflare: null } }],
    });
    vi.stubGlobal("fetch", fetch);
    render(<IntegrationsView initial={initialData({ providers: connectedProviders, twilio: connected })} />);
    expect(await screen.findByText("2 eligible numbers")).toBeVisible();
    expect(screen.getByText("Available after Workspace activation")).toBeVisible();
    expect(screen.getByText("Available after call routing")).toBeVisible();
    expect(screen.getByRole("table", { name: "Twilio numbers" })).toBeVisible();
    expect(screen.getByText("+14155552671")).toBeVisible();
    expect(screen.getByText("Released")).toBeVisible();
    const twilioRegion = screen.getByRole("region", { name: "Twilio" });
    fireEvent.click(within(twilioRegion).getByRole("button", { name: "Test Connection" }));
    expect(await screen.findByText("Twilio connection verified.")).toBeVisible();
    fireEvent.click(within(twilioRegion).getByRole("button", { name: "Test Connection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Twilio test failed.");
  });

  it("saves the webhook Auth Token without rendering it", async () => {
    const authToken = "component-only-auth-token";
    const connectedProviders = providers.map((provider) => provider.id === "twilio" ? { ...provider, state: "connected" as const, note: null, testable: true, identifier: accountSid } : provider);
    const missingToken = { ...connected, authTokenConfigured: false };
    const fetch = fetchStub({
      ...responseRoutes({ connected: true, providers: connectedProviders }),
      "GET /api/integrations": [{ body: { providers: connectedProviders, twilio: missingToken, cloudflare: null } }, { body: { providers: connectedProviders, twilio: connected, cloudflare: null } }],
      "GET /api/integrations/twilio/numbers": [{ body: { numbers } }, { body: { numbers } }],
      "POST /api/integrations/twilio/auth-token": { body: { connection: connected } },
    });
    vi.stubGlobal("fetch", fetch);
    render(<IntegrationsView initial={initialData({ providers: connectedProviders, twilio: missingToken })} />);
    const twilioRegion = await screen.findByRole("region", { name: "Twilio" });
    expect(await within(twilioRegion).findByText("Not configured")).toBeVisible();
    fireEvent.click(within(twilioRegion).getByRole("button", { name: "Set Auth Token" }));
    fireEvent.change(screen.getByLabelText("Auth Token"), { target: { value: authToken } });
    fireEvent.click(screen.getByRole("button", { name: "Save Auth Token" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/integrations/twilio/auth-token", expect.objectContaining({ method: "POST", body: JSON.stringify({ authToken }) })));
    expect(await screen.findByRole("status")).toHaveTextContent("Twilio Auth Token saved.");
    expect(within(twilioRegion).getByText("Configured")).toBeVisible();
    expect(document.body.textContent).not.toContain(authToken);
  });

  it("reports blocked Twilio disconnects with the active workspace count", async () => {
    const connectedProviders = providers.map((provider) => provider.id === "twilio" ? { ...provider, state: "connected" as const, note: null, testable: true, identifier: accountSid } : provider);
    const fetch = fetchStub({ ...responseRoutes({ connected: true, providers: connectedProviders }), "POST /api/integrations/twilio/disconnect": { body: { error: "active_workspaces", activeWorkspaceCount: 2 }, status: 409 } });
    vi.stubGlobal("fetch", fetch);
    render(<IntegrationsView initial={initialData({ providers: connectedProviders, twilio: connected })} />);
    await screen.findByText("2 eligible numbers");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Disconnect" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("2 Active Workspaces");
  });

  it("tests Hyperdrive and Email inside their provider frames", async () => {
    const fetch = fetchStub({ ...responseRoutes(), "POST /api/integrations/hyperdrive/test": { body: { status: "ok", checkedAt: "2026-10-14T03:00:00.000Z" } }, "POST /api/integrations/email/test": { body: { error: "recipient_not_allowed" }, status: 409 } });
    vi.stubGlobal("fetch", fetch);
    render(<IntegrationsView initial={initialData()} />);
    await screen.findByRole("button", { name: "Test Connection" });
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
    expect(await screen.findByText(/Connection verified at/)).toBeVisible();
    const emailRegion = screen.getByRole("region", { name: "Cloudflare Email Service" });
    fireEvent.click(within(emailRegion).getByRole("button", { name: "Send Test Email" }));
    expect(await within(emailRegion).findByRole("alert")).toHaveTextContent("Your address is not on the recipient allowlist.");
  });

  it("renders server-provided Integrations immediately without a loading skeleton", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const { container } = render(<IntegrationsView initial={initialData()} />);
    expect(screen.getByRole("heading", { name: "Twilio" })).toBeVisible();
    expect(screen.getAllByRole("region")).toHaveLength(8);
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
  });

  it("keeps the server-rendered Integrations and offers Retry when refreshing fails", async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ providers, twilio: null, cloudflare: null })));
    vi.stubGlobal("fetch", fetch);
    render(<IntegrationsView initial={initialData()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Integrations could not be refreshed.");
    expect(screen.getByRole("heading", { name: "Twilio" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("shows the R2 bucket and the Recording transfer history for R2 and Trigger.dev before any transfer", async () => {
    const transferProviders = providers.map((provider) => provider.id === "r2"
      ? { ...provider, state: "configured" as const, identifier: "tracer-recordings-staging", recentFailures: [] }
      : provider.id === "triggerdev" ? { ...provider, state: "configured" as const, recentFailures: [] } : provider);
    vi.stubGlobal("fetch", fetchStub(responseRoutes({ providers: transferProviders })));
    render(<IntegrationsView initial={initialData({ providers: transferProviders })} />);
    const r2Region = await screen.findByRole("region", { name: "Cloudflare R2" });
    expect(within(r2Region).getByText("tracer-recordings-staging")).toBeVisible();
    for (const region of [r2Region, screen.getByRole("region", { name: "Trigger.dev" })]) {
      expect(within(region).getByText("Last successful Recording transfer")).toBeVisible();
      expect(within(region).getByText("No Recording transfer failures.")).toBeVisible();
      expect(within(region).queryByText("Last successful check")).not.toBeInTheDocument();
    }
  });

  it("lists recent Recording transfer failures with their stage, reason, and time on a degraded provider", async () => {
    const recentFailures = [
      { stage: "upload", reason: "R2 request failed (HTTP 503)", at: "2026-10-14T05:30:00.000Z" },
      { stage: "cleanup", reason: "Twilio request failed (HTTP 500)", at: "2026-10-14T04:30:00.000Z" },
    ];
    const failingProviders = providers.map((provider) => provider.id === "r2" || provider.id === "triggerdev"
      ? { ...provider, state: "degraded" as const, lastSuccessAt: "2026-10-14T01:00:00.000Z", lastFailureAt: recentFailures[0].at, lastFailureDetail: recentFailures[0].reason, recentFailures }
      : provider);
    vi.stubGlobal("fetch", fetchStub(responseRoutes({ providers: failingProviders })));
    render(<IntegrationsView initial={initialData({ providers: failingProviders })} />);
    const r2Region = await screen.findByRole("region", { name: "Cloudflare R2" });
    expect(within(r2Region).getByText("Degraded")).toBeVisible();
    const table = within(r2Region).getByRole("table", { name: "Recent transfer failures" });
    const rows = within(table).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
    const time = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
    expect(rows).toEqual([
      ["Upload", "R2 request failed (HTTP 503)", time(recentFailures[0].at)],
      ["Cleanup", "Twilio request failed (HTTP 500)", time(recentFailures[1].at)],
    ]);
    expect(within(r2Region).queryByText("No Recording transfer failures.")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Trigger.dev" })).getByRole("table", { name: "Recent transfer failures" })).toBeVisible();
    expect(document.body.textContent).not.toContain("organizations/");
  });

  it("shows the OpenAI models, last successful Transcript and Lead Assessment, and recent processing failures", async () => {
    const time = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
    const analysis = {
      transcriptionModel: "whisper-1",
      leadAssessmentModel: "gpt-5-mini",
      lastTranscriptAt: "2026-10-14T03:00:00.000Z",
      lastLeadAssessmentAt: "2026-10-14T03:05:00.000Z",
      failedCount: 2,
      lastFailureAt: "2026-10-14T04:00:00.000Z",
    };
    const analysisProviders = providers.map((provider) => provider.id === "openai"
      ? { ...provider, state: "degraded" as const, lastSuccessAt: analysis.lastLeadAssessmentAt, lastFailureAt: analysis.lastFailureAt, analysis }
      : provider);
    vi.stubGlobal("fetch", fetchStub(responseRoutes({ providers: analysisProviders })));
    render(<IntegrationsView initial={initialData({ providers: analysisProviders })} />);
    const region = await screen.findByRole("region", { name: "OpenAI" });
    const value = (term: string) => within(region).getByText(term, { selector: "dt" }).nextElementSibling;
    expect(value("Transcription model")).toHaveTextContent("whisper-1");
    expect(value("Lead analysis model")).toHaveTextContent("gpt-5-mini");
    expect(value("Last successful Transcript")).toHaveTextContent(time(analysis.lastTranscriptAt));
    expect(value("Last successful Lead Assessment")).toHaveTextContent(time(analysis.lastLeadAssessmentAt));
    expect(value("Recent processing failures")).toHaveTextContent("2");
    expect(value("Last failure")).toHaveTextContent(time(analysis.lastFailureAt));
    expect(within(region).queryByText("Last successful check")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Cloudflare R2" })).queryByText("Transcription model")).not.toBeInTheDocument();
  });

  it("shows no unfinished media cleanup on a healthy Trigger.dev card and lists the oldest stuck cleanups with their Call links on a degraded one", async () => {
    const time = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
    const healthyProviders = providers.map((provider) => provider.id === "triggerdev"
      ? { ...provider, state: "configured" as const, recentFailures: [], mediaLifecycle: { stuckCount: 0, oldestStuck: [] } }
      : provider);
    vi.stubGlobal("fetch", fetchStub(responseRoutes({ providers: healthyProviders })));
    render(<IntegrationsView initial={initialData({ providers: healthyProviders })} />);
    const healthy = await screen.findByRole("region", { name: "Trigger.dev" });
    expect(within(healthy).getByText("Configured")).toBeVisible();
    expect(within(healthy).getByText("Unfinished media cleanup", { selector: "dt" }).nextElementSibling).toHaveTextContent("0");
    expect(within(healthy).getByText("No unfinished media cleanup.")).toBeVisible();
    expect(within(healthy).queryByRole("table", { name: "Unfinished media cleanup" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Cloudflare R2" })).queryByText("Unfinished media cleanup")).not.toBeInTheDocument();

    cleanup();
    const oldestStuck = [
      { callId: "call-1", workspaceId: "workspace-1", workspaceName: "North Clinic", media: "Expired" as const, since: "2026-10-12T00:00:00.000Z", twilioNotConnected: false },
      { callId: "call-2", workspaceId: "workspace-2", workspaceName: "South Clinic", media: "Purged" as const, since: "2026-10-13T00:00:00.000Z", twilioNotConnected: true },
    ];
    const stuckProviders = providers.map((provider) => provider.id === "triggerdev"
      ? { ...provider, state: "degraded" as const, recentFailures: [], mediaLifecycle: { stuckCount: 7, oldestStuck } }
      : provider);
    vi.stubGlobal("fetch", fetchStub(responseRoutes({ providers: stuckProviders })));
    render(<IntegrationsView initial={initialData({ providers: stuckProviders })} />);
    const degraded = await screen.findByRole("region", { name: "Trigger.dev" });
    expect(within(degraded).getByText("Degraded")).toBeVisible();
    expect(within(degraded).getByText("Unfinished media cleanup", { selector: "dt" }).nextElementSibling).toHaveTextContent("7");
    const table = within(degraded).getByRole("table", { name: "Unfinished media cleanup" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual([
      ["View Call", "North Clinic", "Expired", time(oldestStuck[0].since), "Retried by the daily sweep"],
      ["View Call", "South Clinic", "Purged", time(oldestStuck[1].since), "Twilio is not connected"],
    ]);
    expect(within(rows[0]).getByRole("link", { name: "View Call" })).toHaveAttribute("href", "/workspaces/workspace-1/calls/call-1");
    expect(within(rows[1]).getByRole("link", { name: "View Call" })).toHaveAttribute("href", "/workspaces/workspace-2/calls/call-2");
    expect(within(degraded).queryByText("No unfinished media cleanup.")).not.toBeInTheDocument();
  });

  it("connects Cloudflare from a dialog that names the token permissions and never renders the token", async () => {
    const fetch = fetchStub({
      ...responseRoutes(),
      "POST /api/integrations/cloudflare/connect": { body: { connection: cloudflareConnected }, status: 201 },
      "GET /api/integrations": [{ body: { providers, twilio: null, cloudflare: null } }, { body: { providers: cloudflareConnectedProviders, twilio: null, cloudflare: cloudflareConnected } }],
      "GET /api/integrations/cloudflare/sites": { body: { sites } },
    });
    vi.stubGlobal("fetch", fetch);
    render(<IntegrationsView initial={initialData()} />);
    const region = await screen.findByRole("region", { name: "Cloudflare" });
    fireEvent.click(within(region).getByRole("button", { name: "Connect Cloudflare" }));
    const dialog = screen.getByRole("dialog", { name: "Connect Cloudflare" });
    expect(within(dialog).getByRole("link", { name: /API tokens/ })).toHaveAttribute("href", "https://dash.cloudflare.com/profile/api-tokens");
    for (const permission of ["Workers Scripts Read", "Workers Custom Domains Read", "Account Analytics Read", "Browser Rendering Edit"]) {
      expect(within(dialog).getByText(permission)).toBeVisible();
    }
    fireEvent.change(screen.getByLabelText("Account ID"), { target: { value: cloudflareAccountId } });
    fireEvent.change(screen.getByLabelText("API Token"), { target: { value: cloudflareToken } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/integrations/cloudflare/connect", expect.objectContaining({ method: "POST", body: JSON.stringify({ accountId: cloudflareAccountId, apiToken: cloudflareToken }) })));
    expect(await screen.findByRole("status")).toHaveTextContent("Cloudflare connected.");
    expect(document.body.textContent).not.toContain(cloudflareToken);
    expect(await within(region).findByText("pocatelloasphaltpaving.com")).toBeVisible();
  });

  it("shows the connected Cloudflare account, its Sites with link state, and test and sync feedback", async () => {
    const fetch = fetchStub({
      ...responseRoutes({ providers: cloudflareConnectedProviders, cloudflare: cloudflareConnected }),
      "GET /api/integrations": [{ body: { providers: cloudflareConnectedProviders, twilio: null, cloudflare: cloudflareConnected } }, { body: { providers: cloudflareConnectedProviders, twilio: null, cloudflare: cloudflareConnected } }, { body: { providers: cloudflareConnectedProviders, twilio: null, cloudflare: cloudflareConnected } }],
      "GET /api/integrations/cloudflare/sites": [{ body: { sites } }, { body: { sites } }, { body: { sites } }],
      "POST /api/integrations/cloudflare/test": { body: { connection: cloudflareConnected } },
      "POST /api/integrations/cloudflare/sync": { body: { siteCount: 2, syncedAt: cloudflareConnected.lastSyncedAt } },
    });
    vi.stubGlobal("fetch", fetch);
    render(<IntegrationsView initial={initialData({ providers: cloudflareConnectedProviders, cloudflare: cloudflareConnected })} />);
    const region = await screen.findByRole("region", { name: "Cloudflare" });
    const time = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
    const value = (term: string) => within(region).getByText(term, { selector: "dt" }).nextElementSibling;
    expect(value("Account ID")).toHaveTextContent(cloudflareAccountId);
    expect(value("Connected by")).toHaveTextContent("Example Operator");
    expect(value("Last verified")).toHaveTextContent(time(cloudflareConnected.lastVerifiedAt!));
    expect(value("Last sync")).toHaveTextContent(time(cloudflareConnected.lastSyncedAt!));
    const table = within(region).getByRole("table", { name: "Sites" });
    const rows = within(table).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["No preview", "pocatelloasphaltpaving.com", "Unknown", time(sites[0].lastDeployedAt!), "1,234", "Linked to Pocatello Paving"],
      ["No preview", "carsoncitysolarinstallation.com", "Unknown", "Never", "0", "Not linked"],
    ]);
    expect(within(region).queryByText("asphalt-paving-pocatello")).not.toBeInTheDocument();
    fireEvent.click(within(region).getByRole("button", { name: "Test Connection" }));
    expect(await screen.findByText("Cloudflare connection verified.")).toBeVisible();
    fireEvent.click(within(region).getByRole("button", { name: "Sync now" }));
    expect(await screen.findByText("Synced 2 Sites.")).toBeVisible();
    expect(fetch).toHaveBeenCalledWith("/api/integrations/cloudflare/sync", expect.objectContaining({ method: "POST" }));
  });

  it("rotates the Cloudflare token and reports blocked disconnects with the open Site Link count", async () => {
    const fetch = fetchStub({
      ...responseRoutes({ providers: cloudflareConnectedProviders, cloudflare: cloudflareConnected }),
      "GET /api/integrations": [{ body: { providers: cloudflareConnectedProviders, twilio: null, cloudflare: cloudflareConnected } }, { body: { providers: cloudflareConnectedProviders, twilio: null, cloudflare: cloudflareConnected } }],
      "GET /api/integrations/cloudflare/sites": [{ body: { sites } }, { body: { sites } }],
      "POST /api/integrations/cloudflare/rotate": { body: { connection: cloudflareConnected } },
      "POST /api/integrations/cloudflare/disconnect": { body: { error: "active_site_links", activeSiteLinkCount: 2 }, status: 409 },
    });
    vi.stubGlobal("fetch", fetch);
    render(<IntegrationsView initial={initialData({ providers: cloudflareConnectedProviders, cloudflare: cloudflareConnected })} />);
    const region = await screen.findByRole("region", { name: "Cloudflare" });
    fireEvent.click(within(region).getByRole("button", { name: "Rotate Token" }));
    fireEvent.change(screen.getByLabelText("API Token"), { target: { value: cloudflareToken } });
    fireEvent.click(screen.getAllByRole("button", { name: "Rotate Token" }).at(-1)!);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/integrations/cloudflare/rotate", expect.objectContaining({ method: "POST", body: JSON.stringify({ apiToken: cloudflareToken }) })));
    expect(await screen.findByRole("status")).toHaveTextContent("Cloudflare token rotated.");
    expect(document.body.textContent).not.toContain(cloudflareToken);
    fireEvent.click(within(region).getByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Disconnect" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Disconnect is blocked while 2 Site Links are open.");
  });

  it("connects DataForSEO from a dialog with a login and password and never renders the password", async () => {
    const fetch = fetchStub({
      ...responseRoutes(),
      "GET /api/integrations": [{ body: { providers, twilio: null, cloudflare: null, dataforseo: null } }, { body: { providers: dataforseoConnectedProviders, twilio: null, cloudflare: null, dataforseo: dataforseoConnected } }],
      "POST /api/integrations/dataforseo/connect": { body: { connection: dataforseoConnected }, status: 201 },
    });
    vi.stubGlobal("fetch", fetch);
    render(<IntegrationsView initial={initialData()} />);
    const region = await screen.findByRole("region", { name: "DataForSEO" });
    fireEvent.click(within(region).getByRole("button", { name: "Connect DataForSEO" }));
    const dialog = screen.getByRole("dialog", { name: "Connect DataForSEO" });
    fireEvent.change(within(dialog).getByLabelText("API login"), { target: { value: dataforseoLogin } });
    fireEvent.change(within(dialog).getByLabelText("API password"), { target: { value: dataforseoPassword } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/integrations/dataforseo/connect", expect.objectContaining({ method: "POST", body: JSON.stringify({ login: dataforseoLogin, password: dataforseoPassword }) })));
    expect(await screen.findByRole("status")).toHaveTextContent("DataForSEO connected.");
    expect(document.body.textContent).not.toContain(dataforseoPassword);
    expect(await within(region).findByText("15")).toBeVisible();
  });

  it("shows the connected DataForSEO login, last check, lookups this month, Keywords tracked, and test feedback", async () => {
    const fetch = fetchStub({
      ...responseRoutes({ providers: dataforseoConnectedProviders, dataforseo: dataforseoConnected }),
      "GET /api/integrations": [{ body: { providers: dataforseoConnectedProviders, twilio: null, cloudflare: null, dataforseo: dataforseoConnected } }, { body: { providers: dataforseoConnectedProviders, twilio: null, cloudflare: null, dataforseo: dataforseoConnected } }],
      "POST /api/integrations/dataforseo/test": { body: { error: "provider_unavailable", detail: "DataForSEO request failed (HTTP 503)" }, status: 502 },
    });
    vi.stubGlobal("fetch", fetch);
    render(<IntegrationsView initial={initialData({ providers: dataforseoConnectedProviders, dataforseo: dataforseoConnected })} />);
    const region = await screen.findByRole("region", { name: "DataForSEO" });
    const time = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
    const value = (term: string) => within(region).getByText(term, { selector: "dt" }).nextElementSibling;
    expect(value("API login")).toHaveTextContent(dataforseoLogin);
    expect(value("Connected by")).toHaveTextContent("Example Operator");
    expect(value("Last verified")).toHaveTextContent(time(dataforseoConnected.lastVerifiedAt!));
    expect(value("Last check")).toHaveTextContent(time(dataforseoConnected.lastCheckedAt!));
    expect(value("Lookups this month")).toHaveTextContent("42");
    expect(value("Keywords tracked")).toHaveTextContent("15");
    expect(within(region).queryByRole("button", { name: "Connect DataForSEO" })).not.toBeInTheDocument();
    fireEvent.click(within(region).getByRole("button", { name: "Test Connection" }));
    expect(await within(region).findByRole("alert")).toHaveTextContent("DataForSEO test failed. DataForSEO request failed (HTTP 503)");
    expect(within(region).getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("rotates the DataForSEO password and disconnects after confirmation", async () => {
    const fetch = fetchStub({
      ...responseRoutes({ providers: dataforseoConnectedProviders, dataforseo: dataforseoConnected }),
      "GET /api/integrations": [
        { body: { providers: dataforseoConnectedProviders, twilio: null, cloudflare: null, dataforseo: dataforseoConnected } },
        { body: { providers: dataforseoConnectedProviders, twilio: null, cloudflare: null, dataforseo: dataforseoConnected } },
        { body: { providers, twilio: null, cloudflare: null, dataforseo: null } },
      ],
      "POST /api/integrations/dataforseo/rotate": { body: { connection: dataforseoConnected } },
      "POST /api/integrations/dataforseo/disconnect": { body: { disconnected: true } },
    });
    vi.stubGlobal("fetch", fetch);
    render(<IntegrationsView initial={initialData({ providers: dataforseoConnectedProviders, dataforseo: dataforseoConnected })} />);
    const region = await screen.findByRole("region", { name: "DataForSEO" });
    fireEvent.click(within(region).getByRole("button", { name: "Rotate Password" }));
    fireEvent.change(screen.getByLabelText("API password"), { target: { value: dataforseoPassword } });
    fireEvent.click(screen.getAllByRole("button", { name: "Rotate Password" }).at(-1)!);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/integrations/dataforseo/rotate", expect.objectContaining({ method: "POST", body: JSON.stringify({ password: dataforseoPassword }) })));
    expect(await screen.findByRole("status")).toHaveTextContent("DataForSEO password rotated.");
    expect(document.body.textContent).not.toContain(dataforseoPassword);
    fireEvent.click(within(region).getByRole("button", { name: "Disconnect" }));
    expect(screen.getByRole("alertdialog", { name: "Disconnect DataForSEO?" })).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: "Disconnect" }).at(-1)!);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/integrations/dataforseo/disconnect", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByRole("status")).toHaveTextContent("DataForSEO disconnected.");
    expect(await within(region).findByRole("button", { name: "Connect DataForSEO" })).toBeVisible();
  });
});
