/**
 * -------------------------------------------------------------------------
 * @file   app-loading.test.tsx
 * @brief  Verifies each page's loading boundary has the shape of its page.
 *
 * @description
 *  A navigation paints a page's loading boundary at once while the page
 *  streams in. Each boundary must name what is loading for assistive
 *  technology, mark itself busy, render no data, keep the page's width,
 *  and show the same named regions the loaded page shows, so nothing
 *  moves when the page arrives.
 *
 * @remarks
 *  The expected regions are the panels each page always renders. Panels a
 *  page shows only for some states or roles (Business, Needs attention, a
 *  settings section) stay out of its skeleton.
 *
 * @see
 *  components/tracer/page-loading.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";

import AccountSettingsLoading from "@/app/(app)/(everyone)/account/settings/loading";
import CallsLoading from "@/app/(app)/(everyone)/calls/loading";
import HomeLoading from "@/app/(app)/(everyone)/(home)/loading";
import ReportsLoading from "@/app/(app)/(everyone)/reports/loading";
import WorkspacesLoading from "@/app/(app)/(everyone)/workspaces/loading";
import IntegrationsLoading from "@/app/(app)/(operator)/integrations/loading";
import PricingLoading from "@/app/(app)/(operator)/pricing/loading";
import UsersLoading from "@/app/(app)/(operator)/users/loading";
import FlowLoading from "@/app/(app)/workspaces/[id]/(operator)/flow/loading";
import WorkspaceSettingsLoading from "@/app/(app)/workspaces/[id]/(operator)/settings/loading";
import OverviewLoading from "@/app/(app)/workspaces/[id]/(viewer)/(overview)/loading";
import CallDetailLoading from "@/app/(app)/workspaces/[id]/(viewer)/calls/[callId]/loading";
import WorkspaceCallsLoading from "@/app/(app)/workspaces/[id]/(viewer)/calls/(list)/loading";
import FormsLoading from "@/app/(app)/workspaces/[id]/(viewer)/forms/loading";
import WorkspaceReportsLoading from "@/app/(app)/workspaces/[id]/(viewer)/reports/loading";
import SiteLoading from "@/app/(app)/workspaces/[id]/(viewer)/site/loading";

afterEach(cleanup);

type Width = "reading" | "full";

const boundaries: [page: string, Loading: ComponentType, status: string, width: Width, regions: string[]][] = [
  ["Home", HomeLoading, "Loading Home", "reading", ["Leads generated", "Recent Calls", "Workspaces"]],
  ["Calls", CallsLoading, "Loading Calls", "full", []],
  ["Reports", ReportsLoading, "Loading Reports", "full", []],
  ["Workspaces", WorkspacesLoading, "Loading Workspaces", "full", []],
  ["Account Settings", AccountSettingsLoading, "Loading Account Settings", "reading", ["Profile"]],
  ["Integrations", IntegrationsLoading, "Loading Integrations", "full", []],
  ["Pricing", PricingLoading, "Loading Pricing", "reading", ["Rates", "A two-hour Call", "Monthly cost and revenue"]],
  ["Users", UsersLoading, "Loading Users", "full", []],
  ["Workspace Overview", OverviewLoading, "Loading Workspace", "reading", ["Leads generated", "Recent Calls", "Routing health", "Site", "Call Flow"]],
  ["Workspace Calls", WorkspaceCallsLoading, "Loading Calls", "full", []],
  ["Forms", FormsLoading, "Loading Forms", "full", []],
  ["Workspace Reports", WorkspaceReportsLoading, "Loading Reports", "full", []],
  ["Site", SiteLoading, "Loading Site", "reading", ["Site preview", "Traffic and Calls", "Top pages", "Referrers", "Performance", "Search"]],
  ["Workspace Flow", FlowLoading, "Loading Call Flow", "full", []],
  ["Workspace Settings", WorkspaceSettingsLoading, "Loading Workspace Settings", "reading", []],
  ["Call Detail", CallDetailLoading, "Loading Call", "full", ["Transcript", "Call facts", "Processing timeline", "Recording"]],
];

describe("loading boundaries", () => {
  it.each(boundaries)("%s loading announces itself, keeps the page width, and renders the same regions as its page", (_page, Loading, status, width, regions) => {
    const { container } = render(<Loading />);
    const root = container.firstElementChild;
    expect(screen.getByRole("status")).toHaveTextContent(status);
    expect(root).toHaveAttribute("aria-busy", "true");
    if (width === "reading") expect(root).toHaveClass("max-w-6xl");
    else expect(root).not.toHaveClass("max-w-6xl");
    expect(screen.queryAllByRole("region").map((region) => region.getAttribute("aria-label") ?? region.querySelector("h2")?.textContent)).toEqual(regions);
  });

  it("shares one ledger shape between the global and Workspace Calls and Reports pages", () => {
    expect(WorkspaceCallsLoading).toBe(CallsLoading);
    expect(WorkspaceReportsLoading).toBe(ReportsLoading);
  });
});
