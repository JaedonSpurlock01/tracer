/**
 * -------------------------------------------------------------------------
 * @file   navigation-timing.spec.ts
 * @brief  Reports how long the main pages take to answer on a warm second visit.
 *
 * @description
 *  Signs in as the Operator, visits Home, Workspaces, Calls, Activity, and
 *  Integrations twice each, and records the server's time to first byte on
 *  the second visit, when the dev server has compiled the route. The numbers
 *  are attached to the test report and printed, and any page over the
 *  1500 ms dev-mode ceiling is called out as a warning.
 *
 * @remarks
 *  Informational by the Product Owner's decision on 2026-10-24: the run
 *  fails only when a page does not answer at all, never on the time, until
 *  a week of CI numbers shows the spread and the ceiling becomes a failing
 *  check. The e2e server is `next dev`, so first visits compile and are
 *  not measured. The deterministic performance budget lives in
 *  tests/integration/page-budgets.test.ts; the Production signal is the
 *  tracer.request log line.
 *
 * @see
 *  tests/integration/page-budgets.test.ts
 *  data/request-log.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { expect, test } from "@playwright/test";

import { signInAsOperator } from "./helpers";

export const navigationTimingCeilingMs = 1500;
const pages = ["/", "/workspaces", "/calls", "/activity", "/integrations"];

test("answers the main pages within the dev-mode ceiling on a warm visit", async ({ page, request }) => {
  test.setTimeout(180_000);
  await signInAsOperator(page, request);
  const timings: Array<{ path: string; serverMs: number }> = [];
  for (const path of pages) {
    await page.goto(path);
    const response = await page.goto(path);
    expect(response, `${path} answered`).not.toBeNull();
    expect(response!.status(), `${path} status`).toBeLessThan(400);
    const timing = response!.request().timing();
    const serverMs = Math.round(timing.responseStart - timing.requestStart);
    timings.push({ path, serverMs });
  }
  const report = timings.map((entry) => `${entry.path}: ${entry.serverMs} ms`).join("\n");
  await test.info().attach("navigation-timing", { body: report, contentType: "text/plain" });
  console.info(`navigation timing (warm second visit, dev server)\n${report}`);
  const slow = timings.filter((entry) => entry.serverMs > navigationTimingCeilingMs);
  if (slow.length > 0) {
    test.info().annotations.push({ type: "warning", description: `Over the ${navigationTimingCeilingMs} ms ceiling: ${slow.map((entry) => `${entry.path} ${entry.serverMs} ms`).join(", ")}` });
  }
});
