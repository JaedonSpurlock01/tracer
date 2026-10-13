/**
 * -------------------------------------------------------------------------
 * @file   playwright.config.ts
 * @brief  Configures Tracer's approved browser journeys.
 *
 * @description
 *  Prepares Playwright for the six journeys defined in the testing contract.
 *
 * @remarks
 *  M1 adds no browser journey before product behavior exists.
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
  use: {
    baseURL: "http://127.0.0.1:3000",
  },
  webServer: {
    command: "corepack pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
  },
});
