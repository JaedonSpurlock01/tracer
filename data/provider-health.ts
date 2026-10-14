/**
 * -------------------------------------------------------------------------
 * @file   provider-health.ts
 * @brief  Describes configured provider health for the Integrations surface.
 *
 * @description
 *  Converts runtime configuration and persisted Twilio state into stable
 *  provider health records without contacting external services.
 *
 * @remarks
 *  Deferred provider tests remain explicitly non-testable until their owning
 *  milestones add connection actions.
 *
 * @see
 *  data/integrations.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { TwilioConnectionRecord } from "@/data/integrations";

export type ProviderId = "twilio" | "r2" | "openai" | "triggerdev" | "hyperdrive" | "email";
export type ProviderState = "connected" | "configured" | "degraded" | "not_configured";

export interface ProviderHealth {
  id: ProviderId;
  name: string;
  state: ProviderState;
  identifier: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureDetail: string | null;
  testable: boolean;
  note: string | null;
}

export interface ProviderConfiguration {
  twilioMasterKey: boolean;
  hyperdrive: boolean;
  email: boolean;
  emailFrom: string | null;
  emailAllowlistCount: number;
  r2: boolean;
  openai: boolean;
  triggerdev: boolean;
}

function staticProvider(
  id: Exclude<ProviderId, "twilio" | "email" | "hyperdrive">,
  name: string,
  configured: boolean,
  identifier: string,
): ProviderHealth {
  return {
    id,
    name,
    state: configured ? "configured" : "not_configured",
    identifier,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureDetail: null,
    testable: false,
    note: "Test Connection arrives with its milestone",
  };
}

export function describeProviderHealth(configuration: ProviderConfiguration, twilio: TwilioConnectionRecord | null): ProviderHealth[] {
  const twilioHealth: ProviderHealth = !configuration.twilioMasterKey
    ? {
        id: "twilio",
        name: "Twilio",
        state: "not_configured",
        identifier: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastFailureDetail: null,
        testable: false,
        note: "The TWILIO_CREDENTIAL_MASTER_KEY deployment secret is missing",
      }
    : !twilio
      ? {
          id: "twilio",
          name: "Twilio",
          state: "not_configured",
          identifier: null,
          lastSuccessAt: null,
          lastFailureAt: null,
          lastFailureDetail: null,
          testable: false,
          note: "No Organization Twilio credential is connected",
        }
      : {
          id: "twilio",
          name: "Twilio",
          state: twilio.lastFailureAt && (!twilio.lastVerifiedAt || twilio.lastFailureAt > twilio.lastVerifiedAt) ? "degraded" : "connected",
          identifier: twilio.accountSid,
          lastSuccessAt: twilio.lastVerifiedAt,
          lastFailureAt: twilio.lastFailureAt,
          lastFailureDetail: twilio.lastFailureDetail,
          testable: true,
          note: null,
        };
  const hyperdrive: ProviderHealth = {
    id: "hyperdrive",
    name: "Hyperdrive",
    state: configuration.hyperdrive ? "configured" : "not_configured",
    identifier: "HYPERDRIVE",
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureDetail: null,
    testable: configuration.hyperdrive,
    note: null,
  };
  const email: ProviderHealth = {
    id: "email",
    name: "Cloudflare Email Service",
    state: !configuration.email ? "not_configured" : configuration.emailAllowlistCount === 0 ? "degraded" : "configured",
    identifier: configuration.emailFrom,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureDetail: null,
    testable: configuration.email && configuration.emailAllowlistCount > 0,
    note: !configuration.email
      ? null
      : configuration.emailAllowlistCount === 0
        ? "The recipient allowlist is empty, so sends are disabled"
        : null,
  };
  return [
    twilioHealth,
    hyperdrive,
    email,
    staticProvider("r2", "Cloudflare R2", configuration.r2, "R2"),
    staticProvider("openai", "OpenAI", configuration.openai, "OPENAI_API_KEY"),
    staticProvider("triggerdev", "Trigger.dev", configuration.triggerdev, "TRIGGER_SECRET_KEY"),
  ];
}
