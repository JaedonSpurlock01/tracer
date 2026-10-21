/**
 * -------------------------------------------------------------------------
 * @file   workspace-sidebar.test.tsx
 * @brief  Verifies the Workspace-scoped Sidebar navigation.
 *
 * @description
 *  Covers the navigation the Sidebar shows while a Workspace is registered:
 *  the All Workspaces back link, the Workspace pages grouped by domain,
 *  the Operator-only Flow and Settings items, the current item for each
 *  Workspace route including Call Detail and every Settings section, and
 *  the return to global navigation once the registration unmounts.
 *
 * @remarks
 *  Hiding Flow and Settings from Client Viewers is cosmetic; those routes
 *  keep their own server authorization.
 *
 * @see
 *  components/tracer/app-sidebar.tsx
 *  components/tracer/workspace-nav.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ value: "/workspaces/workspace-1" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => pathname.value,
}));

import AppSidebar from "@/components/tracer/app-sidebar";
import { WorkspaceNav, WorkspaceNavProvider } from "@/components/tracer/workspace-nav";
import { SidebarProvider } from "@/components/ui/sidebar";

const operator = { id: "operator-1", name: "Example Operator", email: "operator@example.com", role: "Operator" as const };
const viewer = { id: "viewer-1", name: "Client Viewer", email: "viewer@example.com", role: "Client Viewer" as const };
const organization = { name: "Spurlock Labs", slug: "spurlock-labs" };

function Shell({ actor, registered = true }: { actor: typeof operator | typeof viewer; registered?: boolean }) {
  return (
    <SidebarProvider>
      <WorkspaceNavProvider>
        <AppSidebar actor={actor} organization={organization} />
        {registered ? <WorkspaceNav id="workspace-1" name="Acme Plumbing" state="Active" operator={actor.role === "Operator"} /> : null}
      </WorkspaceNavProvider>
    </SidebarProvider>
  );
}

function sidebarLinks() {
  return within(screen.getByRole("navigation", { name: "Workspace" })).getAllByRole("link");
}

beforeEach(() => {
  pathname.value = "/workspaces/workspace-1";
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Workspace Sidebar", () => {
  it("shows an Operator the All Workspaces link and the Workspace pages grouped by domain below the account menu", () => {
    render(<Shell actor={operator} />);

    expect(sidebarLinks().map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["All Workspaces", "/workspaces"],
      ["Overview", "/workspaces/workspace-1"],
      ["Site", "/workspaces/workspace-1/site"],
      ["Forms", "/workspaces/workspace-1/forms"],
      ["Calls", "/workspaces/workspace-1/calls"],
      ["Flow", "/workspaces/workspace-1/flow"],
      ["Reports", "/workspaces/workspace-1/reports"],
      ["Settings", "/workspaces/workspace-1/settings"],
    ]);
    expect(screen.getByText("Acme Plumbing")).toBeVisible();
    expect(screen.getByText("Website")).toBeVisible();
    expect(screen.getByText("Phone")).toBeVisible();
    const trigger = screen.getByRole("button", { name: /Example Operator/ });
    expect(trigger.compareDocumentPosition(screen.getByRole("link", { name: "All Workspaces" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Activity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
  });

  it("hides Flow and Settings from a Client Viewer", () => {
    render(<Shell actor={viewer} />);

    expect(sidebarLinks().map((link) => link.textContent)).toEqual(["All Workspaces", "Overview", "Site", "Forms", "Calls", "Reports"]);
  });

  it.each([
    ["/workspaces/workspace-1", "Overview"],
    ["/workspaces/workspace-1/site", "Site"],
    ["/workspaces/workspace-1/forms", "Forms"],
    ["/workspaces/workspace-1/calls", "Calls"],
    ["/workspaces/workspace-1/calls/call-1", "Calls"],
    ["/workspaces/workspace-1/flow", "Flow"],
    ["/workspaces/workspace-1/reports", "Reports"],
    ["/workspaces/workspace-1/settings", "Settings"],
    ["/workspaces/workspace-1/settings/number", "Settings"],
  ])("marks the item for %s as the current page", (route, current) => {
    pathname.value = route;
    render(<Shell actor={operator} />);

    expect(sidebarLinks().filter((link) => link.getAttribute("aria-current") === "page").map((link) => link.textContent)).toEqual([current]);
  });

  it("shows the global navigation when no Workspace is registered and restores it once the registration unmounts", () => {
    const { rerender } = render(<Shell actor={operator} registered={false} />);
    expect(screen.getByRole("link", { name: "Home" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "All Workspaces" })).not.toBeInTheDocument();

    rerender(<Shell actor={operator} />);
    expect(screen.getByRole("link", { name: "All Workspaces" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();

    rerender(<Shell actor={operator} registered={false} />);
    expect(screen.getByRole("link", { name: "Home" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "All Workspaces" })).not.toBeInTheDocument();
  });
});
