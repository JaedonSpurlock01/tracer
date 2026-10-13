/**
 * -------------------------------------------------------------------------
 * @file   health.test.ts
 * @brief  Verifies the public Tracer health interface.
 *
 * @description
 *  Sends an HTTP request through workerd and checks the typed JSON response.
 *
 * @remarks
 *  The health contract remains deterministic and excludes environment data.
 *
 * @see
 *  app/health/route.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { HealthResponse } from "../../app/health/route";

describe("health interface", () => {
  it("returns a successful typed response", async () => {
    const response = await SELF.fetch("http://tracer.test/health");
    const body = await response.json<HealthResponse>();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).toEqual({ status: "ok" });
  });
});
