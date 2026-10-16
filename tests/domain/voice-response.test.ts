/**
 * -------------------------------------------------------------------------
 * @file   voice-response.test.ts
 * @brief  Verifies constrained TwiML rendering from a pinned Flow Version.
 *
 * @description
 *  Walks published Call Flow graphs from Incoming Call through the fixed
 *  Recording Disclosure and Forward Call, maps Forward Call results to the
 *  canonical Call Outcome, and ends Calls that reach a step deferred to M10
 *  as Failed without playing anything.
 *
 * @remarks
 *  Graphs come from the same initial-flow generator Operators publish with.
 *
 * @see
 *  data/voice-response.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { generateInitialCallFlow, recordingDisclosureText, type CallFlowGraph } from "@/data/call-flow";
import { renderCallStart, renderForwardResult, type VoiceUrls } from "@/data/voice-response";

const urls: VoiceUrls = {
  forwardAction: (nodeId) => `https://tracer.example.com/api/twilio/forward/assignment-1?node=${nodeId}&step=action`,
  forwardStatus: (nodeId) => `https://tracer.example.com/api/twilio/forward-status/assignment-1?node=${nodeId}`,
};

function flow(options: { recordingEnabled?: boolean; spamGateEnabled?: boolean; whisperEnabled?: boolean } = {}): CallFlowGraph {
  return generateInitialCallFlow({
    destinationNumber: "+14155550199",
    recordingEnabled: options.recordingEnabled ?? false,
    spamGateEnabled: options.spamGateEnabled ?? false,
    whisperEnabled: options.whisperEnabled ?? false,
    whisperMessage: options.whisperEnabled ? "Tracer lead" : null,
    disclosureVoice: "Polly.Joanna",
  });
}

const forwardTwiml =
  '<Dial action="https://tracer.example.com/api/twilio/forward/assignment-1?node=forward&amp;step=action" method="POST" timeout="30">' +
  '<Number statusCallback="https://tracer.example.com/api/twilio/forward-status/assignment-1?node=forward" statusCallbackEvent="initiated answered completed" statusCallbackMethod="POST">+14155550199</Number>' +
  "</Dial>";

describe("Call start TwiML", () => {
  it("forwards an Incoming Call straight to the Destination Number", () => {
    expect(renderCallStart(flow(), urls)).toEqual({
      twiml: `<?xml version="1.0" encoding="UTF-8"?><Response>${forwardTwiml}</Response>`,
      forwardNodeId: "forward",
      outcome: null,
    });
  });

  it("plays the fixed Recording Disclosure before forwarding when recording is enabled", () => {
    expect(renderCallStart(flow({ recordingEnabled: true }), urls)).toEqual({
      twiml: `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">${recordingDisclosureText}</Say>${forwardTwiml}</Response>`,
      forwardNodeId: "forward",
      outcome: null,
    });
  });

  it.each([
    ["Keypad Gate", { spamGateEnabled: true }, "keypad_gate"],
    ["Whisper", { whisperEnabled: true }, "whisper"],
  ] as const)("ends a Call that reaches a deferred %s step as Failed without playing anything", (_label, options, step) => {
    expect(renderCallStart(flow({ recordingEnabled: true, ...options }), urls)).toEqual({
      twiml: '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
      forwardNodeId: null,
      outcome: { outcome: "Failed", reason: `unsupported_step:${step}` },
    });
  });

  it("ends a Call at a terminal Outcome step", () => {
    const graph: CallFlowGraph = {
      version: 1,
      nodes: [
        { id: "incoming", type: "incoming_call", position: { x: 0, y: 0 } },
        { id: "blocked", type: "outcome", position: { x: 0, y: 160 }, outcome: "Blocked" },
      ],
      edges: [{ id: "incoming-next", source: "incoming", sourceHandle: "next", target: "blocked" }],
    };
    expect(renderCallStart(graph, urls)).toEqual({
      twiml: '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
      forwardNodeId: null,
      outcome: { outcome: "Blocked", reason: "flow_outcome" },
    });
  });
});

describe("Forward Call result", () => {
  it.each([
    ["completed", "Answered"],
    ["busy", "Missed"],
    ["no-answer", "Missed"],
    ["failed", "Failed"],
  ] as const)("maps a %s Forward Call to %s through the published branch", (status, outcome) => {
    expect(renderForwardResult(flow(), "forward", status)).toEqual({
      twiml: '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
      forwardNodeId: null,
      outcome: { outcome, reason: "flow_outcome" },
    });
  });

  it("maps a Forward Call canceled by the caller hanging up to Abandoned", () => {
    expect(renderForwardResult(flow(), "forward", "canceled").outcome).toEqual({ outcome: "Abandoned", reason: "caller_hung_up" });
  });

  it("returns no outcome while the Forward Call has only been answered", () => {
    expect(renderForwardResult(flow(), "forward", "in-progress").outcome).toBeNull();
  });
});
