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
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    expect(screen.getByRole("link", { name: "Access" })).toHaveAttribute("href", "#access");
    expect(screen.getByLabelText("Workspace name")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Reporting timezone" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByText("Restore this Workspace to edit its settings.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/workspaces/workspace-1/restore", expect.objectContaining({ method: "POST" })),
    );
  });

  describe("Access", () => {
    const user = {
      email: "client@example.com",
      role: "Client Viewer",
      state: "Active",
      emailVerified: true,
      lastSignInAt: null,
      provisionedBy: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const users = [
      { ...user, id: "viewer-a", name: "Client A", accessGrants: [{ workspaceId: "workspace-1", workspaceName: "Phoenix Office" }, { workspaceId: "workspace-2", workspaceName: "Other" }] },
      { ...user, id: "viewer-b", name: "Client B", accessGrants: [{ workspaceId: "workspace-2", workspaceName: "Other" }] },
      { ...user, id: "viewer-c", name: "Client C", state: "Provisioned", accessGrants: [{ workspaceId: "workspace-1", workspaceName: "Phoenix Office" }] },
      { ...user, id: "operator", name: "Example Operator", role: "Operator", accessGrants: [] },
    ];
    const activeWorkspace = { ...workspace, state: "Active" as const };

    function routed() {
      return vi.fn(async (url: string, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET" && url === "/api/users") return new Response(JSON.stringify({ users }), { status: 200 });
        return new Response(JSON.stringify({ user: users[0] }), { status: 200 });
      });
    }

    it("lists only Client Viewers granted this Workspace and adds Access on an Active Workspace", async () => {
      const fetch = routed();
      vi.stubGlobal("fetch", fetch);
      render(<WorkspaceSettingsView initialWorkspace={activeWorkspace} />);
      const access = within(document.getElementById("access")!);
      expect(await access.findByText("Client A")).toBeVisible();
      expect(access.getByText("Client C")).toBeVisible();
      expect(access.queryByText("Client B")).not.toBeInTheDocument();
      expect(access.queryByText("Example Operator")).not.toBeInTheDocument();
      expect(access.getByRole("link", { name: "Provision a Client Viewer" })).toHaveAttribute("href", "/users");

      fireEvent.click(access.getByRole("combobox", { name: "Client Viewer" }));
      const option = await screen.findByRole("option", { name: "Client B" });
      expect(screen.queryByRole("option", { name: "Client A" })).not.toBeInTheDocument();
      option.focus();
      fireEvent.keyDown(option, { key: "Enter" });
      fireEvent.click(access.getByRole("button", { name: "Add Access" }));
      await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/users/viewer-b/access-grants", expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ workspaceId: "workspace-1" }),
      })));
    });

    it("removes Access but keeps a Client Viewer's last grant", async () => {
      const fetch = routed();
      vi.stubGlobal("fetch", fetch);
      render(<WorkspaceSettingsView initialWorkspace={activeWorkspace} />);
      const access = within(document.getElementById("access")!);
      expect(await access.findByRole("button", { name: "Remove Access for Client C" })).toBeDisabled();
      fireEvent.click(access.getByRole("button", { name: "Remove Access for Client A" }));
      await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/users/viewer-a/access-grants/workspace-1", expect.objectContaining({ method: "DELETE" })));
    });

    it("keeps existing Access readable on an Archived Workspace without new grants", async () => {
      vi.stubGlobal("fetch", routed());
      render(<WorkspaceSettingsView initialWorkspace={{ ...workspace, state: "Archived" as const }} />);
      const access = within(document.getElementById("access")!);
      expect(await access.findByText("Client A")).toBeVisible();
      expect(access.queryByRole("button", { name: "Add Access" })).not.toBeInTheDocument();
      expect(access.getByText("Only Active Workspaces can receive new Access Grants.")).toBeVisible();
    });

    it("shows Retry when Access cannot load", async () => {
      const fetch = vi.fn(async () => new Response("{}", { status: 500 }));
      vi.stubGlobal("fetch", fetch);
      render(<WorkspaceSettingsView initialWorkspace={activeWorkspace} />);
      const access = within(document.getElementById("access")!);
      expect(await access.findByText("Access is unavailable.")).toBeVisible();
      expect(access.getByRole("button", { name: "Retry" })).toBeVisible();
    });
  });
});
