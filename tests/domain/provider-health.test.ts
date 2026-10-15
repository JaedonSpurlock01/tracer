/**
 * -------------------------------------------------------------------------
 * @file   provider-health.test.ts
 * @brief  Verifies provider configuration health descriptions.
 *
 * @description
 *  Covers configured, connected, degraded, and missing provider states.
 *
 * @remarks
 *  Provider health is pure and does not contact external services.
 *
 * @see
 *  data/provider-health.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { describeProviderHealth, type ProviderConfiguration } from "@/data/provider-health";
import type { TwilioConnectionRecord } from "@/data/integrations";

const configured: ProviderConfiguration = {
  twilioMasterKey: true,
  hyperdrive: true,
  email: true,
  emailFrom: "auth@example.com",
  emailAllowlistCount: 1,
  r2: false,
  openai: false,
  triggerdev: false,
};

const connection: TwilioConnectionRecord = {
  accountSid: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  apiKeySid: "SK11111111111111111111111111111111",
  accountFriendlyName: "Example Account",
  connectedAt: "2026-10-14T00:00:00.000Z",
  connectedBy: { id: "operator", name: "Operator" },
  lastVerifiedAt: "2026-10-14T01:00:00.000Z",
  lastFailureAt: null,
  lastFailureDetail: null,
  numbersSyncedAt: null,
  numberCount: 0,
};

describe("provider health", () => {
  it("describes configured platform providers in the stable order", () => {
    const health = describeProviderHealth(configured, null);

    expect(health.map((provider) => provider.id)).toEqual(["twilio", "hyperdrive", "email", "r2", "openai", "triggerdev"]);
    expect(health).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "hyperdrive", state: "configured", identifier: "HYPERDRIVE", testable: true }),
      expect.objectContaining({ id: "email", state: "configured", identifier: "auth@example.com", testable: true }),
      expect.objectContaining({ id: "r2", state: "not_configured", identifier: "R2", testable: false }),
    ]));
  });

  it("describes missing Twilio master key and connection", () => {
    const withoutMasterKey = describeProviderHealth({ ...configured, twilioMasterKey: false }, null)[0];
    const withoutConnection = describeProviderHealth(configured, null)[0];

    expect(withoutMasterKey).toMatchObject({ state: "not_configured", testable: false, note: "The TWILIO_CREDENTIAL_MASTER_KEY deployment secret is missing" });
    expect(withoutConnection).toMatchObject({ state: "not_configured", testable: false, note: "No Organization Twilio credential is connected" });
  });

  it("marks a connection degraded after a newer failure", () => {
    const degraded = describeProviderHealth(configured, {
      ...connection,
      lastFailureAt: "2026-10-14T02:00:00.000Z",
      lastFailureDetail: "Twilio rejected the credential (HTTP 401)",
    })[0];

    expect(degraded).toMatchObject({ state: "degraded", identifier: connection.accountSid, lastSuccessAt: connection.lastVerifiedAt, testable: true });
  });

  it("describes email with an empty allowlist as degraded", () => {
    const email = describeProviderHealth({ ...configured, emailAllowlistCount: 0 }, null).find((provider) => provider.id === "email");

    expect(email).toMatchObject({ state: "degraded", note: "The recipient allowlist is empty, so sends are disabled", testable: false });
  });
});
