/**
 * -------------------------------------------------------------------------
 * @file   twilio-runtime.ts
 * @brief  Selects the runtime Twilio provider boundary.
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
 *  data/e2e-twilio-fake.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createE2eTwilioFake } from "@/data/e2e-twilio-fake";
import { createTwilioRestClient, type TwilioClient } from "@/data/twilio-client";

export function createRuntimeTwilioClient(): TwilioClient {
  return process.env.E2E_TWILIO_FAKE === "true" && process.env.NODE_ENV !== "production" ? createE2eTwilioFake() : createTwilioRestClient();
}
