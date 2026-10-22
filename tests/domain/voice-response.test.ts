/**
 * -------------------------------------------------------------------------
 * @file   voice-response.test.ts
 * @brief  Verifies constrained TwiML rendering from a pinned Flow Version.
 *
 * @description
 *  Walks published Call Flow graphs through Recording Disclosure, Business
 *  Hours, Keypad Gate, Whisper, Forward Call, and Voicemail, maps Forward
 *  Call and voicemail recording results to the canonical Call Outcome, and
 *  checks when the Forward Call leg is recorded.
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
import { renderCallStart, renderForwardResult, renderGatherResult, renderWhisper, voicemailCaptureOutcome, type VoiceContext } from "@/data/voice-response";

const context: VoiceContext = {
  urls: {
    forwardAction: (nodeId) => `https://tracer.example.com/api/twilio/forward/assignment-1?node=${nodeId}&step=action`,
    forwardStatus: (nodeId) => `https://tracer.example.com/api/twilio/forward-status/assignment-1?node=${nodeId}`,
    whisper: (nodeId) => `https://tracer.example.com/api/twilio/whisper/assignment-1?node=${nodeId}`,
    voicemailAction: (nodeId) => `https://tracer.example.com/api/twilio/voicemail/assignment-1?node=${nodeId}`,
    voicemailStatus: (nodeId) => `https://tracer.example.com/api/twilio/voicemail-status/assignment-1?node=${nodeId}`,
    gatherAction: (nodeId, attempt) => `https://tracer.example.com/api/twilio/gather/assignment-1?node=${nodeId}&attempt=${attempt}`,
    recordingStatus: (nodeId) => `https://tracer.example.com/api/twilio/recording-status/assignment-1?node=${nodeId}`,
  },
  at: new Date("2026-10-19T16:00:00Z"),
  timeZone: "America/Los_Angeles",
  recordingEnabled: false,
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
  it("speaks the Operator's disclosure message in the chosen voice and its language", () => {
    const graph = flow({ recordingEnabled: true });
    const edited = {
      ...graph,
      nodes: graph.nodes.map((node) => (node.type === "recording_disclosure" ? { ...node, message: "Calls are recorded & reviewed.", voice: "Polly.Brian" as const } : node)),
    };

    expect(renderCallStart(edited, { ...context, recordingEnabled: true }).twiml).toContain('<Say voice="Polly.Brian" language="en-GB">Calls are recorded &amp; reviewed.</Say>');
  });

  it("forwards an Incoming Call straight to the Destination Number", () => {
    expect(renderCallStart(flow(), context)).toEqual({
      twiml: `<?xml version="1.0" encoding="UTF-8"?><Response>${forwardTwiml}</Response>`,
      forwardNodeId: "forward",
      outcome: null,
      pending: null,
    });
  });

  it("plays the default Recording Disclosure before forwarding when recording is enabled", () => {
    expect(renderCallStart(flow({ recordingEnabled: true }), context)).toEqual({
      twiml: `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna" language="en-US">${recordingDisclosureText}</Say>${forwardTwiml}</Response>`,
      forwardNodeId: "forward",
      outcome: null,
      pending: null,
    });
  });

  it("records the answered Forward Call leg in dual channel when the Workspace records and the Flow Version plays the Recording Disclosure", () => {
    expect(renderCallStart(flow({ recordingEnabled: true }), { ...context, recordingEnabled: true }).twiml).toContain(
      '<Dial action="https://tracer.example.com/api/twilio/forward/assignment-1?node=forward&amp;step=action" method="POST" timeout="30" ' +
        'record="record-from-answer-dual" recordingStatusCallback="https://tracer.example.com/api/twilio/recording-status/assignment-1?node=forward" ' +
        'recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed absent">',
    );
  });

  it("never records the Forward Call leg when Workspace recording is disabled", () => {
    expect(renderCallStart(flow({ recordingEnabled: true }), context).twiml).not.toContain("record=");
  });

  it("never records the Forward Call leg when the pinned Flow Version has no Recording Disclosure, even if the Workspace records", () => {
    expect(renderCallStart(flow(), { ...context, recordingEnabled: true }).twiml).not.toContain("record=");
  });

  it("records the Forward Call leg reached through a Keypad Gate after the Recording Disclosure", () => {
    expect(renderGatherResult(flow({ recordingEnabled: true, spamGateEnabled: true }), "gate", "1", 1, { ...context, recordingEnabled: true }).twiml).toContain('record="record-from-answer-dual"');
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
    expect(renderCallStart(graph, context)).toEqual({
      twiml: '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
      forwardNodeId: null,
      outcome: { outcome: "Blocked", reason: "flow_outcome" },
      pending: null,
    });
  });
});

describe("Whisper execution", () => {
  it("plays the Whisper to the business leg only, after it answers and before the caller is connected", () => {
    expect(renderCallStart(flow({ whisperEnabled: true }), context)).toEqual({
      twiml:
        '<?xml version="1.0" encoding="UTF-8"?><Response>' +
        '<Dial action="https://tracer.example.com/api/twilio/forward/assignment-1?node=forward&amp;step=action" method="POST" timeout="30">' +
        '<Number url="https://tracer.example.com/api/twilio/whisper/assignment-1?node=whisper" method="POST" statusCallback="https://tracer.example.com/api/twilio/forward-status/assignment-1?node=forward" statusCallbackEvent="initiated answered completed" statusCallbackMethod="POST">+14155550199</Number>' +
        "</Dial></Response>",
      forwardNodeId: "forward",
      outcome: null,
      pending: null,
    });
  });

  it("speaks the Whisper message to the business", () => {
    expect(renderWhisper(flow({ whisperEnabled: true }), "whisper")).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna" language="en-US">Tracer lead</Say></Response>');
  });

  it("connects the business without a message when the Whisper step is unknown", () => {
    expect(renderWhisper(flow(), "whisper")).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });

  it("keeps the Whisper on the Pass path after a Keypad Gate", () => {
    const gated = flow({ spamGateEnabled: true, whisperEnabled: true });
    expect(renderGatherResult(gated, "gate", "1", 1, context).twiml).toContain('<Number url="https://tracer.example.com/api/twilio/whisper/assignment-1?node=whisper"');
  });
});

describe("Keypad Gate execution", () => {
  const gather = (attempt: number) =>
    `<Gather numDigits="1" timeout="10" action="https://tracer.example.com/api/twilio/gather/assignment-1?node=gate&amp;attempt=${attempt}" method="POST" actionOnEmptyResult="true">` +
    '<Say voice="Polly.Joanna" language="en-US">Press 1 to be connected.</Say></Gather>';
  const gated = () => flow({ spamGateEnabled: true });

  it("prompts for the gate digit and treats a hang-up during the gate as Blocked", () => {
    expect(renderCallStart(gated(), context)).toEqual({
      twiml: `<?xml version="1.0" encoding="UTF-8"?><Response>${gather(1)}</Response>`,
      forwardNodeId: null,
      outcome: null,
      pending: { outcome: "Blocked", reason: "gate_not_completed" },
    });
  });

  it("follows Pass to Forward Call when the caller presses the gate digit", () => {
    expect(renderGatherResult(gated(), "gate", "1", 1, context)).toEqual({
      twiml: `<?xml version="1.0" encoding="UTF-8"?><Response>${forwardTwiml}</Response>`,
      forwardNodeId: "forward",
      outcome: null,
      pending: null,
    });
  });

  it.each([["a wrong digit", "7"], ["no input", ""]])("replays the prompt once after %s", (_label, digits) => {
    expect(renderGatherResult(gated(), "gate", digits, 1, context)).toEqual({
      twiml: `<?xml version="1.0" encoding="UTF-8"?><Response>${gather(2)}</Response>`,
      forwardNodeId: null,
      outcome: null,
      pending: { outcome: "Blocked", reason: "gate_not_completed" },
    });
  });

  it.each([["a wrong digit", "7"], ["no input", ""]])("follows Blocked and never forwards after %s on the second attempt", (_label, digits) => {
    expect(renderGatherResult(gated(), "gate", digits, 2, context)).toEqual({
      twiml: '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
      forwardNodeId: null,
      outcome: { outcome: "Blocked", reason: "flow_outcome" },
      pending: null,
    });
  });
});

describe("Business Hours execution", () => {
  function hoursFlow(): CallFlowGraph {
    const graph = flow();
    return {
      version: 1,
      nodes: [
        ...graph.nodes,
        { id: "hours", type: "business_hours", position: { x: 0, y: 0 }, weeklyWindows: [{ day: 1, start: "09:00", end: "17:00" }], dateOverrides: [] },
        { id: "outcome-closed", type: "outcome", position: { x: 0, y: 0 }, outcome: "Missed" },
      ],
      edges: [
        ...graph.edges.filter((edge) => edge.source !== "incoming"),
        { id: "incoming-next", source: "incoming", sourceHandle: "next", target: "hours" },
        { id: "hours-open", source: "hours", sourceHandle: "open", target: "forward" },
        { id: "hours-closed", source: "hours", sourceHandle: "closed", target: "outcome-closed" },
      ],
    };
  }

  it("follows Open to Forward Call when the Call starts inside a window in the Workspace timezone", () => {
    expect(renderCallStart(hoursFlow(), context)).toMatchObject({ forwardNodeId: "forward", outcome: null });
  });

  it("follows Closed when the Call starts one minute before the window opens", () => {
    expect(renderCallStart(hoursFlow(), { ...context, at: new Date("2026-10-19T15:59:00Z") })).toEqual({
      twiml: '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
      forwardNodeId: null,
      outcome: { outcome: "Missed", reason: "flow_outcome" },
      pending: null,
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
    expect(renderForwardResult(flow(), "forward", status, context)).toEqual({
      twiml: '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
      forwardNodeId: null,
      outcome: { outcome, reason: "flow_outcome" },
      pending: null,
    });
  });

  it("maps a Forward Call canceled by the caller hanging up to Abandoned", () => {
    expect(renderForwardResult(flow(), "forward", "canceled", context).outcome).toEqual({ outcome: "Abandoned", reason: "caller_hung_up" });
  });

  it("returns no outcome while the Forward Call has only been answered", () => {
    expect(renderForwardResult(flow(), "forward", "in-progress", context).outcome).toBeNull();
  });
});

describe("Voicemail execution", () => {
  const record =
    '<Say voice="Polly.Matthew" language="en-US">Please leave a message.</Say>' +
    '<Record maxLength="120" timeout="5" finishOnKey="#" action="https://tracer.example.com/api/twilio/voicemail/assignment-1?node=voicemail" method="POST" ' +
    'recordingStatusCallback="https://tracer.example.com/api/twilio/voicemail-status/assignment-1?node=voicemail" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed absent"/>';

  function voicemailFlow(entry: "closed" | "missed"): CallFlowGraph {
    const graph = flow();
    const voicemailNodes: CallFlowGraph["nodes"] = [
      { id: "voicemail", type: "voicemail", position: { x: 0, y: 0 }, greeting: "Please leave a message.", voice: "Polly.Matthew" },
      { id: "outcome-voicemail", type: "outcome", position: { x: 0, y: 0 }, outcome: "Voicemail" },
    ];
    if (entry === "missed") {
      return {
        version: 1,
        nodes: [...graph.nodes.filter((node) => node.id !== "outcome-missed"), ...voicemailNodes],
        edges: [
          ...graph.edges.map((edge) => (edge.sourceHandle === "missed" ? { ...edge, target: "voicemail" } : edge)),
          { id: "voicemail-next", source: "voicemail", sourceHandle: "next", target: "outcome-voicemail" },
        ],
      };
    }
    return {
      version: 1,
      nodes: [...graph.nodes, { id: "hours", type: "business_hours", position: { x: 0, y: 0 }, weeklyWindows: [{ day: 3, start: "09:00", end: "17:00" }], dateOverrides: [] }, ...voicemailNodes],
      edges: [
        ...graph.edges.filter((edge) => edge.source !== "incoming"),
        { id: "incoming-next", source: "incoming", sourceHandle: "next", target: "hours" },
        { id: "hours-open", source: "hours", sourceHandle: "open", target: "forward" },
        { id: "hours-closed", source: "hours", sourceHandle: "closed", target: "voicemail" },
        { id: "voicemail-next", source: "voicemail", sourceHandle: "next", target: "outcome-voicemail" },
      ],
    };
  }

  it("records a voicemail on the Closed path within the 120-second, 5-second-silence, and # limits, Abandoned until captured", () => {
    expect(renderCallStart(voicemailFlow("closed"), context)).toEqual({
      twiml: `<?xml version="1.0" encoding="UTF-8"?><Response>${record}</Response>`,
      forwardNodeId: null,
      outcome: null,
      pending: { outcome: "Abandoned", reason: "voicemail_not_captured" },
    });
  });

  it.each(["busy", "no-answer"])("records a voicemail after a %s Forward Call, Missed until captured", (status) => {
    expect(renderForwardResult(voicemailFlow("missed"), "forward", status, context)).toEqual({
      twiml: `<?xml version="1.0" encoding="UTF-8"?><Response>${record}</Response>`,
      forwardNodeId: null,
      outcome: null,
      pending: { outcome: "Missed", reason: "voicemail_not_captured" },
    });
  });

  it("reports Voicemail only for a completed recording with captured audio", () => {
    expect(voicemailCaptureOutcome("completed", 14)).toEqual({ outcome: "Voicemail", reason: "voicemail_captured" });
    expect(voicemailCaptureOutcome("completed", 0)).toBeNull();
    expect(voicemailCaptureOutcome("absent", 0)).toBeNull();
  });

  it("reports Failed rather than Voicemail when Twilio fails to capture the recording", () => {
    expect(voicemailCaptureOutcome("failed", 30)).toEqual({ outcome: "Failed", reason: "voicemail_capture_failed" });
  });
});
