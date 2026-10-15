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

const useSearchParamsMock = vi.hoisted(() => vi.fn(() => new URLSearchParams()));
vi.mock("next/navigation", () => ({ useSearchParams: useSearchParamsMock }));

const workspace = { id: "workspace-1", name: "Phoenix Office", reportingTimezone: "America/Chicago", state: "Setup Required" as const, destinationNumber: null, recordingEnabled: false, analysisEnabled: false, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null, createdBy: { id: "operator", name: "Operator" }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null };
const result = { workspaces: [workspace], total: 1, page: 1, pageSize: 10, counts: { setupRequired: 1, active: 0, archived: 0 } };

beforeEach(() => {
  useSearchParamsMock.mockReturnValue(new URLSearchParams());
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(Element.prototype, "getAnimations", { value: () => [], configurable: true });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("WorkspacesView", () => {
  it("renders a loading skeleton before server data arrives", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    render(<WorkspacesView initialTimezone="America/Chicago" />);
    expect(screen.getByRole("table")).toBeVisible();
  });

  it("shows the first Workspace empty state and create action", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...result, workspaces: [], total: 0 }), { status: 200 })));
    render(<WorkspacesView initialTimezone="America/Chicago" />);
    const emptyState = await screen.findByTestId("workspace-empty-state");
    expect(within(emptyState).getByText("No Workspaces yet. Create a Workspace now; activating it later requires the connected Organization Twilio account.")).toBeVisible();
    expect(within(emptyState).getByRole("button", { name: "Create Workspace" })).toBeVisible();
  });

  it("shows retry after a fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    render(<WorkspacesView initialTimezone="America/Chicago" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Workspaces are unavailable.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("renders Setup Required and opens the four-step setup dialog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(result), { status: 200 })));
    render(<WorkspacesView initialTimezone="America/Chicago" />);
    expect(await screen.findByText("Setup Required")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Resume Setup" }));
    expect(screen.getByText("Basics")).toBeVisible();
    expect(screen.getByText("Number")).toBeVisible();
    expect(screen.getByText("Routing")).toBeVisible();
    expect(screen.getByText("Review")).toBeVisible();
    expect(screen.getByText("Arrives with Call Flow publication")).toBeVisible();
  });

  it("opens Resume Setup from the overview query parameter", async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams("resume=workspace-1"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(result), { status: 200 })));
    render(<WorkspacesView initialTimezone="America/Chicago" />);
    expect(await screen.findByText("Resume setup for Phoenix Office")).toBeVisible();
    expect(screen.getByText("Number setup is disabled")).toBeVisible();
  });

  it("posts Basics when creating a Workspace and renders name conflicts", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...result, workspaces: [], total: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "name_taken" }), { status: 409 }));
    vi.stubGlobal("fetch", fetch);
    render(<WorkspacesView initialTimezone="America/Chicago" />);
    fireEvent.click(await screen.findByRole("button", { name: "Create Workspace" }));
    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Phoenix Office" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Create Workspace" }).at(-1)!);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/workspaces", expect.objectContaining({ method: "POST", body: expect.stringContaining('"name":"Phoenix Office"') })));
    expect(await screen.findByText("A Workspace with this name already exists.")).toBeVisible();
  });
});
