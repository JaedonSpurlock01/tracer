/**
 * -------------------------------------------------------------------------
 * @file   provider-health.ts
 * @brief  Describes configured provider health for the Integrations surface.
 *
 * @description
 *  Converts runtime configuration, persisted Twilio state, persisted
 *  Recording transfer outcomes, and persisted Transcript and Lead Assessment
 *  outcomes into stable provider health records without contacting
 *  external services.
 *
 * @remarks
 *  Deferred provider tests remain explicitly non-testable until their owning
 *  milestones add connection actions. R2 and Trigger.dev report Tracer's own
 *  Recording transfer history instead of calling either provider, and are
 *  degraded while the newest transfer failure follows the last success.
 *  OpenAI reports its fixed transcription and Lead Assessment models, the
 *  last successful Transcript and Lead Assessment, and how many Recordings
 *  have a Failed Transcript or Lead Assessment, and is degraded while the
 *  newest of those failures follows the last success. Failure reasons are
 *  left to Call Detail so this card carries no Call content.
 *
 * @see
 *  data/integrations.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { TwilioConnectionRecord } from "@/data/integrations";
import { leadAssessmentModel } from "@/data/lead-assessment";
import { transcriptionModel } from "@/data/openai-client";

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
  recentFailures?: RecordingTransferFailure[];
  analysis?: OpenAIAnalysisHealth;
}

export interface AnalysisProcessingHealth {
  lastTranscriptAt: string | null;
  lastLeadAssessmentAt: string | null;
  failedCount: number;
  lastFailureAt: string | null;
}

export interface OpenAIAnalysisHealth extends AnalysisProcessingHealth {
  transcriptionModel: string;
  leadAssessmentModel: string;
}

export interface RecordingTransferFailure {
  stage: string;
  reason: string;
  at: string;
}

export interface RecordingTransferHealth {
  lastStoredAt: string | null;
  recentFailures: RecordingTransferFailure[];
}

export interface ProviderConfiguration {
  twilioMasterKey: boolean;
  hyperdrive: boolean;
  email: boolean;
  emailFrom: string | null;
  emailAllowlistCount: number;
  r2: boolean;
  r2Bucket: string | null;
  openai: boolean;
  triggerdev: boolean;
}

function openAIProvider(configured: boolean, analysis: AnalysisProcessingHealth): ProviderHealth {
  const successes = [analysis.lastTranscriptAt, analysis.lastLeadAssessmentAt].filter((at): at is string => at !== null).sort();
  const lastSuccessAt = successes.at(-1) ?? null;
  const failedSinceSuccess = Boolean(analysis.lastFailureAt && (!lastSuccessAt || analysis.lastFailureAt > lastSuccessAt));
  return {
    id: "openai",
    name: "OpenAI",
    state: !configured ? "not_configured" : failedSinceSuccess ? "degraded" : "configured",
    identifier: "OPENAI_API_KEY",
    lastSuccessAt,
    lastFailureAt: analysis.lastFailureAt,
    lastFailureDetail: null,
    testable: false,
    note: "Test Connection arrives with its milestone",
    analysis: { transcriptionModel, leadAssessmentModel, ...analysis },
  };
}

function recordingTransferProvider(
  id: "r2" | "triggerdev",
  name: string,
  configured: boolean,
  identifier: string | null,
  transfers: RecordingTransferHealth,
): ProviderHealth {
  const latestFailure = transfers.recentFailures[0];
  const failedSinceSuccess = Boolean(latestFailure && (!transfers.lastStoredAt || latestFailure.at > transfers.lastStoredAt));
  return {
    id,
    name,
    state: !configured ? "not_configured" : failedSinceSuccess ? "degraded" : "configured",
    identifier,
    lastSuccessAt: transfers.lastStoredAt,
    lastFailureAt: latestFailure?.at ?? null,
    lastFailureDetail: latestFailure?.reason ?? null,
    testable: false,
    note: "Test Connection arrives with its milestone",
    recentFailures: transfers.recentFailures,
  };
}

export function describeProviderHealth(
  configuration: ProviderConfiguration,
  twilio: TwilioConnectionRecord | null,
  recordingTransfers: RecordingTransferHealth,
  analysis: AnalysisProcessingHealth,
): ProviderHealth[] {
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
    recordingTransferProvider("r2", "Cloudflare R2", configuration.r2, configuration.r2Bucket, recordingTransfers),
    openAIProvider(configuration.openai, analysis),
    recordingTransferProvider("triggerdev", "Trigger.dev", configuration.triggerdev, "TRIGGER_SECRET_KEY", recordingTransfers),
  ];
}
