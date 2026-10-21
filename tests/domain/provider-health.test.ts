/**
 * -------------------------------------------------------------------------
 * @file   provider-health.test.ts
 * @brief  Verifies provider configuration health descriptions.
 *
 * @description
 *  Covers configured, connected, degraded, and missing provider states,
 *  including Trigger.dev degraded by unfinished media cleanup.
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

import { describeProviderHealth, type AnalysisProcessingHealth, type MediaLifecycleHealth, type ProviderConfiguration, type RecordingTransferHealth } from "@/data/provider-health";
import type { TwilioConnectionRecord } from "@/data/integrations";

const configured: ProviderConfiguration = {
  twilioMasterKey: true,
  hyperdrive: true,
  email: true,
  emailFrom: "auth@example.com",
  emailAllowlistCount: 1,
  r2: false,
  r2Bucket: "tracer-recordings-staging",
  openai: false,
  triggerdev: false,
};

const noTransfers: RecordingTransferHealth = { lastStoredAt: null, recentFailures: [] };

const noAnalysis: AnalysisProcessingHealth = { lastTranscriptAt: null, lastLeadAssessmentAt: null, failedCount: 0, lastFailureAt: null };

const noLifecycle: MediaLifecycleHealth = { stuckCount: 0, oldestStuck: [] };

const connection: TwilioConnectionRecord = {
  accountSid: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  apiKeySid: "SK11111111111111111111111111111111",
  authTokenConfigured: true,
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
    const health = describeProviderHealth(configured, null, noTransfers, noAnalysis, noLifecycle);

    expect(health.map((provider) => provider.id)).toEqual(["twilio", "cloudflare", "dataforseo", "hyperdrive", "email", "r2", "openai", "triggerdev"]);
    expect(health).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "hyperdrive", state: "configured", identifier: "HYPERDRIVE", testable: true }),
      expect.objectContaining({ id: "email", state: "configured", identifier: "auth@example.com", testable: true }),
      expect.objectContaining({ id: "r2", state: "not_configured", identifier: "tracer-recordings-staging", testable: false }),
    ]));
  });

  it("describes missing Twilio master key and connection", () => {
    const withoutMasterKey = describeProviderHealth({ ...configured, twilioMasterKey: false }, null, noTransfers, noAnalysis, noLifecycle)[0];
    const withoutConnection = describeProviderHealth(configured, null, noTransfers, noAnalysis, noLifecycle)[0];

    expect(withoutMasterKey).toMatchObject({ state: "not_configured", testable: false, note: "The TWILIO_CREDENTIAL_MASTER_KEY deployment secret is missing" });
    expect(withoutConnection).toMatchObject({ state: "not_configured", testable: false, note: "No Organization Twilio credential is connected" });
  });

  it("marks a connection degraded after a newer failure", () => {
    const degraded = describeProviderHealth(configured, {
      ...connection,
      lastFailureAt: "2026-10-14T02:00:00.000Z",
      lastFailureDetail: "Twilio rejected the credential (HTTP 401)",
    }, noTransfers, noAnalysis, noLifecycle)[0];

    expect(degraded).toMatchObject({ state: "degraded", identifier: connection.accountSid, lastSuccessAt: connection.lastVerifiedAt, testable: true });
  });

  it("describes email with an empty allowlist as degraded", () => {
    const email = describeProviderHealth({ ...configured, emailAllowlistCount: 0 }, null, noTransfers, noAnalysis, noLifecycle).find((provider) => provider.id === "email");

    expect(email).toMatchObject({ state: "degraded", note: "The recipient allowlist is empty, so sends are disabled", testable: false });
  });

  it("describes configured R2 by its bucket name and Trigger.dev with no Recording transfers yet", () => {
    const health = describeProviderHealth({ ...configured, r2: true, triggerdev: true }, null, noTransfers, noAnalysis, noLifecycle);

    expect(health.find((provider) => provider.id === "r2")).toMatchObject({
      state: "configured",
      identifier: "tracer-recordings-staging",
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFailureDetail: null,
      recentFailures: [],
    });
    expect(health.find((provider) => provider.id === "triggerdev")).toMatchObject({
      state: "configured",
      identifier: "TRIGGER_SECRET_KEY",
      lastSuccessAt: null,
      lastFailureAt: null,
      recentFailures: [],
    });
  });

  it("keeps R2 and Trigger.dev configured when the last Recording transfer succeeded after the recent failures", () => {
    const transfers: RecordingTransferHealth = {
      lastStoredAt: "2026-10-14T03:00:00.000Z",
      recentFailures: [{ stage: "download", reason: "Twilio is unavailable", at: "2026-10-14T02:00:00.000Z" }],
    };
    const health = describeProviderHealth({ ...configured, r2: true, triggerdev: true }, null, transfers, noAnalysis, noLifecycle);

    for (const id of ["r2", "triggerdev"]) {
      expect(health.find((provider) => provider.id === id)).toMatchObject({
        state: "configured",
        lastSuccessAt: "2026-10-14T03:00:00.000Z",
        lastFailureAt: "2026-10-14T02:00:00.000Z",
        lastFailureDetail: "Twilio is unavailable",
        recentFailures: transfers.recentFailures,
      });
    }
  });

  it("describes OpenAI by its configured models and its last successful Transcript and Lead Assessment", () => {
    const analysis: AnalysisProcessingHealth = {
      lastTranscriptAt: "2026-10-17T01:00:00.000Z",
      lastLeadAssessmentAt: "2026-10-17T01:01:00.000Z",
      failedCount: 1,
      lastFailureAt: "2026-10-16T09:00:00.000Z",
    };
    const openai = describeProviderHealth({ ...configured, openai: true }, null, noTransfers, analysis, noLifecycle).find((provider) => provider.id === "openai");

    expect(openai).toMatchObject({
      state: "configured",
      identifier: "OPENAI_API_KEY",
      lastSuccessAt: "2026-10-17T01:01:00.000Z",
      lastFailureAt: "2026-10-16T09:00:00.000Z",
      lastFailureDetail: null,
      testable: false,
      analysis: { transcriptionModel: "whisper-1", leadAssessmentModel: "gpt-5-mini", ...analysis },
    });
  });

  it("marks OpenAI degraded when a Transcript or Lead Assessment failed after the last success, and not configured without its key", () => {
    const analysis: AnalysisProcessingHealth = { lastTranscriptAt: "2026-10-17T01:00:00.000Z", lastLeadAssessmentAt: null, failedCount: 2, lastFailureAt: "2026-10-17T02:00:00.000Z" };

    expect(describeProviderHealth({ ...configured, openai: true }, null, noTransfers, analysis, noLifecycle).find((provider) => provider.id === "openai")?.state).toBe("degraded");
    expect(describeProviderHealth({ ...configured, openai: true }, null, noTransfers, { ...analysis, lastTranscriptAt: null }, noLifecycle).find((provider) => provider.id === "openai")?.state).toBe("degraded");
    expect(describeProviderHealth(configured, null, noTransfers, analysis, noLifecycle).find((provider) => provider.id === "openai")?.state).toBe("not_configured");
    expect(describeProviderHealth({ ...configured, openai: true }, null, noTransfers, noAnalysis, noLifecycle).find((provider) => provider.id === "openai")).toMatchObject({
      state: "configured",
      lastSuccessAt: null,
      lastFailureAt: null,
      analysis: { transcriptionModel: "whisper-1", leadAssessmentModel: "gpt-5-mini", failedCount: 0 },
    });
  });

  it("marks R2 and Trigger.dev degraded when a Recording transfer failed after the last successful transfer", () => {
    const transfers: RecordingTransferHealth = {
      lastStoredAt: "2026-10-14T01:00:00.000Z",
      recentFailures: [
        { stage: "upload", reason: "R2 request failed (HTTP 503)", at: "2026-10-14T02:00:00.000Z" },
        { stage: "cleanup", reason: "Twilio request failed (HTTP 500)", at: "2026-10-14T00:30:00.000Z" },
      ],
    };
    const health = describeProviderHealth({ ...configured, r2: true, triggerdev: true }, null, transfers, noAnalysis, noLifecycle);

    for (const id of ["r2", "triggerdev"]) {
      expect(health.find((provider) => provider.id === id)).toMatchObject({
        state: "degraded",
        lastFailureAt: "2026-10-14T02:00:00.000Z",
        lastFailureDetail: "R2 request failed (HTTP 503)",
      });
    }
    expect(describeProviderHealth(configured, null, { lastStoredAt: null, recentFailures: transfers.recentFailures }, noAnalysis, noLifecycle).find((provider) => provider.id === "r2")?.state).toBe("not_configured");
  });

  it("keeps Trigger.dev configured with no unfinished media cleanup and marks it degraded while a purged or expired Recording's cleanup is stuck", () => {
    const stuck: MediaLifecycleHealth = {
      stuckCount: 2,
      oldestStuck: [
        { callId: "call-1", workspaceId: "workspace-1", workspaceName: "North", media: "Expired", since: "2026-10-12T00:00:00.000Z", twilioNotConnected: false },
        { callId: "call-2", workspaceId: "workspace-1", workspaceName: "North", media: "Purged", since: "2026-10-13T00:00:00.000Z", twilioNotConnected: true },
      ],
    };
    const healthy = describeProviderHealth({ ...configured, r2: true, triggerdev: true }, null, noTransfers, noAnalysis, noLifecycle);
    const degraded = describeProviderHealth({ ...configured, r2: true, triggerdev: true }, null, noTransfers, noAnalysis, stuck);

    expect(healthy.find((provider) => provider.id === "triggerdev")).toMatchObject({ state: "configured", mediaLifecycle: noLifecycle });
    expect(degraded.find((provider) => provider.id === "triggerdev")).toMatchObject({ state: "degraded", mediaLifecycle: stuck });
    expect(degraded.find((provider) => provider.id === "r2")).toMatchObject({ state: "configured" });
    expect(degraded.find((provider) => provider.id === "r2")).not.toHaveProperty("mediaLifecycle");
    expect(describeProviderHealth(configured, null, noTransfers, noAnalysis, stuck).find((provider) => provider.id === "triggerdev")?.state).toBe("not_configured");
  });

  it("describes the Cloudflare connection as not configured, connected, or degraded", () => {
    const cloudflare = {
      accountId: "0123456789abcdef0123456789abcdef",
      connectedAt: "2026-10-20T00:00:00.000Z",
      connectedBy: { id: "operator", name: "Example Operator" },
      lastVerifiedAt: "2026-10-20T01:00:00.000Z",
      lastFailureAt: null,
      lastFailureDetail: null,
      lastSyncedAt: null,
      siteCount: 6,
    };
    const find = (providers: ReturnType<typeof describeProviderHealth>) => providers.find((provider) => provider.id === "cloudflare");
    expect(find(describeProviderHealth({ ...configured, twilioMasterKey: false }, null, noTransfers, noAnalysis, noLifecycle, null))).toMatchObject({ state: "not_configured", testable: false, note: "The TWILIO_CREDENTIAL_MASTER_KEY deployment secret is missing" });
    expect(find(describeProviderHealth(configured, null, noTransfers, noAnalysis, noLifecycle, null))).toMatchObject({ state: "not_configured", testable: false, note: "No Organization Cloudflare credential is connected" });
    expect(find(describeProviderHealth(configured, null, noTransfers, noAnalysis, noLifecycle, cloudflare))).toMatchObject({ name: "Cloudflare", state: "connected", identifier: cloudflare.accountId, lastSuccessAt: cloudflare.lastVerifiedAt, testable: true });
    expect(find(describeProviderHealth(configured, null, noTransfers, noAnalysis, noLifecycle, { ...cloudflare, lastFailureAt: "2026-10-20T02:00:00.000Z", lastFailureDetail: "Cloudflare is unavailable" }))).toMatchObject({ state: "degraded", lastFailureDetail: "Cloudflare is unavailable" });
  });
});
