/**
 * -------------------------------------------------------------------------
 * @file   page-parts.test.tsx
 * @brief  Tests the shared parts every rebuilt page is composed from.
 *
 * @description
 *  Covers the stat strip, fact list, page header, panel, and list row: what
 *  each shows, what it leaves out when a value is absent, and the headings
 *  and links assistive technology reads.
 *
 * @remarks
 *  These parts replace three KPI tile components, three fact components,
 *  and about fifteen hand-written panel headings, so their behavior is
 *  tested once here instead of on every page.
 *
 * @see
 *  components/tracer/page-parts.tsx
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FactList, ListRow, PageHeader, Panel, StatStrip } from "@/components/tracer/page-parts";

afterEach(cleanup);

describe("StatStrip", () => {
  it("shows a change against the previous period only when a previous period exists", () => {
    render(
      <StatStrip
        stats={[
          { label: "Calls", value: "376", change: { value: 0.136, unit: "relative" } },
          { label: "Answer rate", value: "84.2%", change: { value: -0.029, unit: "points" } },
          { label: "Good Leads", value: "139", change: null },
          { label: "Avg duration", value: "2:47", change: { value: 0, unit: "relative" } },
        ]}
      />,
    );

    expect(within(screen.getByRole("group", { name: "Calls" })).getByText("+14%")).toBeVisible();
    expect(within(screen.getByRole("group", { name: "Answer rate" })).getByText("-2.9 pts")).toBeVisible();
    expect(screen.getByRole("group", { name: "Good Leads" })).toHaveTextContent(/^Good Leads139$/);
    expect(screen.getByRole("group", { name: "Avg duration" })).toHaveTextContent(/^Avg duration2:47$/);
  });

  it("keeps each stat's definition available without showing it", () => {
    render(<StatStrip stats={[{ label: "Calls", value: "376", hint: "Calls started in the period" }]} />);
    expect(screen.getByRole("group", { name: "Calls" })).toHaveAccessibleDescription("Calls started in the period");
  });
});

describe("FactList", () => {
  it("names an absent value instead of printing a dash", () => {
    render(
      <FactList
        facts={[
          { label: "Destination Number", value: "+15125550199" },
          { label: "Tracking Number", value: null },
          { label: "Deal", value: null, empty: "No Deal" },
        ]}
      />,
    );

    expect(screen.getByText("Destination Number").nextElementSibling).toHaveTextContent("+15125550199");
    expect(screen.getByText("Tracking Number").nextElementSibling).toHaveTextContent("None");
    expect(screen.getByText("Deal").nextElementSibling).toHaveTextContent("No Deal");
    expect(screen.queryByText("-")).not.toBeInTheDocument();
  });
});

describe("PageHeader", () => {
  it("gives the page its one top heading with its context and actions", () => {
    render(
      <PageHeader title="Home" description="Every Workspace, the last 30 days.">
        <button type="button">Generate Report</button>
      </PageHeader>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    expect(screen.getByText("Every Workspace, the last 30 days.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Generate Report" })).toBeVisible();
  });
});

describe("Panel", () => {
  it("is a region named by its heading with one action in the header bar", () => {
    render(
      <Panel title="Recent Calls" action={<a href="/calls">View all</a>}>
        <p>Rows</p>
      </Panel>,
    );

    const region = screen.getByRole("region", { name: "Recent Calls" });
    expect(within(region).getByRole("heading", { level: 2, name: "Recent Calls" })).toBeVisible();
    expect(within(region).getByRole("link", { name: "View all" })).toHaveAttribute("href", "/calls");
    expect(within(region).getByText("Rows")).toBeVisible();
  });

  it("renders without a header bar when it has no title", () => {
    render(<Panel><p>Rows</p></Panel>);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});

describe("ListRow", () => {
  it("is one link carrying the primary value, its detail line, and trailing badges", () => {
    render(
      <ListRow href="/workspaces/ws-1/calls/call-1" title="+15125550188" detail="Austin Plumbing Pros, 7:28 PM">
        <span>Answered</span>
      </ListRow>,
    );

    const link = screen.getByRole("link", { name: /\+15125550188/ });
    expect(link).toHaveAttribute("href", "/workspaces/ws-1/calls/call-1");
    expect(within(link).getByText("Austin Plumbing Pros, 7:28 PM")).toBeVisible();
    expect(within(link).getByText("Answered")).toBeVisible();
  });
});
