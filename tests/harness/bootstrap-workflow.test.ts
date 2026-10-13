/**
 * -------------------------------------------------------------------------
 * @file   bootstrap-workflow.test.ts
 * @brief  Verifies the protected Bootstrap Authentication workflow contract.
 *
 * @description
 *  Reads the committed workflow text and checks manual gating, validation
 *  ordering, secret boundaries, and safe workflow-input handling.
 *
 * @remarks
 *  Assertions intentionally avoid a YAML parser so the harness stays small.
 *
 * @see
 *  .github/workflows/bootstrap-auth.yml
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../.github/workflows/bootstrap-auth.yml", import.meta.url),
  "utf8",
);

it("defines a protected manual Bootstrap Authentication workflow", () => {
  expect(workflow).toContain("name: Bootstrap Authentication");
  expect(workflow).toContain("  workflow_dispatch:");
  expect(workflow).not.toContain("  push:");
  expect(workflow).not.toContain("  pull_request:");
  expect(workflow).toContain("    environment: tracer");
  expect(workflow).toContain("permissions:\n  contents: read");
  expect(workflow).toContain("  group: bootstrap-authentication-staging");
  expect(workflow).toContain("  cancel-in-progress: false");
  expect(workflow).toContain("      operator_email:");
  expect(workflow).toContain("      operator_name:");
  expect(workflow).toContain("      operator_timezone:");
  expect(workflow.match(/operator_email:[\s\S]*?required: true/)?.[0]).toBeTruthy();
  expect(workflow.match(/operator_name:[\s\S]*?required: true/)?.[0]).toBeTruthy();
  expect(workflow.match(/operator_timezone:[\s\S]*?required: true/)?.[0]).toBeTruthy();

  const testIndex = workflow.indexOf("pnpm test");
  const integrationIndex = workflow.indexOf("pnpm test:integration");
  const migrateIndex = workflow.indexOf("pnpm db:migrate");
  const grantIndex = workflow.indexOf("pnpm db:grant-runtime");
  const bootstrapIndex = workflow.indexOf("pnpm auth:bootstrap");
  expect(testIndex).toBeGreaterThan(-1);
  expect(integrationIndex).toBeGreaterThan(testIndex);
  expect(migrateIndex).toBeGreaterThan(integrationIndex);
  expect(grantIndex).toBeGreaterThan(migrateIndex);
  expect(bootstrapIndex).toBeGreaterThan(grantIndex);

  expect(workflow).toContain("DATABASE_MIGRATION_URL: ${{ secrets.DATABASE_MIGRATION_URL }}");
  expect(workflow).toContain("DATABASE_RUNTIME_PASSWORD: ${{ secrets.DATABASE_RUNTIME_PASSWORD }}");
  const bootstrapRun = workflow.slice(workflow.indexOf("        run: >-"));
  expect(bootstrapRun).toContain('pnpm auth:bootstrap\n          --email "$OPERATOR_EMAIL"\n          --name "$OPERATOR_NAME"\n          --timezone "$OPERATOR_TIMEZONE"');
  expect(bootstrapRun).not.toContain("${{ inputs.operator_email }}");
  expect(bootstrapRun).not.toContain("${{ inputs.operator_name }}");
  expect(bootstrapRun).not.toContain("${{ inputs.operator_timezone }}");
});
