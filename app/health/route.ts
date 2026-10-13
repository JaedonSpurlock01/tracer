/**
 * -------------------------------------------------------------------------
 * @file   route.ts
 * @brief  Exposes the Tracer health endpoint.
 *
 * @description
 *  Returns a deterministic JSON response for Local and Preview health checks.
 *
 * @remarks
 *  The contract excludes environment and dependency details during M1.
 *
 * @see
 *  tests/workers/health.test.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export interface HealthResponse {
  status: "ok";
}

export function GET(): Response {
  return Response.json({ status: "ok" } satisfies HealthResponse);
}
