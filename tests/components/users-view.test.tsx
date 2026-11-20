/**
 * -------------------------------------------------------------------------
 * @file   users-view.test.tsx
 * @brief  Verifies how the Users table reads.
 *
 * @description
 *  Covers the single-line Users columns with plain labels, the last
 *  sign-in as a short time in the given timezone with the full timestamp
 *  on hover, and absent values named instead of dashed.
 *
 * @remarks
 *  Provisioning, filtering, and state management are covered in
 *  tests/components/app-shell.test.tsx; this suite checks presentation.
 *
 * @see
 *  components/tracer/users-view.tsx
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, render, screen, within } from "@testing-library/react";
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

function headers(): string[] {
  return screen.getAllByRole("columnheader").map((header) => header.textContent?.trim() ?? "");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T18:00:00.000Z"));
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
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
});
