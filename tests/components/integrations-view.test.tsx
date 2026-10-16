/**
 * -------------------------------------------------------------------------
 * @file   integrations-view.test.tsx
 * @brief  Verifies the Operator Integrations page interactions.
 *
 * @description
 *  Covers provider health, Twilio credential actions, number inventory, and
 *  platform provider test feedback through the public fetch boundary.
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

import type { TwilioConnectionRecord, TwilioNumberRecord } from "@/data/integrations";
import type { ProviderHealth } from "@/data/provider-health";
import IntegrationsView from "@/components/tracer/integrations-view";

const accountSid = "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const apiKeySid = "SK11111111111111111111111111111111";
const secret = "component-only-secret";

const providers: ProviderHealth[] = [
  { id: "twilio", name: "Twilio", state: "not_configured", identifier: null, lastSuccessAt: null, lastFailureAt: null, lastFailureDetail: null, testable: false, note: "No Organization Twilio credential is connected" },
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

function responseRoutes(overrides: { connected?: boolean; providers?: ProviderHealth[] } = {}) {
  const connectedState = overrides.connected ?? false;
  return {
    "GET /api/integrations": { body: { providers: overrides.providers ?? providers, twilio: connectedState ? connected : null } },
    ...(connectedState ? { "GET /api/integrations/twilio/numbers": { body: { numbers } } } : {}),
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
    render(<IntegrationsView />);
    expect(screen.getByRole("heading", { name: "Integrations" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "Twilio" })).toBeVisible();
    expect(screen.getAllByRole("region")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Connect Twilio" })).toBeVisible();
    expect(screen.getAllByText("Not configured").length).toBeGreaterThan(0);

    cleanup();
    const missingMasterKeyProviders = providers.map((provider) => provider.id === "twilio" ? { ...provider, note: "The TWILIO_CREDENTIAL_MASTER_KEY deployment secret is missing" } : provider);
    vi.stubGlobal("fetch", fetchStub(responseRoutes({ providers: missingMasterKeyProviders })));
    render(<IntegrationsView />);
    expect(await screen.findByText("The TWILIO_CREDENTIAL_MASTER_KEY deployment secret is missing")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Connect Twilio" })).not.toBeInTheDocument();
  });

  it("connects Twilio without rendering the API secret", async () => {
    const fetch = fetchStub({
      ...responseRoutes(),
      "POST /api/integrations/twilio/connect": { body: { connection: connected }, status: 201 },
      "GET /api/integrations": [{ body: { providers, twilio: null } }, { body: { providers: providers.map((provider) => provider.id === "twilio" ? { ...provider, state: "connected", note: null, testable: true, identifier: accountSid } : provider), twilio: connected } }],
      "GET /api/integrations/twilio/numbers": { body: { numbers } },
    });
    vi.stubGlobal("fetch", fetch);
    render(<IntegrationsView />);
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
    render(<IntegrationsView />);
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
      "GET /api/integrations": [{ body: { providers: connectedProviders, twilio: connected } }, { body: { providers: connectedProviders, twilio: connected } }, { body: { providers: connectedProviders, twilio: connected } }],
    });
    vi.stubGlobal("fetch", fetch);
    render(<IntegrationsView />);
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
      "GET /api/integrations": [{ body: { providers: connectedProviders, twilio: missingToken } }, { body: { providers: connectedProviders, twilio: connected } }],
      "GET /api/integrations/twilio/numbers": [{ body: { numbers } }, { body: { numbers } }],
      "POST /api/integrations/twilio/auth-token": { body: { connection: connected } },
    });
    vi.stubGlobal("fetch", fetch);
    render(<IntegrationsView />);
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
    render(<IntegrationsView />);
    await screen.findByText("2 eligible numbers");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Disconnect" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("2 Active Workspaces");
  });

  it("tests Hyperdrive and Email inside their provider frames", async () => {
    const fetch = fetchStub({ ...responseRoutes(), "POST /api/integrations/hyperdrive/test": { body: { status: "ok", checkedAt: "2026-10-14T03:00:00.000Z" } }, "POST /api/integrations/email/test": { body: { error: "recipient_not_allowed" }, status: 409 } });
    vi.stubGlobal("fetch", fetch);
    render(<IntegrationsView />);
    await screen.findByRole("button", { name: "Test Connection" });
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
    expect(await screen.findByText(/Connection verified at/)).toBeVisible();
    const emailRegion = screen.getByRole("region", { name: "Cloudflare Email Service" });
    fireEvent.click(within(emailRegion).getByRole("button", { name: "Send Test Email" }));
    expect(await within(emailRegion).findByRole("alert")).toHaveTextContent("Your address is not on the recipient allowlist.");
  });

  it("shows a retry after initial loading fails", async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ providers, twilio: null })));
    vi.stubGlobal("fetch", fetch);
    render(<IntegrationsView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Integrations are unavailable.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Twilio" })).toBeVisible();
  });
});
