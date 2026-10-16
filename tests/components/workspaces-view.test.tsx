/**
 * -------------------------------------------------------------------------
 * @file   workspaces-view.test.tsx
 * @brief  Verifies Workspace grid and setup dialog interactions.
 *
 * @description
 *  Covers loading, empty, retry, setup state rows, and Workspace creation.
 *
 * @remarks
 *  Requests are faked only at the public HTTP boundary.
 *
 * @see
 *  components/tracer/workspaces-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WorkspacesView from "@/components/tracer/workspaces-view";
import { generateInitialCallFlow } from "@/data/call-flow";

const useSearchParamsMock = vi.hoisted(() => vi.fn(() => new URLSearchParams()));
vi.mock("next/navigation", () => ({ useSearchParams: useSearchParamsMock }));

const workspace = {
  id: "workspace-1",
  name: "Phoenix Office",
  reportingTimezone: "America/Chicago",
  state: "Setup Required" as const,
  destinationNumber: null,
  trackingNumber: null,
  numberAssignmentStartedAt: null,
  publishedFlowVersion: null,
  hasDraft: false,
  recordingEnabled: false,
  analysisEnabled: false,
  spamGateEnabled: false,
  whisperEnabled: false,
  whisperMessage: null,
  createdBy: { id: "operator", name: "Operator" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
};
const result = { workspaces: [workspace], total: 1, page: 1, pageSize: 10, counts: { setupRequired: 1, active: 0, archived: 0 } };

beforeEach(() => {
  useSearchParamsMock.mockReturnValue(new URLSearchParams());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
  Object.defineProperty(Element.prototype, "getAnimations", { value: () => [], configurable: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorkspacesView", () => {
  it("renders a loading skeleton before server data arrives", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    render(<WorkspacesView initialTimezone="America/Chicago" />);
    expect(screen.getByRole("table")).toBeVisible();
  });

  it("shows the first Workspace empty state and create action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ...result, workspaces: [], total: 0 }), { status: 200 })),
    );
    render(<WorkspacesView initialTimezone="America/Chicago" />);
    const emptyState = await screen.findByTestId("workspace-empty-state");
    expect(
      within(emptyState).getByText(
        "No Workspaces yet. Create a Workspace now; activating it later requires the connected Organization Twilio account.",
      ),
    ).toBeVisible();
    expect(within(emptyState).getByRole("button", { name: "Create Workspace" })).toBeVisible();
  });

  it("shows retry after a fetch error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    render(<WorkspacesView initialTimezone="America/Chicago" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Workspaces are unavailable.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("renders Setup Required and opens Resume Setup on the Number step", async () => {
    const fetch = vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request);
      if (url.endsWith("/api/workspaces/numbers")) {
        return new Response(
          JSON.stringify({
            numbers: [
              {
                id: "number-1",
                twilioSid: "PN1",
                phoneNumber: "+14155550100",
                friendlyName: "Support",
                voiceUrl: null,
                assignedWorkspace: null,
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(result), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    render(<WorkspacesView initialTimezone="America/Chicago" />);
    expect(await screen.findByText("Setup Required")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Resume Setup" }));
    expect(screen.getByText("Basics")).toBeVisible();
    expect(screen.getByText("Number")).toBeVisible();
    expect(await screen.findByText("+14155550100")).toBeVisible();
    expect(screen.getByText("Routing")).toBeVisible();
    expect(screen.getByText("Review")).toBeVisible();
  });

  it("filters Twilio numbers on the Number step by phone number or friendly name", async () => {
    const numbers = [
      { id: "number-1", phoneNumber: "+14155550100", friendlyName: "Support", assignedWorkspace: null },
      { id: "number-2", phoneNumber: "+14155550101", friendlyName: "Sales", assignedWorkspace: null },
      { id: "number-3", phoneNumber: "+16025550199", friendlyName: "Billing", assignedWorkspace: null },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: RequestInfo | URL) =>
        String(request).endsWith("/api/workspaces/numbers")
          ? new Response(JSON.stringify({ numbers }), { status: 200 })
          : new Response(JSON.stringify(result), { status: 200 }),
      ),
    );
    render(<WorkspacesView initialTimezone="America/Chicago" />);
    fireEvent.click(await screen.findByRole("button", { name: "Resume Setup" }));
    await screen.findByText("+16025550199");
    const search = screen.getByRole("searchbox", { name: "Search numbers" });

    fireEvent.change(search, { target: { value: "602" } });
    expect(screen.getByText("+16025550199")).toBeVisible();
    expect(screen.queryByText("+14155550100")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "sales" } });
    expect(screen.getByText("+14155550101")).toBeVisible();
    expect(screen.queryByText("+16025550199")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "nothing" } });
    expect(screen.getByText("No numbers match your search.")).toBeVisible();
  });

  it("opens Resume Setup from the overview query parameter", async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams("resume=workspace-1"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: RequestInfo | URL) => {
        if (String(request).endsWith("/api/workspaces/numbers"))
          return new Response(
            JSON.stringify({
              numbers: [
                {
                  id: "number-1",
                  twilioSid: "PN1",
                  phoneNumber: "+14155550100",
                  friendlyName: "Support",
                  voiceUrl: null,
                  assignedWorkspace: null,
                },
              ],
            }),
            { status: 200 },
          );
        return new Response(JSON.stringify(result), { status: 200 });
      }),
    );
    render(<WorkspacesView initialTimezone="America/Chicago" />);
    expect(await screen.findByText("Resume setup for Phoenix Office")).toBeVisible();
    expect(await screen.findByText("+14155550100")).toBeVisible();
  });

  it("posts Basics when creating a Workspace and renders name conflicts", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...result, workspaces: [], total: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "name_taken" }), { status: 409 }));
    vi.stubGlobal("fetch", fetch);
    render(<WorkspacesView initialTimezone="America/Chicago" />);
    fireEvent.click(await screen.findByRole("button", { name: "Create Workspace" }));
    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Phoenix Office" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Create Workspace" }).at(-1)!);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspaces",
        expect.objectContaining({ method: "POST", body: expect.stringContaining('"name":"Phoenix Office"') }),
      ),
    );
    expect(await screen.findByText("A Workspace with this name already exists.")).toBeVisible();
  });

  it("advances to Number after creating a Workspace and loads numbers", async () => {
    const created = { ...workspace, id: "workspace-new", name: "New Office" };
    const fetch = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (url === "/api/workspaces" && init?.method === "POST")
        return new Response(JSON.stringify({ workspace: created }), { status: 201 });
      if (url.endsWith("/api/workspaces/numbers"))
        return new Response(
          JSON.stringify({
            numbers: [
              {
                id: "number-1",
                twilioSid: "PN1",
                phoneNumber: "+14155550100",
                friendlyName: "Support",
                voiceUrl: null,
                assignedWorkspace: null,
              },
            ],
          }),
          { status: 200 },
        );
      return new Response(JSON.stringify({ ...result, workspaces: [created], total: 1 }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    render(<WorkspacesView initialTimezone="America/Chicago" />);
    fireEvent.click(await screen.findByRole("button", { name: "Create Workspace" }));
    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "New Office" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Create Workspace" }).at(-1)!);
    expect(await screen.findByText("+14155550100")).toBeVisible();
    expect(screen.getByText("New Office")).toBeVisible();
  });

  it("shows the Integrations alert when Twilio is not connected", async () => {
    const fetch = vi.fn(async (request: RequestInfo | URL) => {
      if (String(request).endsWith("/api/workspaces/numbers"))
        return new Response(JSON.stringify({ error: "twilio_not_connected" }), { status: 409 });
      return new Response(JSON.stringify(result), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    render(<WorkspacesView initialTimezone="America/Chicago" />);
    fireEvent.click(await screen.findByRole("button", { name: "Resume Setup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connect the Organization Twilio account in Integrations first");
    expect(screen.getByRole("link", { name: "Integrations" })).toHaveAttribute("href", "/integrations");
  });

  it("patches the Routing settings with the expected body", async () => {
    const fetch = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (url.endsWith("/api/workspaces/numbers"))
        return new Response(
          JSON.stringify({
            numbers: [
              {
                id: "number-1",
                twilioSid: "PN1",
                phoneNumber: "+14155550100",
                friendlyName: "Support",
                voiceUrl: null,
                assignedWorkspace: null,
              },
            ],
          }),
          { status: 200 },
        );
      if (url.endsWith("/routing") && init?.method === "PATCH")
        return new Response(JSON.stringify({ workspace: { ...workspace, destinationNumber: "+14155550101" } }), { status: 200 });
      if (url.endsWith("/flow"))
        return new Response(
          JSON.stringify({
            draft: {
              graph: generateInitialCallFlow({
                destinationNumber: "+14155550101",
                recordingEnabled: true,
                spamGateEnabled: false,
                whisperEnabled: false,
                whisperMessage: null,
                disclosureVoice: "Polly.Joanna",
              }),
              basedOnVersion: null,
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            validation: { valid: true, issues: [] },
            versions: [],
            published: null,
            recordingEnabled: true,
            workspaceState: "Setup Required",
          }),
          { status: 200 },
        );
      if (url.endsWith("/routing") && init?.method === "PATCH")
        return new Response(JSON.stringify({ workspace: { ...workspace, destinationNumber: "+14155550101", recordingEnabled: true } }), {
          status: 200,
        });
      return new Response(JSON.stringify(result), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    render(<WorkspacesView initialTimezone="America/Chicago" />);
    fireEvent.click(await screen.findByRole("button", { name: "Resume Setup" }));
    fireEvent.click(await screen.findByRole("radio", { name: /\+14155550100/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByLabelText("Destination Number")).toBeVisible();
    expect(screen.getByRole("switch", { name: "Recording enabled" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("switch", { name: "Recording enabled" }));
    fireEvent.change(screen.getByLabelText("Destination Number"), { target: { value: "+14155550101" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspaces/workspace-1/routing",
        expect.objectContaining({ method: "PATCH", body: expect.stringContaining('"recordingEnabled":true') }),
      ),
    );
  });

  it("reviews the generated Call Flow and activates successfully", async () => {
    const graph = generateInitialCallFlow({
      destinationNumber: "+14155550101",
      recordingEnabled: false,
      spamGateEnabled: false,
      whisperEnabled: false,
      whisperMessage: null,
      disclosureVoice: "Polly.Joanna",
    });
    const fetch = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (url.endsWith("/api/workspaces/numbers"))
        return new Response(
          JSON.stringify({
            numbers: [
              {
                id: "number-1",
                twilioSid: "PN1",
                phoneNumber: "+14155550100",
                friendlyName: "Support",
                voiceUrl: null,
                assignedWorkspace: null,
              },
            ],
          }),
          { status: 200 },
        );
      if (url.endsWith("/routing") && init?.method === "PATCH")
        return new Response(JSON.stringify({ workspace: { ...workspace, destinationNumber: "+14155550101" } }), { status: 200 });
      if (url.endsWith("/flow"))
        return new Response(
          JSON.stringify({
            draft: { graph, basedOnVersion: null, updatedAt: "2026-01-01T00:00:00.000Z" },
            validation: { valid: true, issues: [] },
            versions: [],
            published: null,
            recordingEnabled: false,
            workspaceState: "Setup Required",
          }),
          { status: 200 },
        );
      if (url.endsWith("/activate") && init?.method === "POST")
        return new Response(JSON.stringify({ workspace: { ...workspace, state: "Active", name: "Phoenix Office" } }), { status: 200 });
      return new Response(JSON.stringify(result), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    render(<WorkspacesView initialTimezone="America/Chicago" />);
    fireEvent.click(await screen.findByRole("button", { name: "Resume Setup" }));
    fireEvent.click(await screen.findByRole("radio", { name: /\+14155550100/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    expect(await screen.findByText("Incoming Call")).toBeVisible();
    expect(screen.getByRole("button", { name: "Create and Activate" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Create and Activate" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspaces/workspace-1/activate",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ twilioNumberId: "number-1" }) }),
      ),
    );
  });
});
