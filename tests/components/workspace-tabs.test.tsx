/**
 * -------------------------------------------------------------------------
 * @file   workspace-tabs.test.tsx
 * @brief  Verifies the Workspace navigation tabs.
 *
 * @description
 *  Covers the tab set shown to Operators and Client Viewers, each tab's
 *  route, and that the tab the page names is the current page.
 *
 * @remarks
 *  Hiding Flow and Settings from Client Viewers is cosmetic; those routes
 *  keep their own server authorization.
 *
 * @see
 *  components/tracer/workspace-tabs.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import WorkspaceTabs, { type WorkspaceTab } from "@/components/tracer/workspace-tabs";

afterEach(() => cleanup());

function tabs() {
  return within(screen.getByRole("navigation", { name: "Workspace" })).getAllByRole("link");
}

describe("Workspace tabs", () => {
  it("shows an Operator Overview, Calls, Flow, and Settings linked to the Workspace routes", () => {
    render(<WorkspaceTabs workspaceId="workspace-1" operator current="overview" />);

    expect(tabs().map((tab) => [tab.textContent, tab.getAttribute("href")])).toEqual([
      ["Overview", "/workspaces/workspace-1"],
      ["Calls", "/workspaces/workspace-1/calls"],
      ["Flow", "/workspaces/workspace-1/flow"],
      ["Settings", "/workspaces/workspace-1/settings"],
    ]);
  });

  it("shows a Client Viewer only Overview and Calls", () => {
    render(<WorkspaceTabs workspaceId="workspace-1" operator={false} current="calls" />);

    expect(tabs().map((tab) => tab.textContent)).toEqual(["Overview", "Calls"]);
  });

  it.each([
    ["overview", "Overview"],
    ["calls", "Calls"],
    ["flow", "Flow"],
    ["settings", "Settings"],
  ] as const satisfies readonly (readonly [WorkspaceTab, string])[])("marks the %s tab the page names as the current page", (current, active) => {
    render(<WorkspaceTabs workspaceId="workspace-1" operator current={current} />);

    expect(tabs().filter((tab) => tab.getAttribute("aria-current") === "page").map((tab) => tab.textContent)).toEqual([active]);
  });
});
