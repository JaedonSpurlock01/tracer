/**
 * -------------------------------------------------------------------------
 * @file   deploy-production-workflow.test.ts
 * @brief  Guards the manual Deploy Production GitHub workflow.
 *
 * @description
 *  Reads the workflow file and checks that Production is changed only by a
 *  manual run in the protected Production environment, that the code is
 *  verified before the database changes, that the Worker and the matching
 *  Trigger.dev task version deploy together, and that nothing points at
 *  Staging.
 *
 * @remarks
 *  Mirrors the Deploy Staging steps so a Staging rehearsal predicts the
 *  Production run. The Trigger.dev deploy runs in the same job so the task
 *  version always matches the Worker build.
 *
 * @see
 *  .github/workflows/deploy-production.yml
 *  docs/IMPLEMENTATION_ROADMAP.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/deploy-production.yml", import.meta.url),
  "utf8",
);

it("runs only by hand in the protected Production environment", () => {
  expect(workflow).toContain("name: Deploy Production");
  expect(workflow).toContain("  workflow_dispatch:");
  expect(workflow).not.toContain("  push:");
  expect(workflow).not.toContain("  pull_request:");
  expect(workflow).not.toContain("  workflow_call:");
  expect(workflow).toContain("    environment: Production");
  expect(workflow).toContain("permissions:\n  contents: read");
  expect(workflow).toContain("  group: deploy-production");
  expect(workflow).toContain("  cancel-in-progress: false");
});

it("verifies the code, changes the database, then deploys the Worker and matching tasks", () => {
  const order = [
    "pnpm test",
    "pnpm typecheck",
    "pnpm lint",
    "pnpm db:migrate",
    "pnpm db:grant-runtime",
    "pnpm exec opennextjs-cloudflare build",
    'pnpm exec wrangler deploy --env ""',
    "pnpm exec trigger deploy --env prod",
    "https://tracer.jaedonaspurlock.workers.dev/health",
  ].map((step) => workflow.indexOf(step));
  expect(order.every((index) => index > -1)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));

  expect(workflow).toContain("DATABASE_MIGRATION_URL: ${{ secrets.DATABASE_MIGRATION_URL }}");
  expect(workflow).toContain("DATABASE_RUNTIME_PASSWORD: ${{ secrets.DATABASE_RUNTIME_PASSWORD }}");
  expect(workflow).toContain("TRIGGER_ACCESS_TOKEN: ${{ secrets.TRIGGER_ACCESS_TOKEN }}");
});

it("never points at Staging", () => {
  expect(workflow).not.toContain("staging");
  expect(workflow).not.toContain("environment: tracer");
});
