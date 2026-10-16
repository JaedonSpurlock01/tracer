/**
 * -------------------------------------------------------------------------
 * @file   playwright.config.ts
 * @brief  Configures Tracer's approved browser journeys.
 *
 * @description
 *  Prepares Playwright for the six journeys defined in the testing contract.
 *
 * @remarks
 *  The web server timeout covers a cold migrate, bootstrap, Next.js start, and
 *  the first compile of the authenticated shell on slower local machines.
 *
 * @see
 *  README.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:3000",
  },
  webServer: {
    command:
      'corepack pnpm db:migrate && corepack pnpm auth:bootstrap --email operator@example.com --name "Example Operator" --timezone America/Chicago && corepack pnpm dev',
    url: "http://127.0.0.1:3000",
    timeout: 420_000,
    reuseExistingServer: !process.env.CI,
    env: {
      E2E_AUTH_FAKE: "true",
      E2E_TWILIO_FAKE: "true",
      NODE_ENV: "development",
      DATABASE_MIGRATION_URL: "postgresql://postgres:postgres@127.0.0.1:5433/tracer_e2e",
      AUTH_EMAIL_FROM: "auth@example.com",
      AUTH_EMAIL_ALLOWED_RECIPIENTS: "operator@example.com,client@example.com",
      BETTER_AUTH_SECRET: "e2e-only-secret-that-is-not-a-credential",
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      TWILIO_CREDENTIAL_MASTER_KEY: "bG9jYWwtZGV2LW9ubHktbWFzdGVyLWtleS0zMmJ5dGU=",
    },
  },
});
