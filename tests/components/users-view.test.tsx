/**
 * -------------------------------------------------------------------------
 * @file   users-view.test.tsx
 * @brief  Verifies how the Users table reads and how its actions answer.
 *
 * @description
 *  Covers the single-line Users columns with plain labels, the last
 *  sign-in as a short time in the given timezone with the full timestamp
 *  on hover, and absent values named instead of dashed. Also covers action
 *  feedback: each action's own pending state, failures named beside the
 *  action that failed, confirmations beside the action that caused them,
 *  and the reason a disabled action is unavailable.
 *
 * @remarks
 *  Provisioning, filtering, and state requests are covered in
 *  tests/components/app-shell.test.tsx.
 *
 * @see
 *  components/tracer/users-view.tsx
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import UsersView from "@/components/tracer/users-view";
import type { OperatorRecord } from "@/data/operator-administration";

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

const invited: OperatorRecord = {
  ...operator,
  id: "viewer-1",
  name: "Invited Viewer",
  email: "viewer@example.com",
  role: "Client Viewer",
  state: "Provisioned",
  lastSignInAt: null,
  provisionedBy: { id: operator.id, name: operator.name },
  accessGrants: [{ workspaceId: "ws-acme", workspaceName: "Acme Plumbing" }],
};

const secondOperator: OperatorRecord = { ...operator, id: "operator-2", name: "Second Operator", email: "second@example.com" };

const twoGrants: OperatorRecord = {
  ...invited,
  accessGrants: [...invited.accessGrants, { workspaceId: "ws-gamma", workspaceName: "Gamma HVAC" }],
};

function json(value: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(value), { status }));
}

type Route = (init?: RequestInit) => Promise<Response>;

function routed(routes: Record<string, Route>) {
  return vi.fn((url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url.split("?")[0]}`;
    if (routes[key]) return routes[key](init);
    if (key === "GET /api/workspaces") return json({ workspaces: [{ id: "ws-acme", name: "Acme Plumbing" }, { id: "ws-gamma", name: "Gamma HVAC" }] });
    return json({ users: [operator, secondOperator, invited] });
  });
}

function headers(): string[] {
  return screen.getAllByRole("columnheader").map((header) => header.textContent?.trim() ?? "");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T18:00:00.000Z"));
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(Element.prototype, "getAnimations", { value: () => [], configurable: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("UsersView", () => {
  it("lists users in single-line columns with plain labels", () => {
    render(<UsersView currentUserId={operator.id} initialUsers={[operator, invited]} timeZone="America/Chicago" />);
    expect(screen.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
    expect(headers()).toEqual(["User", "Role", "State", "Workspaces", "Last Sign-In", "Added By", ""]);
    const row = screen.getByRole("row", { name: /Invited Viewer/ });
    expect(within(row).getByText("viewer@example.com")).toBeVisible();
    expect(within(row).getByText("Acme Plumbing")).toBeVisible();
    expect(within(row).getByText("Example Operator")).toBeVisible();
  });

  it("shows the last sign-in as a short time in the given timezone with the full timestamp on hover", () => {
    render(<UsersView currentUserId={operator.id} initialUsers={[operator]} timeZone="America/Chicago" />);
    const row = screen.getByRole("row", { name: /operator@example\.com/ });
    const signedIn = within(row).getByText("Oct 13");
    expect(signedIn).toHaveAttribute("title", "Oct 13, 2026, 7:00:00 PM");
  });

  it("names a missing sign-in and the initial Operator instead of showing a dash", () => {
    render(<UsersView currentUserId={operator.id} initialUsers={[operator, invited]} timeZone="America/Chicago" />);
    expect(within(screen.getByRole("row", { name: /Invited Viewer/ })).getByText("Never")).toBeVisible();
    expect(within(screen.getByRole("row", { name: /operator@example\.com/ })).getByText("Initial setup")).toBeVisible();
    expect(screen.queryByText("-")).toBeNull();
  });

  describe("action feedback", () => {
    it("names a failed provision beside Provision and keeps the dialog and entered values", async () => {
      vi.stubGlobal("fetch", routed({ "POST /api/users": () => json({ error: "duplicate_email" }, 409) }));
      render(<UsersView currentUserId={operator.id} initialUsers={[operator]} timeZone="America/Chicago" />);
      fireEvent.click(screen.getByRole("button", { name: "Provision User" }));
      const dialog = screen.getByRole("dialog", { name: "Provision User" });
      fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "taken@example.com" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Provision" }));
      const alert = await within(dialog).findByRole("alert");
      expect(alert).toHaveTextContent("This email is already provisioned.");
      expect(alert).toHaveClass("text-destructive");
      expect(within(dialog).getByRole("button", { name: "Provision" })).toHaveAccessibleDescription("This email is already provisioned.");
      expect(within(dialog).getByLabelText("Email")).toHaveValue("taken@example.com");
    });

    it("confirms a provision beside Provision User", async () => {
      vi.stubGlobal("fetch", routed({ "POST /api/users": () => json({ user: { ...secondOperator, state: "Provisioned" }, delivery: "sent" }, 201) }));
      render(<UsersView currentUserId={operator.id} initialUsers={[operator]} timeZone="America/Chicago" />);
      fireEvent.click(screen.getByRole("button", { name: "Provision User" }));
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "second@example.com" } });
      fireEvent.click(screen.getByRole("button", { name: "Provision" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      const header = screen.getByRole("button", { name: "Provision User" }).closest("div")!;
      expect(within(header).getByRole("status")).toHaveTextContent("Operator provisioned.");
    });

    it("shows a Manage action pending on its own button and leaves the other actions enabled", async () => {
      vi.stubGlobal("fetch", routed({ "POST /api/users/viewer-1/role": () => new Promise<Response>(() => undefined) }));
      render(<UsersView currentUserId={operator.id} initialUsers={[operator, invited]} timeZone="America/Chicago" />);
      fireEvent.click(screen.getByRole("button", { name: "Manage Invited Viewer" }));
      const dialog = screen.getByRole("dialog", { name: "Manage Invited Viewer" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Make Operator" }));
      await waitFor(() => expect(within(dialog).getByRole("button", { name: "Make Operator" })).toHaveAttribute("aria-busy", "true"));
      expect(within(dialog).getByRole("button", { name: "Make Operator" })).toBeDisabled();
      expect(within(dialog).getByRole("button", { name: "Resend access instructions" })).toBeEnabled();
      expect(within(dialog).getByRole("button", { name: "Disable" })).toBeEnabled();
    });

    it("names a failed Manage action beside its button and keeps the dialog open", async () => {
      vi.stubGlobal("fetch", routed({ "POST /api/users/viewer-1/resend-access": () => json({ error: "unavailable" }, 500) }));
      render(<UsersView currentUserId={operator.id} initialUsers={[operator, invited]} timeZone="America/Chicago" />);
      fireEvent.click(screen.getByRole("button", { name: "Manage Invited Viewer" }));
      const dialog = screen.getByRole("dialog", { name: "Manage Invited Viewer" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Resend access instructions" }));
      const alert = await within(dialog).findByRole("alert");
      expect(alert).toHaveTextContent("The access email could not be sent.");
      expect(alert).toHaveClass("text-destructive");
      expect(within(dialog).getByRole("button", { name: "Resend access instructions" })).toHaveAccessibleDescription("The access email could not be sent.");
    });

    it("confirms a disable beside Re-enable and keeps the Manage dialog open", async () => {
      vi.stubGlobal("fetch", routed({ "POST /api/users/operator-2/state": () => json({ user: { ...secondOperator, state: "Disabled" } }) }));
      render(<UsersView currentUserId={operator.id} initialUsers={[operator, secondOperator]} timeZone="America/Chicago" />);
      fireEvent.click(screen.getByRole("button", { name: "Manage Second Operator" }));
      fireEvent.click(within(screen.getByRole("dialog", { name: "Manage Second Operator" })).getByRole("button", { name: "Disable" }));
      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Disable" }));
      const dialog = await screen.findByRole("dialog", { name: "Manage Second Operator" });
      const reenable = await within(dialog).findByRole("button", { name: "Re-enable" });
      expect(within(reenable.parentElement!).getByRole("status")).toHaveTextContent("User disabled.");
    });

    it("states why a disabled Manage action is unavailable", () => {
      render(<UsersView currentUserId={operator.id} initialUsers={[operator, twoGrants]} timeZone="America/Chicago" />);
      fireEvent.click(screen.getByRole("button", { name: "Manage Example Operator" }));
      const dialog = screen.getByRole("dialog", { name: "Manage Example Operator" });
      expect(within(dialog).getByRole("button", { name: "Disable" })).toHaveAccessibleDescription("The last Active Operator cannot be disabled or made a Client Viewer.");
      expect(within(dialog).getByRole("button", { name: "Make Client Viewer" })).toHaveAccessibleDescription("The last Active Operator cannot be disabled or made a Client Viewer.");
      cleanup();
      render(<UsersView currentUserId={operator.id} initialUsers={[operator, invited]} timeZone="America/Chicago" />);
      fireEvent.click(screen.getByRole("button", { name: "Manage Invited Viewer" }));
      expect(screen.getByRole("button", { name: "Remove Acme Plumbing" })).toHaveAccessibleDescription("A Client Viewer must keep at least one Access Grant.");
      expect(screen.getByRole("button", { name: "Add Access" })).toHaveAccessibleDescription("Select a Workspace to add.");
    });

    it("shows the Manage dialog's read-only details as facts", () => {
      render(<UsersView currentUserId={operator.id} initialUsers={[operator, invited]} timeZone="America/Chicago" />);
      fireEvent.click(screen.getByRole("button", { name: "Manage Invited Viewer" }));
      const dialog = screen.getByRole("dialog", { name: "Manage Invited Viewer" });
      expect(within(dialog).getAllByRole("term").map((term) => term.textContent)).toEqual(["Role", "State", "Last Sign-In", "Added By"]);
      expect(within(dialog).getAllByRole("definition").map((value) => value.textContent)).toEqual(["Client Viewer", "Provisioned", "Never", "Example Operator"]);
    });

    it("names an undelivered access email in the destructive style and confirms a resend in its place", async () => {
      vi.stubGlobal("fetch", routed({
        "POST /api/users": () => json({ user: { ...secondOperator, state: "Provisioned" }, delivery: "failed" }, 201),
        "POST /api/users/operator-2/resend-access": () => json({ delivery: "sent" }),
      }));
      render(<UsersView currentUserId={operator.id} initialUsers={[operator]} timeZone="America/Chicago" />);
      fireEvent.click(screen.getByRole("button", { name: "Provision User" }));
      fireEvent.change(screen.getByLabelText("Email"), { target: { value: "second@example.com" } });
      fireEvent.click(screen.getByRole("button", { name: "Provision" }));
      const warning = await screen.findByText("Access email could not be delivered.");
      expect(warning).toHaveClass("text-destructive");
      fireEvent.click(screen.getByRole("button", { name: "Resend" }));
      expect(await screen.findByText("Access email sent.")).toBeVisible();
      expect(screen.queryByText("Access email could not be delivered.")).not.toBeInTheDocument();
    });

    it("names a Users load failure in the destructive style with Retry", async () => {
      vi.stubGlobal("fetch", vi.fn(() => json({ error: "unavailable" }, 500)));
      render(<UsersView currentUserId={operator.id} initialUsers={[operator]} timeZone="America/Chicago" />);
      expect(await screen.findByText("Users are unavailable.")).toHaveClass("text-destructive");
      expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    });
  });
});
