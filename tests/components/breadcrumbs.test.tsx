/**
 * -------------------------------------------------------------------------
 * @file   breadcrumbs.test.tsx
 * @brief  Covers the header breadcrumbs derived from the route.
 *
 * @description
 *  Checks the root Home crumb, static segment labels with links to every
 *  crumb but the current page, a registered label replacing a dynamic
 *  segment's generic noun, the unlinked Account segment, and a Workspace
 *  Settings section label.
 *
 * @see
 *  components/tracer/breadcrumbs.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const pathname = { value: "/" };

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
}));

import { BreadcrumbLabel, BreadcrumbProvider, Breadcrumbs, crumbsFor } from "@/components/tracer/breadcrumbs";

describe("breadcrumbs", () => {
  it("shows Home alone at the root", () => {
    pathname.value = "/";
    render(<BreadcrumbProvider><Breadcrumbs /></BreadcrumbProvider>);
    expect(screen.getByText("Home")).toHaveAttribute("aria-current", "page");
    expect(document.querySelector("a[href]")).toBeNull();
  });

  it("links every crumb but the current page and uses a registered label for a dynamic segment", () => {
    pathname.value = "/workspaces/ws-1/calls";
    render(
      <BreadcrumbProvider>
        <Breadcrumbs />
        <BreadcrumbLabel segment="ws-1" label="Acme Plumbing" />
      </BreadcrumbProvider>,
    );
    expect(screen.getByRole("link", { name: "Workspaces" })).toHaveAttribute("href", "/workspaces");
    expect(screen.getByRole("link", { name: "Acme Plumbing" })).toHaveAttribute("href", "/workspaces/ws-1");
    expect(screen.getByText("Calls")).toHaveAttribute("aria-current", "page");
  });

  it("falls back to generic nouns and section labels, and leaves Account unlinked", () => {
    expect(crumbsFor("/workspaces/ws-1/calls/call-9", {}).map((crumb) => crumb.label)).toEqual(["Workspaces", "Workspace", "Calls", "Call"]);
    expect(crumbsFor("/workspaces/ws-1/settings/recording", {}).map((crumb) => crumb.label)).toEqual(["Workspaces", "Workspace", "Settings", "Recording and AI"]);
    expect(crumbsFor("/account/settings", {})).toEqual([
      { href: "/account", label: "Account", link: false },
      { href: "/account/settings", label: "Settings", link: true },
    ]);
  });
});
