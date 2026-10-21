/**
 * -------------------------------------------------------------------------
 * @file   cloudflare-runtime.ts
 * @brief  Selects the runtime Cloudflare provider boundary.
 *
 * @description
 *  Uses the deterministic E2E fake only when explicitly enabled outside
 *  production, otherwise returning the real REST and GraphQL client.
 *
 * @remarks
 *  Production cannot select the in-memory fake even if an environment flag is
 *  accidentally present.
 *
 * @see
 *  data/e2e-cloudflare-fake.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createCloudflareClient, type CloudflareClient } from "@/data/cloudflare-client";
import { createE2eCloudflareFake } from "@/data/e2e-cloudflare-fake";

export function isE2eCloudflareFake(): boolean {
  return process.env.E2E_CLOUDFLARE_FAKE === "true" && process.env.NODE_ENV !== "production";
}

export function createRuntimeCloudflareClient(): CloudflareClient {
  return isE2eCloudflareFake() ? createE2eCloudflareFake() : createCloudflareClient();
}
