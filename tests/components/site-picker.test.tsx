/**
 * -------------------------------------------------------------------------
 * @file   site-picker.test.tsx
 * @brief  Verifies the Site picker list and dialog interactions.
 *
 * @description
 *  Covers the paged Site rows with their link state, hostname search and
 *  paging through the picker route, Skip, linking a chosen Site through
 *  the link route with an inline Retry on failure, and the dialog's
 *  replace mode.
 *
 * @remarks
 *  Requests are faked only at the public HTTP boundary.
 *
 * @see
 *  components/tracer/site-picker.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refreshClientCache } = vi.hoisted(() => ({ refreshClientCache: vi.fn(async () => undefined) }));
vi.mock("@/data/client-cache", () => ({ refreshClientCache }));

import { SitePickerDialog, SitePickerList } from "@/components/tracer/site-picker";

const pocatello = {
  id: "site-1",
  scriptName: "asphalt-paving-pocatello",
  primaryHostname: "pocatelloasphaltpaving.com",
  hostnames: [{ hostname: "pocatelloasphaltpaving.com", certificateId: "cert-1", enabled: true }],
  lastDeployedAt: "2026-10-11T23:12:59.000Z",
  liveVersionId: "e2e-version-1",
  linkedWorkspace: null,
  visits30d: 1234,
  health: "Healthy" as const,
};
const blackfoot = { ...pocatello, id: "site-2", scriptName: "asphalt-paving-blackfoot", primaryHostname: "asphaltpavingblackfoot.com", linkedWorkspace: { id: "workspace-9", name: "Blackfoot Paving" }, visits30d: 88 };
const listing = { sites: [pocatello, blackfoot], total: 7, page: 1, pageSize: 5 };

function fakeFetch(handler?: (url: string, init?: RequestInit) => Response | undefined) {
  const fetch = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = String(request);
    return handler?.(url, init) ?? new Response(JSON.stringify(listing), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Element.prototype, "getAnimations", { value: () => [], configurable: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  refreshClientCache.mockClear();
});

describe("SitePickerList", () => {
  it("lists Sites with hostname, last deployment, 30-day visits, and link state", async () => {
    const fetch = fakeFetch();
    render(<SitePickerList workspaceId="workspace-1" mode="link" timeZone="America/Chicago" onLinked={() => undefined} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/workspaces/sites?page=1&pageSize=5&search="));
    const available = (await screen.findByRole("radio", { name: "pocatelloasphaltpaving.com" })).closest("label")!;
    expect(within(available).getByText("Available")).toBeVisible();
    expect(within(available).getByText("1,234 visits, 30 days")).toBeVisible();
    expect(within(available).getByText(/Deployed Oct 11, 2026/)).toBeVisible();
    const linked = screen.getByRole("radio", { name: "asphaltpavingblackfoot.com" });
    expect(linked).toBeDisabled();
    expect(within(linked.closest("label")!).getByText("Linked to Blackfoot Paving")).toBeVisible();
    expect(screen.getByText("Page 1 of 2")).toBeVisible();
  });

  it("searches by hostname and pages with Previous and Next", async () => {
    const fetch = fakeFetch();
    render(<SitePickerList workspaceId="workspace-1" mode="link" timeZone="America/Chicago" onLinked={() => undefined} />);
    await screen.findByRole("radio", { name: "pocatelloasphaltpaving.com" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Sites" }), { target: { value: "poca" } });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/workspaces/sites?page=1&pageSize=5&search=poca"));
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/workspaces/sites?page=2&pageSize=5&search=poca"));
  });

  it("links the chosen Site, clears the client cache, and reports the linked Site", async () => {
    const fetch = fakeFetch((url, init) => {
      if (url === "/api/workspaces/workspace-1/site/link" && init?.method === "POST") {
        return new Response(JSON.stringify({ site: { id: "site-1", primaryHostname: "pocatelloasphaltpaving.com" } }), { status: 200 });
      }
      return undefined;
    });
    const onLinked = vi.fn();
    const onSkip = vi.fn();
    render(<SitePickerList workspaceId="workspace-1" mode="link" timeZone="America/Chicago" onLinked={onLinked} onSkip={onSkip} />);
    const link = screen.getByRole("button", { name: "Link Site" });
    expect(link).toBeDisabled();
    fireEvent.click(await screen.findByRole("radio", { name: "pocatelloasphaltpaving.com" }));
    fireEvent.click(link);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/workspaces/workspace-1/site/link", expect.objectContaining({ method: "POST", body: JSON.stringify({ siteId: "site-1" }) })),
    );
    await waitFor(() => expect(onLinked).toHaveBeenCalledWith(expect.objectContaining({ id: "site-1", primaryHostname: "pocatelloasphaltpaving.com" })));
    expect(refreshClientCache).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onSkip).toHaveBeenCalled();
  });

  it("shows an inline Retry when linking fails", async () => {
    const fetch = fakeFetch((url, init) => {
      if (url.endsWith("/site/link") && init?.method === "POST") return new Response(JSON.stringify({ error: "site_linked_elsewhere" }), { status: 409 });
      return undefined;
    });
    const onLinked = vi.fn();
    render(<SitePickerList workspaceId="workspace-1" mode="link" timeZone="America/Chicago" onLinked={onLinked} />);
    fireEvent.click(await screen.findByRole("radio", { name: "pocatelloasphaltpaving.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Link Site" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This Site is already linked to another Workspace.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/site/link"))).toHaveLength(2));
    expect(onLinked).not.toHaveBeenCalled();
  });
});

describe("SitePickerDialog", () => {
  it("posts to the replace route in replace mode and closes on success", async () => {
    const fetch = fakeFetch((url, init) => {
      if (url === "/api/workspaces/workspace-1/site/replace" && init?.method === "POST") {
        return new Response(JSON.stringify({ site: { id: "site-1", primaryHostname: "pocatelloasphaltpaving.com" } }), { status: 200 });
      }
      return undefined;
    });
    const onOpenChange = vi.fn();
    const onLinked = vi.fn();
    render(<SitePickerDialog open onOpenChange={onOpenChange} workspaceId="workspace-1" mode="replace" timeZone="America/Chicago" onLinked={onLinked} />);
    expect(await screen.findByRole("heading", { name: "Replace Site" })).toBeVisible();
    fireEvent.click(await screen.findByRole("radio", { name: "pocatelloasphaltpaving.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace Site" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/workspaces/workspace-1/site/replace", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(onLinked).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
