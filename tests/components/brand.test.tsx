/**
 * -------------------------------------------------------------------------
 * @file   brand.test.tsx
 * @brief  Tests the Tracer mark and its lockup.
 *
 * @description
 *  Covers the Waveform mark: five bars drawn inline at the requested size
 *  and hidden from assistive technology, and the lockup that pairs it with
 *  the Tracer wordmark.
 *
 * @see
 *  docs/brand/README.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { BrandLockup, BrandMark } from "@/components/tracer/brand";

afterEach(cleanup);

it("draws the Waveform mark as five inline bars at the requested size", () => {
  const { container } = render(<BrandMark size={40} />);

  const mark = container.querySelector("svg");
  expect(mark).toHaveAttribute("width", "40");
  expect(mark).toHaveAttribute("height", "40");
  expect(mark).toHaveAttribute("aria-hidden", "true");
  expect(mark?.querySelectorAll("rect")).toHaveLength(5);
});

it("pairs the mark with the Tracer wordmark", () => {
  const { container } = render(<BrandLockup />);

  expect(screen.getByText("Tracer")).toBeInTheDocument();
  expect(container.querySelectorAll("svg")).toHaveLength(1);
});
