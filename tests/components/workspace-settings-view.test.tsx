/**
 * -------------------------------------------------------------------------
 * @file   workspace-settings-view.test.tsx
 * @brief  Verifies Workspace settings and lifecycle actions.
 *
 * @description
 *  Covers General saves, archive confirmation, disabled later sections, and
 *  restore behavior through public HTTP requests.
 *
 * @remarks
 *  Provider integrations are not part of the settings test boundary.
 *
 * @see
 *  components/tracer/workspace-settings-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WorkspaceSettingsView from "@/components/tracer/workspace-settings-view";

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

beforeEach(() => {
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

describe("WorkspaceSettingsView", () => {
  it("saves General settings with PATCH", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ workspace: { ...workspace, name: "Updated Office" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    render(<WorkspaceSettingsView initialWorkspace={workspace} />);
    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "Updated Office" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspaces/workspace-1",
        expect.objectContaining({ method: "PATCH", body: expect.stringContaining('"name":"Updated Office"') }),
      ),
    );
  });

  it("requires confirmation before archiving", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ workspace: { ...workspace, state: "Archived", archivedAt: "2026-01-02T00:00:00.000Z" } }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetch);
    render(<WorkspaceSettingsView initialWorkspace={workspace} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive Workspace" }));
    expect(screen.getByText("Archive Phoenix Office?")).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Archive Workspace" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/workspaces/workspace-1/archive", expect.objectContaining({ method: "POST" })),
    );
  });

  it("saves Recording and AI routing settings", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ workspace }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    render(<WorkspaceSettingsView initialWorkspace={workspace} />);
    fireEvent.click(screen.getByRole("switch", { name: "Recording enabled" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Recording and AI" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspaces/workspace-1/routing",
        expect.objectContaining({ method: "PATCH", body: expect.stringContaining('"recordingEnabled":true') }),
      ),
    );
  });

  it("shows the managed Call Flow state for published routing controls", () => {
    render(
      <WorkspaceSettingsView
        initialWorkspace={{ ...workspace, publishedFlowVersion: { version: 1, publishedAt: "2026-01-01T00:00:00.000Z" } }}
      />,
    );
    expect(screen.getByText("Managed in the Call Flow")).toBeVisible();
    expect(screen.getByRole("switch", { name: "Spam gate enabled" })).toHaveAttribute("aria-disabled", "true");
  });

  it("disables later settings and restores an Archived Workspace", async () => {
    const archived = { ...workspace, state: "Archived" as const, archivedAt: "2026-01-02T00:00:00.000Z" };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ workspace }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    render(<WorkspaceSettingsView initialWorkspace={archived} />);
    expect(screen.getAllByRole("button", { name: /Number/ })[0]).toBeDisabled();
    expect(screen.getAllByRole("button", { name: /Recording and AI/ })[0]).toBeDisabled();
    expect(screen.getByRole("button", { name: /Access/ })).toBeDisabled();
    expect(screen.getByLabelText("Workspace name")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Reporting timezone" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByText("Restore this Workspace to edit its settings.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/workspaces/workspace-1/restore", expect.objectContaining({ method: "POST" })),
    );
  });
});
