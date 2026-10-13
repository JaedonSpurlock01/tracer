/**
 * -------------------------------------------------------------------------
 * @file   database-smoke.test.ts
 * @brief  Verifies the protected database smoke interface.
 *
 * @description
 *  Sends HTTP requests through workerd and proves the Staging-only database
 *  smoke route is unavailable when its deployment secret is absent.
 *
 * @remarks
 *  Production and ordinary Preview deployments do not configure the token.
 *
 * @see
 *  app/internal/smoke/database/route.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("hides the database smoke interface when its Staging token is absent", async () => {
  const response = await SELF.fetch("http://tracer.test/internal/smoke/database", {
    method: "POST",
  });

  expect(response.status).toBe(404);
});
