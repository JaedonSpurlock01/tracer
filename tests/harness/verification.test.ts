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
 *  docs/SPECIFICATION.md
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
const verificationConfiguration = readFileSync(
  new URL("../../.github/workflows/verification.yml", import.meta.url),
  "utf8",
);
const playwrightConfiguration = readFileSync(
  new URL("../../playwright.config.ts", import.meta.url),
  "utf8",
);
const packageConfiguration = readFileSync(
  new URL("../../package.json", import.meta.url),
  "utf8",
);

describe("verification harness", () => {
  it("executes fast test assertions", () => {
    expect(true).toBe(true);
  });

  it("runs the E2E web server in development with the explicit auth fake", () => {
    expect(playwrightConfiguration).toContain('E2E_AUTH_FAKE: "true"');
    expect(playwrightConfiguration).toContain('E2E_TWILIO_FAKE: "true"');
    expect(playwrightConfiguration).toContain('E2E_TRIGGER_FAKE: "true"');
    expect(playwrightConfiguration).toContain('NODE_ENV: "development"');
    expect(playwrightConfiguration).toContain("TWILIO_CREDENTIAL_MASTER_KEY");
    expect(packageConfiguration).toContain("TWILIO_CREDENTIAL_MASTER_KEY");
  });

  it("selects the credential-free OpenNext platform config for E2E", () => {
    expect(nextConfiguration).toContain('configPath: "wrangler.test.jsonc"');
    expect(nextConfiguration).toContain("envFiles: []");
  });

  it("keeps full verification commands observable and ordered", () => {
    const fullStart = verificationConfiguration.indexOf("  full-verification:");
    const fullEnd = verificationConfiguration.indexOf("  typecheck:", fullStart);
    const fullVerification = verificationConfiguration.slice(fullStart, fullEnd);
    const commands = [
      "pnpm test",
      "pnpm test:integration",
      "pnpm exec playwright install --with-deps chromium",
      "pnpm test:e2e",
      "pnpm typecheck",
      "pnpm lint",
      "pnpm build",
    ];
    let previous = -1;
    for (const command of commands) {
      const index = fullVerification.indexOf(`run: ${command}`);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
    expect(fullVerification).not.toContain("pnpm verify:full");
  });
});
