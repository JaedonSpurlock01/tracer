/**
 * -------------------------------------------------------------------------
 * @file   route.ts
 * @brief  Exposes the explicit non-production E2E OTP test seam.
 *
 * @description
 *  Returns the latest fake email code only when the E2E flag is exactly true
 *  and the runtime is not production.
 *
 * @remarks
 *  This endpoint is inaccessible in production and when the fake is disabled.
 *
 * @see
 *  data/e2e-auth-fake.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";

import { readE2eOtp } from "@/data/e2e-auth-fake";

export async function GET(): Promise<Response> {
  const { env } = await getCloudflareContext({ async: true });
  const bindings = env as { E2E_AUTH_FAKE?: string; NODE_ENV?: string };
  const enabled = (bindings.E2E_AUTH_FAKE ?? process.env.E2E_AUTH_FAKE) === "true";
  const production = (bindings.NODE_ENV ?? process.env.NODE_ENV) === "production";
  if (!enabled || production) {
    return new Response(null, { status: 404 });
  }

  return Response.json({ code: readE2eOtp() });
}
