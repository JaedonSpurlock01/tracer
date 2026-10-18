/**
 * -------------------------------------------------------------------------
 * @file   analytics-panels.test.tsx
 * @brief  Verifies the dashboard KPI row, trend chart, and date controls.
 *
 * @description
 *  Covers the four KPI values with their comparison against the previous
 *  period: relative change for counts and durations, percentage points for
 *  Answer Rate, a dash when no change exists, and no comparison for All
 *  Time. The trend chart shows a visible text legend for Total Calls,
 *  Answered Calls, and Good Leads, a tooltip naming the period and each
 *  series, and an accessible table of every point. The date controls mark
 *  the current range and write a new range to the URL.
 *
 * @remarks
 *  Navigation is faked at the next/navigation boundary. Recharts measures
 *  its container through ResizeObserver, which jsdom lacks, so a stub
 *  reports a fixed container size.
 *
 * @see
 *  components/tracer/analytics-panels.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalyticsKpiRow, AnalyticsRangeControls, CallTrendsChart } from "@/components/tracer/analytics-panels";
import type { AnalyticsKpis } from "@/data/analytics";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }), usePathname: () => "/" }));

const kpis: AnalyticsKpis = {
  totalCalls: { value: 17, comparison: { previous: 6, change: 11 / 6, unit: "relative" } },
  answerRate: { value: 7 / 11, comparison: { previous: 3 / 4, change: 7 / 11 - 3 / 4, unit: "points" } },
  goodLeads: { value: 5, comparison: { previous: 0, change: null, unit: "relative" } },
  averageConnectedSeconds: { value: 782 / 7, comparison: { previous: 136 / 3, change: (782 / 7 - 136 / 3) / (136 / 3), unit: "relative" } },
};

const trend = {
  interval: "day" as const,
  points: [
    { start: "2026-10-16", end: "2026-10-16", label: "Oct 16, 2026", totalCalls: 4, answeredCalls: 3, goodLeads: 1 },
    { start: "2026-10-17", end: "2026-10-17", label: "Oct 17, 2026", totalCalls: 0, answeredCalls: 0, goodLeads: 0 },
    { start: "2026-10-18", end: "2026-10-18", label: "Oct 18, 2026", totalCalls: 13, answeredCalls: 7, goodLeads: 4 },
  ],
};

function tile(name: string): HTMLElement {
  return screen.getByRole("group", { name });
}

beforeEach(() => {
  push.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: { width: 600, height: 256 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AnalyticsKpiRow", () => {
  it("shows each KPI value with relative change for counts and durations and percentage points for Answer Rate", () => {
    render(<AnalyticsKpiRow kpis={kpis} />);
    expect(within(tile("Total Calls")).getByText("17")).toBeVisible();
    expect(within(tile("Total Calls")).getByText("+183.3% vs previous period")).toBeVisible();
    expect(within(tile("Answer Rate")).getByText("63.6%")).toBeVisible();
    expect(within(tile("Answer Rate")).getByText("-11.4 pts vs previous period")).toBeVisible();
    expect(within(tile("Good Leads")).getByText("5")).toBeVisible();
    expect(within(tile("Average Duration")).getByText("1:51")).toBeVisible();
    expect(within(tile("Average Duration")).getByText("+146.4% vs previous period")).toBeVisible();
  });

  it("shows a dash when a comparison has no change and no comparison for All Time", () => {
    const { rerender } = render(<AnalyticsKpiRow kpis={kpis} />);
    expect(within(tile("Good Leads")).getByText("- vs previous period")).toBeVisible();

    rerender(
      <AnalyticsKpiRow
        kpis={{
          totalCalls: { value: 0, comparison: null },
          answerRate: { value: null, comparison: null },
          goodLeads: { value: 0, comparison: null },
          averageConnectedSeconds: { value: null, comparison: null },
        }}
      />,
    );
    expect(within(tile("Total Calls")).getByText("0")).toBeVisible();
    expect(within(tile("Answer Rate")).getByText("-")).toBeVisible();
    expect(screen.queryByText(/vs previous period/)).not.toBeInTheDocument();
  });
});

describe("CallTrendsChart", () => {
  it("names every series in a visible legend and lists each period in an accessible table", () => {
    render(<CallTrendsChart trend={trend} />);
    const legend = screen.getByRole("list", { name: "Chart legend" });
    expect(within(legend).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Total Calls", "Answered Calls", "Good Leads"]);
    const table = screen.getByRole("table", { name: "Call trends by day" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Period", "Total Calls", "Answered Calls", "Good Leads"]);
    expect(within(table).getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual(["Oct 16, 2026431", "Oct 17, 2026000", "Oct 18, 20261374"]);
  });

  it("shows the period label and each series name in the tooltip", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 256, width: 600, height: 256, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(256);
    const { container } = render(<CallTrendsChart trend={trend} />);
    const surface = await waitFor(() => {
      const element = container.querySelector(".recharts-wrapper");
      expect(element).not.toBeNull();
      return element!;
    });
    fireEvent.mouseMove(surface, { clientX: 590, clientY: 100 });
    const tooltip = await waitFor(() => {
      const element = container.querySelector(".recharts-tooltip-wrapper");
      expect(element).toHaveTextContent("Oct 18, 2026");
      return element as HTMLElement;
    });
    expect(tooltip).toHaveTextContent("Total Calls13");
    expect(tooltip).toHaveTextContent("Answered Calls7");
    expect(tooltip).toHaveTextContent("Good Leads4");
  });
});

describe("AnalyticsRangeControls", () => {
  it("marks the current range and writes a new preset to the URL", () => {
    const onRangeChange = vi.fn();
    render(<AnalyticsRangeControls range={{ kind: "days", days: 30 }} onRangeChange={onRangeChange} />);
    const group = screen.getByRole("group", { name: "Date range" });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual(["7 Days", "30 Days", "90 Days", "All Time", "Custom"]);
    expect(within(group).getByRole("button", { name: "30 Days" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(group).getByRole("button", { name: "All Time" }));
    expect(onRangeChange).toHaveBeenCalledWith({ kind: "all" });
  });

  it("shows a custom range as its dates", () => {
    render(<AnalyticsRangeControls range={{ kind: "custom", from: "2026-09-01", to: "2026-09-30" }} onRangeChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Sep 1, 2026 - Sep 30, 2026" })).toHaveAttribute("aria-pressed", "true");
  });
});
