/**
 * -------------------------------------------------------------------------
 * @file   twilio-signature.test.ts
 * @brief  Verifies Twilio webhook signature validation against Twilio's contract.
 *
 * @description
 *  Uses Twilio's published worked example to prove that genuine signatures
 *  pass and tampered requests, wrong Auth Tokens, or missing signatures fail.
 *
 * @remarks
 *  The fixture comes from Twilio's security documentation so the expected
 *  signature is independent of Tracer's implementation.
 *
 * @see
 *  data/twilio-signature.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import signedWebhook from "./fixtures/twilio/signed-voice-webhook.json";
import { describe, expect, it } from "vitest";

import { isValidTwilioSignature } from "@/data/twilio-signature";

const valid = {
  authToken: signedWebhook.authToken,
  url: signedWebhook.url,
  params: signedWebhook.params,
  signature: signedWebhook.signature,
};

describe("Twilio webhook signature", () => {
  it("accepts a valid signature", async () => {
    await expect(isValidTwilioSignature(valid)).resolves.toBe(true);
  });

  it("rejects a request whose parameters were changed after signing", async () => {
    await expect(isValidTwilioSignature({ ...valid, params: { ...valid.params, To: "+18005559999" } })).resolves.toBe(false);
  });

  it("rejects a request signed for a different URL", async () => {
    await expect(isValidTwilioSignature({ ...valid, url: "https://example.com/other.php?foo=1&bar=2" })).resolves.toBe(false);
  });

  it("rejects a signature made with a different Auth Token", async () => {
    await expect(isValidTwilioSignature({ ...valid, authToken: "54321" })).resolves.toBe(false);
  });

  it("rejects a missing signature", async () => {
    await expect(isValidTwilioSignature({ ...valid, signature: null })).resolves.toBe(false);
  });
});
