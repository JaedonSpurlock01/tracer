/**
 * -------------------------------------------------------------------------
 * @file   pricing-guide.test.tsx
 * @brief  Verifies the Pricing guide page content.
 *
 * @description
 *  Checks that every rate in the maintained table renders with its unit
 *  and explanation and the date it was last checked, that the worked
 *  two-hour Call lists each line and its total, and that the monthly
 *  cost categories and the Deal revenue rules are explained.
 *
 * @see
 *  components/tracer/pricing-guide.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import PricingGuide from "@/components/tracer/pricing-guide";
import { pricingGuide } from "@/data/pricing";

afterEach(cleanup);

describe("PricingGuide", () => {
  it("lists every rate with its unit and the date it was checked", () => {
    render(<PricingGuide />);
    expect(screen.getByRole("heading", { level: 1, name: "Pricing" })).toBeVisible();
    expect(screen.getByText(/last checked on Oct 20, 2026/)).toBeVisible();
    const table = screen.getByRole("table", { name: "Rates" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(pricingGuide.length);
    expect(within(rows[0]).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Tracking Number rental", "$1.15", "per number per month", pricingGuide[0].explanation]);
    expect(within(rows[1]).getAllByRole("cell").map((cell) => cell.textContent?.slice(0, 7))).toEqual(["Inbound", "$0.0085", "per min", pricingGuide[1].explanation.slice(0, 7)]);
  });

  it("works the two-hour Call and explains monthly cost and revenue", () => {
    render(<PricingGuide />);
    const example = screen.getByRole("region", { name: "A two-hour Call" });
    expect(within(example).getByText("Inbound minutes, 120 at $0.0085").closest("li")).toHaveTextContent("$1.02");
    expect(within(example).getByText("Transcription, 240 channel minutes at $0.006").closest("li")).toHaveTextContent("$1.44");
    expect(within(example).getByText("Lead Assessment, 6,000 input and 400 output tokens").closest("li")).toHaveTextContent("$0.0023");
    expect(within(example).getByText("Total").closest("li")).toHaveTextContent("$4.44");
    const monthly = screen.getByRole("region", { name: "Monthly cost and revenue" });
    expect(within(monthly).getByText(/Telephony/)).toBeVisible();
    expect(within(monthly).getByText(/Per Lead/)).toBeVisible();
  });
});
