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
};

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
};

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
    render(<SidebarProvider><AppSidebar actor={operator} /></SidebarProvider>);
    expect(screen.getByRole("link", { name: "Home" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Activity" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Calls" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Workspaces" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Reports" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Users" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Integrations" })).toBeVisible();

    cleanup();
    render(<SidebarProvider><AppSidebar actor={viewer} /></SidebarProvider>);
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Integrations" })).not.toBeInTheDocument();
  });

  it("opens the account menu and signs out through Better Auth", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ success: true })));
    render(<SidebarProvider><AppSidebar actor={operator} /></SidebarProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Example Operator/ }));
    await screen.findByRole("menuitem", { name: "Account Settings" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/auth/sign-out", { method: "POST" }));
    expect(router.push).toHaveBeenCalledWith("/sign-in");
  });

  it("lists users, filters by search text, and clears no-match filters", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ users: [operator, viewer] })));
    render(<UsersView currentUserId={operator.id} />);
    expect(await screen.findByRole("button", { name: "Manage Example Operator" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Search users"), { target: { value: "nobody" } });
    expect(await screen.findByText("No matching users.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));
    expect(await screen.findByRole("button", { name: "Manage Example Operator" })).toBeVisible();
  });

  it("provisions an Operator with delivery feedback and disables Client Viewer", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ users: [operator] }))
      .mockResolvedValueOnce(response({ user: { ...secondOperator, state: "Provisioned" }, delivery: "failed" }, 201))
      .mockResolvedValueOnce(response({ users: [operator, secondOperator] }))
      .mockResolvedValue(response({ delivery: "sent" }));
    vi.stubGlobal("fetch", fetch);
    render(<UsersView currentUserId={operator.id} />);
    await screen.findByText("Example Operator");
    fireEvent.click(screen.getByRole("button", { name: "Provision User" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Role" }));
    expect(screen.getByRole("option", { name: /Client Viewer/ })).toHaveAttribute("aria-disabled", "true");
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
    render(<UsersView currentUserId={operator.id} />);
    await screen.findByRole("button", { name: "Manage Example Operator" });
    fireEvent.click(screen.getByRole("button", { name: "Manage Example Operator" }));
    expect(screen.getByText("The last Active Operator cannot be disabled.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Disable" })).toBeDisabled();
  });

  it("disables a second Active Operator after confirmation", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ users: [operator, secondOperator] }));
    vi.stubGlobal("fetch", fetch);
    render(<UsersView currentUserId={operator.id} />);
    await screen.findByRole("button", { name: "Manage Second Operator" });
    fireEvent.click(screen.getByRole("button", { name: "Manage Second Operator" }));
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Disable" }).at(-1)!);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/users/operator-2/state",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ state: "Disabled" }) }),
    ));
  });
});
