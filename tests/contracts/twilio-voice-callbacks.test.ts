/**
 * -------------------------------------------------------------------------
 * @file   twilio-voice-callbacks.test.ts
 * @brief  Verifies Tracer reads Twilio Gather, Dial, and recording callbacks.
 *
 * @description
 *  Feeds Twilio-shaped Gather action, Dial action, and recording status
 *  payloads into the Call routing rules and checks the
 *  resulting branch or Call Outcome, and maps voicemail and dual-channel Dial
 *  recording status payloads to the Recording they produce.
 *
 * @remarks
 *  The fixtures use Twilio's documented field names so a renamed or missing
 *  field fails here rather than on a live Call.
 *
 * @see
 *  tests/contracts/fixtures/twilio/voice-callbacks.json
 *  data/voice-response.ts
 *  data/recording.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { generateInitialCallFlow, type CallFlowGraph } from "@/data/call-flow";
import { completedRecording } from "@/data/recording";
import { renderForwardResult, renderGatherResult, voicemailCaptureOutcome, type VoiceContext } from "@/data/voice-response";

import fixtures from "./fixtures/twilio/voice-callbacks.json";

const context: VoiceContext = {
  urls: {
    forwardAction: () => "https://tracer.example.com/forward",
    forwardStatus: () => "https://tracer.example.com/forward-status",
    whisper: () => "https://tracer.example.com/whisper",
    voicemailAction: () => "https://tracer.example.com/voicemail",
    voicemailStatus: () => "https://tracer.example.com/voicemail-status",
    gatherAction: () => "https://tracer.example.com/gather",
    recordingStatus: () => "https://tracer.example.com/recording-status",
  },
  at: new Date("2026-10-16T19:00:00Z"),
  timeZone: "UTC",
  recordingEnabled: false,
};

function flow(spamGateEnabled: boolean): CallFlowGraph {
  return generateInitialCallFlow({ destinationNumber: "+14155550199", recordingEnabled: false, spamGateEnabled, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });
}

function seconds(value: string): number {
  return Number.parseInt(value, 10);
}

describe("Twilio voice callback contracts", () => {
  it("reads the Gather action Digits to pass the Keypad Gate", () => {
    expect(renderGatherResult(flow(true), "gate", fixtures.gatherAction.Digits, 1, context).forwardNodeId).toBe("forward");
  });

  it("treats a Gather action without Digits as no input", () => {
    const timeout: Record<string, string> = fixtures.gatherTimeout;
    expect(renderGatherResult(flow(true), "gate", timeout.Digits ?? "", 2, context).outcome).toEqual({ outcome: "Blocked", reason: "flow_outcome" });
  });

  it("reads the Dial action DialCallStatus to follow the Missed branch", () => {
    expect(renderForwardResult(flow(false), "forward", fixtures.dialAction.DialCallStatus, context).outcome).toEqual({ outcome: "Missed", reason: "flow_outcome" });
  });

  it.each([
    ["completed", fixtures.recordingStatusCompleted, { outcome: "Voicemail", reason: "voicemail_captured" }],
    ["absent", fixtures.recordingStatusAbsent, null],
    ["failed", fixtures.recordingStatusFailed, { outcome: "Failed", reason: "voicemail_capture_failed" }],
  ])("maps a %s recording status callback to its Call Outcome", (_label, payload, outcome) => {
    expect(voicemailCaptureOutcome(payload.RecordingStatus, seconds(payload.RecordingDuration))).toEqual(outcome);
  });

  it("maps a completed dual-channel Dial recording status callback to a connected Recording", () => {
    expect(completedRecording("connected", fixtures.dialRecordingStatusCompleted)).toEqual({
      twilioRecordingSid: "RE66666666666666666666666666666666",
      source: "connected",
      channels: 2,
      durationSeconds: 96,
    });
  });

  it("maps a completed voicemail recording status callback to a caller-only voicemail Recording", () => {
    expect(completedRecording("voicemail", fixtures.recordingStatusCompleted)).toEqual({
      twilioRecordingSid: "RE33333333333333333333333333333333",
      source: "voicemail",
      channels: 1,
      durationSeconds: 14,
    });
  });

  it.each([
    ["an absent Dial", "connected", fixtures.dialRecordingStatusAbsent],
    ["an absent voicemail", "voicemail", fixtures.recordingStatusAbsent],
    ["a failed voicemail", "voicemail", fixtures.recordingStatusFailed],
  ] as const)("produces no Recording from %s recording status callback", (_label, source, payload) => {
    expect(completedRecording(source, payload)).toBeNull();
  });
});
