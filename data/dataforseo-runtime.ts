/**
 * -------------------------------------------------------------------------
 * @file   dataforseo-runtime.ts
 * @brief  Selects the runtime DataForSEO provider boundary.
 *
 * @description
 *  Uses the deterministic E2E fake only when explicitly enabled outside
 *  production, otherwise returning the real REST client.
 *
 * @remarks
 *  Production cannot select the in-memory fake even if an environment flag is
 *  accidentally present.
 *
 * @see
 *  data/e2e-dataforseo-fake.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createDataForSeoClient, type DataForSeoClient } from "@/data/dataforseo-client";
import { createE2eDataForSeoFake } from "@/data/e2e-dataforseo-fake";

export function isE2eDataForSeoFake(): boolean {
  return process.env.E2E_DATAFORSEO_FAKE === "true" && process.env.NODE_ENV !== "production";
}

export function createRuntimeDataForSeoClient(): DataForSeoClient {
  return isE2eDataForSeoFake() ? createE2eDataForSeoFake() : createDataForSeoClient();
}
