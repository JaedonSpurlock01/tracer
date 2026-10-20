/**
 * -------------------------------------------------------------------------
 * @file   app-shell.test.tsx
 * @brief  Verifies the authenticated shell and Operator Users surface.
 *
 * @description
 *  Covers role-aware navigation, account actions, User State filtering,
 *  provisioning delivery feedback, and guarded state management.
 *
 * @remarks
 *  Network calls are faked only at the public HTTP boundary.
 *
 * @see
 *  components/tracer/app-sidebar.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OperatorRecord } from "@/data/operator-administration";

const router = vi.hoisted(() => ({ push: vi.fn() }));
const pathname = vi.hoisted(() => ({ value: "/" }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => pathname.value,
}));

import AppSidebar from "@/components/tracer/app-sidebar";
import { avatarUrl } from "@/data/avatar";
import UsersView from "@/components/tracer/users-view";
import { SidebarProvider } from "@/components/ui/sidebar";

const operator: OperatorRecord = {
  id: "operator-1",
  name: "Example Operator",
  email: "operator@example.com",
  role: "Operator",
  state: "Active",
  emailVerified: true,
  lastSignInAt: "2026-10-14T00:00:00.000Z",
  provisionedBy: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  accessGrants: [],
};

const organization = { name: "Spurlock Labs", slug: "spurlock-labs" };

const secondOperator: OperatorRecord = {
  ...operator,
  id: "operator-2",
  name: "Second Operator",
  email: "second@example.com",
  lastSignInAt: null,
};

const viewer: OperatorRecord = {
  ...operator,
  id: "viewer-1",
  name: "Client Viewer",
  email: "viewer@example.com",
  role: "Client Viewer",
  provisionedBy: { id: operator.id, name: operator.name },
  accessGrants: [{ workspaceId: "ws-acme", workspaceName: "Acme Plumbing" }],
};

const activeWorkspaces = {
  workspaces: [
    { id: "ws-acme", name: "Acme Plumbing", state: "Active" },
    { id: "ws-gamma", name: "Gamma HVAC", state: "Active" },
  ],
  total: 2,
};

async function chooseOption(name: string) {
  const option = await screen.findByRole("option", { name });
  option.focus();
  fireEvent.keyDown(option, { key: "Enter" });
}

function routedFetch(routes: Record<string, unknown>, fallback: unknown = { users: [] }) {
  return vi.fn((url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const route = Object.keys(routes).find((candidate) => key.startsWith(candidate));
    return response(route ? routes[route] : fallback);
  });
}

function response(value: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(value), { status }));
}

beforeEach(() => {
  pathname.value = "/";
  router.push.mockReset();
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

describe("application shell", () => {
  it("shows all navigation links for an Operator and hides Operator links for a Client Viewer", () => {
    render(<SidebarProvider><AppSidebar actor={operator} organization={organization} /></SidebarProvider>);
    expect(screen.getByRole("link", { name: "Home" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Activity" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Calls" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Workspaces" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Reports" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Users" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Integrations" })).toBeVisible();

    cleanup();
    render(<SidebarProvider><AppSidebar actor={viewer} organization={organization} /></SidebarProvider>);
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Integrations" })).not.toBeInTheDocument();
  });

  it("opens the account menu from the top of the Sidebar with the current Organization", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ success: true })));
    render(<SidebarProvider><AppSidebar actor={operator} organization={organization} /></SidebarProvider>);
    const trigger = screen.getByRole("button", { name: /Example Operator/ });
    expect(trigger).toHaveTextContent("spurlock-labs");
    expect(trigger.compareDocumentPosition(screen.getByRole("link", { name: "Home" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(trigger);
    expect(await screen.findByText("Organizations")).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /Spurlock Labs/ })).toHaveTextContent("spurlock-labs");
    expect(screen.getByRole("menuitem", { name: "New organization" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("operator@example.com")).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Account Settings" })).toHaveAttribute("href", "/account/settings");
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/auth/sign-out", { method: "POST" }));
    expect(router.push).toHaveBeenCalledWith("/sign-in");
  });

  it("leaves Workspace selection to the Workspaces page", () => {
    render(<SidebarProvider><AppSidebar actor={viewer} organization={organization} /></SidebarProvider>);
    expect(screen.queryByRole("button", { name: /Select a Workspace/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Workspaces" })).toHaveAttribute("href", "/workspaces");
  });

  it("uses a DiceBear Gaze avatar seeded by the user id", () => {
    expect(avatarUrl("operator-1")).toBe("https://api.dicebear.com/10.x/gaze/svg?seed=operator-1");
  });

  it("renders server-provided users immediately without a loading skeleton", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const { container } = render(<UsersView currentUserId={operator.id} initialUsers={[operator, viewer]} />);
    expect(screen.getByRole("button", { name: "Manage Example Operator" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Manage Client Viewer" })).toBeVisible();
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
  });

  it("lists users, filters by search text, and clears no-match filters", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ users: [operator, viewer] })));
    render(<UsersView currentUserId={operator.id} initialUsers={[]} />);
    expect(await screen.findByRole("button", { name: "Manage Example Operator" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Search users"), { target: { value: "nobody" } });
    expect(await screen.findByText("No matching users.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));
    expect(await screen.findByRole("button", { name: "Manage Example Operator" })).toBeVisible();
  });

  it("provisions an Operator with delivery feedback", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ users: [operator] }))
      .mockResolvedValueOnce(response({ user: { ...secondOperator, state: "Provisioned" }, delivery: "failed" }, 201))
      .mockResolvedValueOnce(response({ users: [operator, secondOperator] }))
      .mockResolvedValue(response({ delivery: "sent" }));
    vi.stubGlobal("fetch", fetch);
    render(<UsersView currentUserId={operator.id} initialUsers={[]} />);
    await screen.findByText("Example Operator");
    fireEvent.click(screen.getByRole("button", { name: "Provision User" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "second@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Provision" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Access email could not be delivered.");
    expect(screen.getByRole("button", { name: "Resend" })).toBeVisible();
    expect(fetch).toHaveBeenCalledWith("/api/users", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ email: "second@example.com", name: "", role: "Operator", sendEmail: true }),
    }));
  });

  it("protects the last Active Operator in the Manage dialog", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ users: [operator] }));
    vi.stubGlobal("fetch", fetch);
    render(<UsersView currentUserId={operator.id} initialUsers={[]} />);
    await screen.findByRole("button", { name: "Manage Example Operator" });
    fireEvent.click(screen.getByRole("button", { name: "Manage Example Operator" }));
    expect(screen.getByText("The last Active Operator cannot be disabled or made a Client Viewer.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Disable" })).toBeDisabled();
  });

  it("disables a second Active Operator after confirmation", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ users: [operator, secondOperator] }));
    vi.stubGlobal("fetch", fetch);
    render(<UsersView currentUserId={operator.id} initialUsers={[]} />);
    await screen.findByRole("button", { name: "Manage Second Operator" });
    fireEvent.click(screen.getByRole("button", { name: "Manage Second Operator" }));
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Disable" }).at(-1)!);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/users/operator-2/state",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ state: "Disabled" }) }),
    ));
  });

  it("shows each Client Viewer's granted Workspaces", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ users: [operator, viewer] })));
    render(<UsersView currentUserId={operator.id} initialUsers={[]} />);
    expect(await screen.findByText("All Workspaces")).toBeVisible();
    expect(screen.getByText("Acme Plumbing")).toBeVisible();
  });

  it("requires Workspace Access before provisioning a Client Viewer", async () => {
    const fetch = routedFetch({
      "GET /api/workspaces": activeWorkspaces,
      "POST /api/users": { user: { ...viewer, id: "viewer-2", email: "client@example.com", state: "Provisioned" }, delivery: "sent" },
      "GET /api/users": { users: [operator] },
    });
    vi.stubGlobal("fetch", fetch);
    render(<UsersView currentUserId={operator.id} initialUsers={[]} />);
    await screen.findByText("Example Operator");
    fireEvent.click(screen.getByRole("button", { name: "Provision User" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Role" }));
    await chooseOption("Client Viewer");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "client@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Provision" }));
    expect(await screen.findByText("Select at least one Workspace.")).toBeVisible();
    expect(fetch).not.toHaveBeenCalledWith("/api/users", expect.objectContaining({ method: "POST" }));

    fireEvent.click(await screen.findByRole("checkbox", { name: "Acme Plumbing" }));
    fireEvent.click(screen.getByRole("button", { name: "Provision" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/users", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ email: "client@example.com", name: "", role: "Client Viewer", sendEmail: true, workspaceIds: ["ws-acme"] }),
    })));
    expect(await screen.findByText("Client Viewer provisioned.")).toBeVisible();
  });

  it("adds Access Grants and keeps a Client Viewer's last grant", async () => {
    const fetch = routedFetch({
      "GET /api/workspaces": activeWorkspaces,
      "POST /api/users/viewer-1/access-grants": { user: viewer },
      "GET /api/users": { users: [operator, viewer] },
    });
    vi.stubGlobal("fetch", fetch);
    render(<UsersView currentUserId={operator.id} initialUsers={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Manage Client Viewer" }));
    expect(screen.getByRole("button", { name: "Remove Acme Plumbing" })).toBeDisabled();
    expect(screen.getByText("A Client Viewer must keep at least one Access Grant.")).toBeVisible();
    fireEvent.click(screen.getByRole("combobox", { name: "Add Workspace Access" }));
    expect(await screen.findByRole("option", { name: "Gamma HVAC" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "Acme Plumbing" })).not.toBeInTheDocument();
    await chooseOption("Gamma HVAC");
    fireEvent.click(screen.getByRole("button", { name: "Add Access" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/users/viewer-1/access-grants", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ workspaceId: "ws-gamma" }),
    })));
  });

  it("removes a non-final Access Grant", async () => {
    const twoGrants = { ...viewer, accessGrants: [...viewer.accessGrants, { workspaceId: "ws-gamma", workspaceName: "Gamma HVAC" }] };
    const fetch = routedFetch({
      "GET /api/workspaces": activeWorkspaces,
      "DELETE /api/users/viewer-1/access-grants/ws-gamma": { user: viewer },
      "GET /api/users": { users: [operator, twoGrants] },
    });
    vi.stubGlobal("fetch", fetch);
    render(<UsersView currentUserId={operator.id} initialUsers={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Manage Client Viewer" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Gamma HVAC" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/users/viewer-1/access-grants/ws-gamma", expect.objectContaining({ method: "DELETE" })));
  });

  it("changes roles without demoting the last Active Operator", async () => {
    const fetch = routedFetch({
      "GET /api/workspaces": activeWorkspaces,
      "POST /api/users/viewer-1/role": { user: { ...viewer, role: "Operator" } },
      "GET /api/users": { users: [operator, viewer] },
    });
    vi.stubGlobal("fetch", fetch);
    render(<UsersView currentUserId={operator.id} initialUsers={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Manage Example Operator" }));
    expect(screen.getByRole("button", { name: "Make Client Viewer" })).toBeDisabled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Manage Client Viewer" }));
    fireEvent.click(screen.getByRole("button", { name: "Make Operator" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/users/viewer-1/role", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ role: "Operator" }),
    })));
  });
});
