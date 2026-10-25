/**
 * -------------------------------------------------------------------------
 * @file   provider-health.ts
 * @brief  Describes configured provider health for the Integrations surface.
 *
 * @description
 *  Converts runtime configuration, persisted Twilio, Cloudflare, and
 *  DataForSEO state, persisted
 *  Recording transfer outcomes, persisted Transcript and Lead Assessment
 *  outcomes, and unfinished media cleanup into stable provider health
 *  records without contacting external services.
 *
 * @remarks
 *  A connection whose credential the deployment's master key cannot open is
 *  Needs re-entry ahead of connected or degraded: nothing can be tested
 *  until the Operator re-enters it or disconnects. Deferred provider tests
 *  remain explicitly non-testable until their owning milestones add
 *  connection actions. R2 and Trigger.dev report Tracer's own
 *  Recording transfer history instead of calling either provider, and are
 *  degraded while the newest transfer failure follows the last success.
 *  OpenAI reports its fixed transcription and Lead Assessment models, the
 *  last successful Transcript and Lead Assessment, and how many Recordings
 *  have a Failed Transcript or Lead Assessment, and is degraded while the
 *  newest of those failures follows the last success. Failure reasons are
 *  left to Call Detail so this card carries no Call content. Trigger.dev,
 *  which runs the media retention sweep, also carries the unfinished media
 *  cleanup and is degraded while any purged or expired Recording's cleanup
 *  is stuck.
 *
 * @see
 *  data/integrations.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { CloudflareConnectionRecord } from "@/data/cloudflare-connection";
import type { DataForSeoConnectionRecord } from "@/data/dataforseo-connection";
import type { TwilioConnectionRecord } from "@/data/integrations";
import { leadAssessmentModel } from "@/data/lead-assessment";
import { transcriptionModel } from "@/data/openai-client";
import { unreadableCredentialDetail } from "@/data/provider-credential";

export const providerIds = ["twilio", "cloudflare", "dataforseo", "hyperdrive", "email", "r2", "openai", "triggerdev"] as const;
export type ProviderId = (typeof providerIds)[number];
export type ProviderState = "connected" | "configured" | "degraded" | "needs_reentry" | "not_configured";
/** Organization connections hold credentials entered on the Integrations page; platform services are deployment secrets or bindings. */
export type ProviderGroup = "connection" | "service";

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (providerIds as readonly string[]).includes(value);
}

export interface ProviderHealth {
  id: ProviderId;
  name: string;
  group: ProviderGroup;
  state: ProviderState;
  identifier: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureDetail: string | null;
  testable: boolean;
  /** True when an Operator can connect the credential from the Integrations page right now. */
  connectable: boolean;
  note: string | null;
  recentFailures?: RecordingTransferFailure[];
  analysis?: OpenAIAnalysisHealth;
  mediaLifecycle?: MediaLifecycleHealth;
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

export interface StuckMediaCleanup {
  callId: string;
  workspaceId: string;
  workspaceName: string;
  media: "Purged" | "Expired";
  since: string;
  twilioNotConnected: boolean;
}

export interface MediaLifecycleHealth {
  stuckCount: number;
  oldestStuck: StuckMediaCleanup[];
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
    group: "service",
    connectable: false,
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
  mediaLifecycle?: MediaLifecycleHealth,
): ProviderHealth {
  const latestFailure = transfers.recentFailures[0];
  const failedSinceSuccess = Boolean(latestFailure && (!transfers.lastStoredAt || latestFailure.at > transfers.lastStoredAt));
  return {
    id,
    name,
    state: !configured ? "not_configured" : failedSinceSuccess || (mediaLifecycle?.stuckCount ?? 0) > 0 ? "degraded" : "configured",
    identifier,
    lastSuccessAt: transfers.lastStoredAt,
    lastFailureAt: latestFailure?.at ?? null,
    lastFailureDetail: latestFailure?.reason ?? null,
    testable: false,
    group: "service",
    connectable: false,
    note: "Test Connection arrives with its milestone",
    recentFailures: transfers.recentFailures,
    ...(mediaLifecycle ? { mediaLifecycle } : {}),
  };
}

export function describeProviderHealth(
  configuration: ProviderConfiguration,
  twilio: TwilioConnectionRecord | null,
  recordingTransfers: RecordingTransferHealth,
  analysis: AnalysisProcessingHealth,
  mediaLifecycle: MediaLifecycleHealth,
  cloudflare: CloudflareConnectionRecord | null = null,
  dataforseo: DataForSeoConnectionRecord | null = null,
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
        group: "connection",
        connectable: false,
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
          group: "connection",
          connectable: true,
          note: "No Organization Twilio credential is connected",
        }
      : {
          id: "twilio",
          name: "Twilio",
          state: twilio.credentialState === "unreadable" ? "needs_reentry" : twilio.lastFailureAt && (!twilio.lastVerifiedAt || twilio.lastFailureAt > twilio.lastVerifiedAt) ? "degraded" : "connected",
          identifier: twilio.accountSid,
          lastSuccessAt: twilio.lastVerifiedAt,
          lastFailureAt: twilio.lastFailureAt,
          lastFailureDetail: twilio.lastFailureDetail,
          testable: twilio.credentialState === "readable",
          group: "connection",
          connectable: false,
          note: twilio.credentialState === "unreadable" ? unreadableCredentialDetail : null,
        };
  const cloudflareHealth: ProviderHealth = !configuration.twilioMasterKey
    ? {
        id: "cloudflare",
        name: "Cloudflare",
        state: "not_configured",
        identifier: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastFailureDetail: null,
        testable: false,
        group: "connection",
        connectable: false,
        note: "The TWILIO_CREDENTIAL_MASTER_KEY deployment secret is missing",
      }
    : !cloudflare
      ? {
          id: "cloudflare",
          name: "Cloudflare",
          state: "not_configured",
          identifier: null,
          lastSuccessAt: null,
          lastFailureAt: null,
          lastFailureDetail: null,
          testable: false,
          group: "connection",
          connectable: true,
          note: "No Organization Cloudflare credential is connected",
        }
      : {
          id: "cloudflare",
          name: "Cloudflare",
          state: cloudflare.credentialState === "unreadable" ? "needs_reentry" : cloudflare.lastFailureAt && (!cloudflare.lastVerifiedAt || cloudflare.lastFailureAt > cloudflare.lastVerifiedAt) ? "degraded" : "connected",
          identifier: cloudflare.accountId,
          lastSuccessAt: cloudflare.lastVerifiedAt,
          lastFailureAt: cloudflare.lastFailureAt,
          lastFailureDetail: cloudflare.lastFailureDetail,
          testable: cloudflare.credentialState === "readable",
          group: "connection",
          connectable: false,
          note: cloudflare.credentialState === "unreadable" ? unreadableCredentialDetail : null,
        };
  const dataforseoHealth: ProviderHealth = !configuration.twilioMasterKey
    ? {
        id: "dataforseo",
        name: "DataForSEO",
        state: "not_configured",
        identifier: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastFailureDetail: null,
        testable: false,
        group: "connection",
        connectable: false,
        note: "The TWILIO_CREDENTIAL_MASTER_KEY deployment secret is missing",
      }
    : !dataforseo
      ? {
          id: "dataforseo",
          name: "DataForSEO",
          state: "not_configured",
          identifier: null,
          lastSuccessAt: null,
          lastFailureAt: null,
          lastFailureDetail: null,
          testable: false,
          group: "connection",
          connectable: true,
          note: "No Organization DataForSEO credential is connected",
        }
      : {
          id: "dataforseo",
          name: "DataForSEO",
          state: dataforseo.credentialState === "unreadable" ? "needs_reentry" : dataforseo.lastFailureAt && (!dataforseo.lastVerifiedAt || dataforseo.lastFailureAt > dataforseo.lastVerifiedAt) ? "degraded" : "connected",
          identifier: dataforseo.login,
          lastSuccessAt: dataforseo.lastVerifiedAt,
          lastFailureAt: dataforseo.lastFailureAt,
          lastFailureDetail: dataforseo.lastFailureDetail,
          testable: dataforseo.credentialState === "readable",
          group: "connection",
          connectable: false,
          note: dataforseo.credentialState === "unreadable" ? unreadableCredentialDetail : null,
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
    group: "service",
    connectable: false,
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
    group: "service",
    connectable: false,
    note: !configuration.email
      ? null
      : configuration.emailAllowlistCount === 0
        ? "The recipient allowlist is empty, so sends are disabled"
        : null,
  };
  return [
    twilioHealth,
    cloudflareHealth,
    dataforseoHealth,
    hyperdrive,
    email,
    recordingTransferProvider("r2", "Cloudflare R2", configuration.r2, configuration.r2Bucket, recordingTransfers),
    openAIProvider(configuration.openai, analysis),
    recordingTransferProvider("triggerdev", "Trigger.dev", configuration.triggerdev, "TRIGGER_SECRET_KEY", recordingTransfers, mediaLifecycle),
  ];
}
