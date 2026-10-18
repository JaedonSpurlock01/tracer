/**
 * -------------------------------------------------------------------------
 * @file   analysis-eligibility.ts
 * @brief  Decides whether a Recording is analysis-eligible.
 *
 * @description
 *  A Recording is analysis-eligible when its Workspace had analysis
 *  enabled when the Recording was Stored, its Call passed any enabled spam
 *  gate, and it holds at least 15 seconds of speech. A connected Recording
 *  is measured by the forwarded leg's connected duration and a voicemail by
 *  its Recording duration. An ineligible Recording carries the reason it is
 *  Skipped.
 *
 * @remarks
 *  Durations Tracer already persists stand in for paid speech detection.
 *  When the forwarded leg's status has not arrived by the time the
 *  Recording is Stored, a connected Recording falls back to its own
 *  duration, since the dual-channel Dial recording spans only the bridged
 *  conversation. A missing duration counts as too short, so an unmeasured
 *  Recording never reaches OpenAI.
 *
 * @see
 *  CONTEXT.md
 *  data/call-details.ts
 *  data/recording-transfer.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { SpamGateResult } from "@/data/call-details";
import type { RecordingSource } from "@/data/recording";

export const minimumAnalysisSeconds = 15;

export type AnalysisSkipReason = "analysis_disabled" | "spam_gate_not_passed" | "too_short";

export type AnalysisEligibility = { eligible: true } | { eligible: false; reason: AnalysisSkipReason };

export interface AnalysisFacts {
  analysisEnabled: boolean;
  spamGate: SpamGateResult;
  source: RecordingSource;
  connectedDurationSeconds: number | null;
  recordingDurationSeconds: number | null;
}

export function analysisEligibility(facts: AnalysisFacts): AnalysisEligibility {
  if (!facts.analysisEnabled) return { eligible: false, reason: "analysis_disabled" };
  if (facts.spamGate !== "Passed" && facts.spamGate !== "Not used") return { eligible: false, reason: "spam_gate_not_passed" };
  const speechSeconds = facts.source === "connected" ? (facts.connectedDurationSeconds ?? facts.recordingDurationSeconds) : facts.recordingDurationSeconds;
  if (speechSeconds === null || speechSeconds < minimumAnalysisSeconds) return { eligible: false, reason: "too_short" };
  return { eligible: true };
}
