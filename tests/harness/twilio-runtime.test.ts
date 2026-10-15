/**
 * -------------------------------------------------------------------------
 * @file   twilio-runtime.test.ts
 * @brief  Verifies the explicit E2E Twilio provider boundary.
 *
 * @description
 *  Ensures the in-memory provider is selected only with the E2E flag and a
 *  non-production runtime.
 *
 * @remarks
 *  Environment state is restored after every selection check.
 *
 * @see
 *  data/twilio-runtime.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRuntimeTwilioClient } from "@/data/twilio-runtime";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Twilio runtime selection", () => {
  it("selects the fake only with the E2E flag outside production", async () => {
    vi.stubEnv("E2E_TWILIO_FAKE", "true");
    vi.stubEnv("NODE_ENV", "development");
    await expect(
      createRuntimeTwilioClient().fetchAccount({ accountSid: "ACtest", apiKeySid: "SKtest", apiKeySecret: "secret" }),
    ).resolves.toMatchObject({ friendlyName: "E2E Account" });

    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(
      createRuntimeTwilioClient().fetchIncomingPhoneNumber(
        { accountSid: "ACtest", apiKeySid: "SKtest", apiKeySecret: "secret" },
        "PNe2e0001",
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
