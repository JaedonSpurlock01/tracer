/**
 * -------------------------------------------------------------------------
 * @file   vitest.workers.config.ts
 * @brief  Runs Tracer Worker tests in workerd.
 *
 * @description
 *  Connects Vitest to the Cloudflare runtime using the test Worker config.
 *
 * @remarks
 *  Worker tests exercise HTTP responses without requiring a production build.
 *
 * @see
 *  wrangler.test.jsonc
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
    }),
  ],
  test: {
    include: ["tests/workers/**/*.test.ts"],
  },
});
