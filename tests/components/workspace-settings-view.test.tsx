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

const { refreshClientCache } = vi.hoisted(() => ({ refreshClientCache: vi.fn(async () => undefined) }));
vi.mock("@/data/client-cache", () => ({ refreshClientCache }));

import WorkspaceSettingsView from "@/components/tracer/workspace-settings-view";
import type { OperatorRecord } from "@/data/operator-administration";

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
  refreshClientCache.mockClear();
});

describe("WorkspaceSettingsView", () => {
  it("saves General settings with PATCH", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ workspace: { ...workspace, name: "Updated Office" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    render(<WorkspaceSettingsView initialWorkspace={workspace} section="general" />);
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
    render(<WorkspaceSettingsView initialWorkspace={workspace} section="danger" />);
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
    render(<WorkspaceSettingsView initialWorkspace={workspace} section="recording" />);
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
        section="recording"
      />,
    );
    expect(screen.getByText("Managed in the Call Flow")).toBeVisible();
    expect(screen.getByRole("switch", { name: "Spam gate enabled" })).toHaveAttribute("aria-disabled", "true");
  });

  it("disables later settings and restores an Archived Workspace", async () => {
    const archived = { ...workspace, state: "Archived" as const, archivedAt: "2026-01-02T00:00:00.000Z" };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ workspace }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    render(<WorkspaceSettingsView initialWorkspace={archived} section="general" />);
    expect(screen.getByLabelText("Workspace name")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Reporting timezone" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByText("Restore this Workspace to edit its settings.")).toBeVisible();
    cleanup();
    render(<WorkspaceSettingsView initialWorkspace={archived} section="danger" />);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/workspaces/workspace-1/restore", expect.objectContaining({ method: "POST" })),
    );
  });

  it("shows one settings section per page with a rail linking every section", () => {
    render(<WorkspaceSettingsView initialWorkspace={workspace} section="number" />);
    const rail = screen.getByRole("navigation", { name: "Workspace settings sections" });
    expect(within(rail).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["General", "/workspaces/workspace-1/settings/general"],
      ["Number", "/workspaces/workspace-1/settings/number"],
      ["Recording and AI", "/workspaces/workspace-1/settings/recording"],
      ["Access", "/workspaces/workspace-1/settings/access"],
      ["Danger", "/workspaces/workspace-1/settings/danger"],
    ]);
    expect(within(rail).getByRole("link", { name: "Number" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "Number" })).toBeVisible();
    expect(screen.queryByLabelText("Workspace name")).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Recording enabled" })).not.toBeInTheDocument();
  });

  it("renders the Workspace tabs below the Settings header with Settings current", () => {
    render(<WorkspaceSettingsView initialWorkspace={workspace} section="number" />);
    const nav = screen.getByRole("navigation", { name: "Workspace" });
    expect(screen.getByRole("heading", { level: 1 }).compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.compareDocumentPosition(screen.getByRole("navigation", { name: "Workspace settings sections" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(["Overview", "Calls", "Flow", "Settings"]);
    expect(within(nav).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  });

  describe("Replace Number", () => {
    const activeWorkspace = { ...workspace, state: "Active" as const, trackingNumber: "+14155550101", destinationNumber: "+14155550199" };
    const numbers = [
      { id: "number-current", twilioSid: "PN1", phoneNumber: "+14155550101", friendlyName: "Current", voiceUrl: null, assignedWorkspace: { id: "workspace-1", name: "Phoenix Office" } },
      { id: "number-free", twilioSid: "PN2", phoneNumber: "+14155550102", friendlyName: "Spare", voiceUrl: null, assignedWorkspace: null },
    ];

    function routed(replaceResponse: Response) {
      return vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/users") return new Response(JSON.stringify({ users: [] }), { status: 200 });
        if (url === "/api/workspaces/numbers") return new Response(JSON.stringify({ numbers }), { status: 200 });
        if (url === "/api/workspaces/workspace-1/replace-number" && init?.method === "POST") return replaceResponse;
        throw new Error(`Unexpected route ${url}`);
      });
    }

    it("replaces the Tracking Number of an Active Workspace with an unassigned number", async () => {
      const fetch = routed(new Response(JSON.stringify({ workspace: { ...activeWorkspace, trackingNumber: "+14155550102" } }), { status: 200 }));
      vi.stubGlobal("fetch", fetch);
      render(<WorkspaceSettingsView initialWorkspace={activeWorkspace} section="number" />);
      fireEvent.click(screen.getByRole("button", { name: "Replace Number" }));
      const dialog = await screen.findByRole("dialog", { name: "Replace Tracking Number" });
      expect(await within(dialog).findByRole("radio", { name: "+14155550101" })).toBeDisabled();
      fireEvent.click(within(dialog).getByRole("radio", { name: "+14155550102" }));
      fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Replacement" }));
      await waitFor(() =>
        expect(fetch).toHaveBeenCalledWith(
          "/api/workspaces/workspace-1/replace-number",
          expect.objectContaining({ method: "POST", body: JSON.stringify({ twilioNumberId: "number-free" }) }),
        ),
      );
      expect(await screen.findByText("Tracking Number replaced.")).toBeVisible();
      expect(within(document.getElementById("number")!).getByText("+14155550102")).toBeVisible();
    });

    it("keeps the current Tracking Number and explains a failed replacement", async () => {
      vi.stubGlobal("fetch", routed(new Response(JSON.stringify({ error: "provider_unavailable" }), { status: 502 })));
      render(<WorkspaceSettingsView initialWorkspace={activeWorkspace} section="number" />);
      fireEvent.click(screen.getByRole("button", { name: "Replace Number" }));
      const dialog = await screen.findByRole("dialog", { name: "Replace Tracking Number" });
      fireEvent.click(await within(dialog).findByRole("radio", { name: "+14155550102" }));
      fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Replacement" }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent("Twilio could not complete the replacement. The current Tracking Number is unchanged.");
      expect(within(document.getElementById("number")!).getByText("+14155550101")).toBeVisible();
      expect(refreshClientCache).not.toHaveBeenCalled();
    });

    it("offers replacement only for an Active Workspace", () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ users: [] }), { status: 200 })));
      render(<WorkspaceSettingsView initialWorkspace={workspace} section="number" />);
      expect(screen.getByRole("button", { name: "Replace Number" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Detach Number" })).toBeDisabled();
    });

    it("detaches the Tracking Number after confirmation and returns the Workspace to Setup Required", async () => {
      const fetch = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/workspaces/workspace-1/detach-number" && init?.method === "POST") {
          return new Response(JSON.stringify({ workspace: { ...activeWorkspace, state: "Setup Required", trackingNumber: null } }), { status: 200 });
        }
        throw new Error(`Unexpected route ${url}`);
      });
      vi.stubGlobal("fetch", fetch);
      render(<WorkspaceSettingsView initialWorkspace={activeWorkspace} section="number" />);
      fireEvent.click(screen.getByRole("button", { name: "Detach Number" }));
      const dialog = await screen.findByRole("alertdialog", { name: "Detach +14155550101?" });
      expect(dialog).toHaveTextContent("stays in your Twilio account");
      expect(fetch).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole("button", { name: "Detach Number" }));
      await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/workspaces/workspace-1/detach-number", expect.objectContaining({ method: "POST" })));
      expect(await screen.findByText("Tracking Number detached. Activate the Workspace on a number to resume routing.")).toBeVisible();
      expect(screen.getByText("No Tracking Number")).toBeVisible();
      expect(screen.getByText("Setup Required")).toBeVisible();
      expect(refreshClientCache).toHaveBeenCalledTimes(1);
    });

    it("shows a successful detach without waiting for the client cache to clear", async () => {
      refreshClientCache.mockImplementationOnce(() => new Promise<undefined>(() => {}));
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ workspace: { ...activeWorkspace, state: "Setup Required", trackingNumber: null } }), { status: 200 })),
      );
      render(<WorkspaceSettingsView initialWorkspace={activeWorkspace} section="number" />);
      fireEvent.click(screen.getByRole("button", { name: "Detach Number" }));
      const dialog = await screen.findByRole("alertdialog", { name: "Detach +14155550101?" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Detach Number" }));
      expect(await screen.findByText("Tracking Number detached. Activate the Workspace on a number to resume routing.")).toBeVisible();
      expect(refreshClientCache).toHaveBeenCalledTimes(1);
    });

    it("keeps the Tracking Number when detaching fails", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "provider_unavailable" }), { status: 502 })));
      render(<WorkspaceSettingsView initialWorkspace={activeWorkspace} section="number" />);
      fireEvent.click(screen.getByRole("button", { name: "Detach Number" }));
      const dialog = await screen.findByRole("alertdialog", { name: "Detach +14155550101?" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Detach Number" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Twilio configuration could not be restored. The Workspace remains Active on its current Tracking Number.");
      expect(within(document.getElementById("number")!).getByText("+14155550101")).toBeVisible();
    });
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

    it("renders server-provided Access immediately without a loading skeleton", () => {
      vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
      const { container } = render(<WorkspaceSettingsView initialWorkspace={activeWorkspace} section="access" initialAccessUsers={users as OperatorRecord[]} />);
      const access = within(document.getElementById("access")!);
      expect(access.getByText("Client A")).toBeVisible();
      expect(access.queryByText("Client B")).not.toBeInTheDocument();
      expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
    });

    it("lists only Client Viewers granted this Workspace and adds Access on an Active Workspace", async () => {
      const fetch = routed();
      vi.stubGlobal("fetch", fetch);
      render(<WorkspaceSettingsView initialWorkspace={activeWorkspace} section="access" />);
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
      render(<WorkspaceSettingsView initialWorkspace={activeWorkspace} section="access" />);
      const access = within(document.getElementById("access")!);
      expect(await access.findByRole("button", { name: "Remove Access for Client C" })).toBeDisabled();
      fireEvent.click(access.getByRole("button", { name: "Remove Access for Client A" }));
      await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/users/viewer-a/access-grants/workspace-1", expect.objectContaining({ method: "DELETE" })));
    });

    it("keeps existing Access readable on an Archived Workspace without new grants", async () => {
      vi.stubGlobal("fetch", routed());
      render(<WorkspaceSettingsView initialWorkspace={{ ...workspace, state: "Archived" as const }} section="access" />);
      const access = within(document.getElementById("access")!);
      expect(await access.findByText("Client A")).toBeVisible();
      expect(access.queryByRole("button", { name: "Add Access" })).not.toBeInTheDocument();
      expect(access.getByText("Only Active Workspaces can receive new Access Grants.")).toBeVisible();
    });

    it("shows Retry when Access cannot load", async () => {
      const fetch = vi.fn(async () => new Response("{}", { status: 500 }));
      vi.stubGlobal("fetch", fetch);
      render(<WorkspaceSettingsView initialWorkspace={activeWorkspace} section="access" />);
      const access = within(document.getElementById("access")!);
      expect(await access.findByText("Access is unavailable.")).toBeVisible();
      expect(access.getByRole("button", { name: "Retry" })).toBeVisible();
    });
  });
});
