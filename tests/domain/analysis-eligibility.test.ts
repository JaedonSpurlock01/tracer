/**
 * -------------------------------------------------------------------------
 * @file   analysis-eligibility.test.ts
 * @brief  Verifies when a Recording is analysis-eligible.
 *
 * @description
 *  Covers the Workspace analysis setting, the spam-gate result, and the
 *  15-second threshold measured from the forwarded leg's connected
 *  duration for connected Recordings and from the Recording duration for
 *  voicemail Recordings.
 *
 * @remarks
 *  Eligibility is pure and never contacts OpenAI or any other provider.
 *
 * @see
 *  data/analysis-eligibility.ts
 *  CONTEXT.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { analysisEligibility, type AnalysisFacts } from "@/data/analysis-eligibility";

const connected: AnalysisFacts = {
  analysisEnabled: true,
  spamGate: "Passed",
  source: "connected",
  connectedDurationSeconds: 60,
  recordingDurationSeconds: 64,
};

const voicemail: AnalysisFacts = {
  analysisEnabled: true,
  spamGate: "Not used",
  source: "voicemail",
  connectedDurationSeconds: null,
  recordingDurationSeconds: 30,
};

describe("analysis eligibility", () => {
  it("makes a connected Recording with a passed Keypad Gate and enough connected talk time eligible", () => {
    expect(analysisEligibility(connected)).toEqual({ eligible: true });
  });

  it("makes a Recording eligible when the Call Flow uses no spam gate", () => {
    expect(analysisEligibility({ ...connected, spamGate: "Not used" })).toEqual({ eligible: true });
  });

  it("skips every Recording when the Workspace has analysis disabled", () => {
    expect(analysisEligibility({ ...connected, analysisEnabled: false })).toEqual({ eligible: false, reason: "analysis_disabled" });
    expect(analysisEligibility({ ...voicemail, analysisEnabled: false })).toEqual({ eligible: false, reason: "analysis_disabled" });
  });

  it("skips a Recording whose Call did not pass the enabled spam gate", () => {
    expect(analysisEligibility({ ...connected, spamGate: "Blocked" })).toEqual({ eligible: false, reason: "spam_gate_not_passed" });
    expect(analysisEligibility({ ...voicemail, spamGate: "Not reached" })).toEqual({ eligible: false, reason: "spam_gate_not_passed" });
  });

  it("requires at least 15 seconds of connected talk time from the forwarded leg", () => {
    expect(analysisEligibility({ ...connected, connectedDurationSeconds: 14.9 })).toEqual({ eligible: false, reason: "too_short" });
    expect(analysisEligibility({ ...connected, connectedDurationSeconds: 15 })).toEqual({ eligible: true });
  });

  it("measures a connected Recording by connected talk time rather than the Recording duration", () => {
    expect(analysisEligibility({ ...connected, connectedDurationSeconds: 10, recordingDurationSeconds: 40 })).toEqual({ eligible: false, reason: "too_short" });
  });

  it("falls back to the dual-channel Recording duration while the connected duration is not yet known", () => {
    expect(analysisEligibility({ ...connected, connectedDurationSeconds: null, recordingDurationSeconds: 40 })).toEqual({ eligible: true });
    expect(analysisEligibility({ ...connected, connectedDurationSeconds: null, recordingDurationSeconds: 14 })).toEqual({ eligible: false, reason: "too_short" });
    expect(analysisEligibility({ ...connected, connectedDurationSeconds: null, recordingDurationSeconds: null })).toEqual({ eligible: false, reason: "too_short" });
  });

  it("requires at least 15 seconds of captured voicemail measured by the Recording duration", () => {
    expect(analysisEligibility({ ...voicemail, recordingDurationSeconds: 14.9 })).toEqual({ eligible: false, reason: "too_short" });
    expect(analysisEligibility({ ...voicemail, recordingDurationSeconds: 15 })).toEqual({ eligible: true });
    expect(analysisEligibility({ ...voicemail, recordingDurationSeconds: null })).toEqual({ eligible: false, reason: "too_short" });
  });

  it("ignores the connected duration for a voicemail Recording", () => {
    expect(analysisEligibility({ ...voicemail, connectedDurationSeconds: 120, recordingDurationSeconds: 5 })).toEqual({ eligible: false, reason: "too_short" });
  });
});
