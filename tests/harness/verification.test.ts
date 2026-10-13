/**
 * -------------------------------------------------------------------------
 * @file   verification.test.ts
 * @brief  Proves the fast verification harness executes assertions.
 *
 * @description
 *  Provides a deterministic assertion used to validate the test command.
 *
 * @remarks
 *  This fixture is intentionally failed once before its passing form is kept.
 *
 * @see
 *  README.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const nextConfiguration = readFileSync(
  new URL("../../next.config.ts", import.meta.url),
  "utf8",
);
const playwrightConfiguration = readFileSync(
  new URL("../../playwright.config.ts", import.meta.url),
  "utf8",
);

describe("verification harness", () => {
  it("executes fast test assertions", () => {
    expect(true).toBe(true);
  });

  it("runs the E2E web server in development with the explicit auth fake", () => {
    expect(playwrightConfiguration).toContain('E2E_AUTH_FAKE: "true"');
    expect(playwrightConfiguration).toContain('NODE_ENV: "development"');
  });

  it("selects the credential-free OpenNext platform config for E2E", () => {
    expect(nextConfiguration).toContain('configPath: "wrangler.test.jsonc"');
    expect(nextConfiguration).toContain("envFiles: []");
  });
});
