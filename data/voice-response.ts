/**
 * -------------------------------------------------------------------------
 * @file   voice-response.ts
 * @brief  Renders constrained TwiML from a Call's pinned Flow Version.
 *
 * @description
 *  Walks a published Call Flow graph from Incoming Call and emits only the
 *  approved verbs for every first-release step: the fixed Recording
 *  Disclosure, Business Hours evaluated in the Workspace timezone at the
 *  Call's start, a Keypad Gate Gather that replays its prompt once before
 *  Blocked, a Whisper spoken only to the answering business leg, Forward
 *  Call, Voicemail capture within its limits, and Hangup at a terminal
 *  Outcome step. Each step reports the Call Outcome that applies if the
 *  caller hangs up during it. Forward Call records the answered leg in dual
 *  channel when the Workspace records connected conversations.
 *
 * @remarks
 *  The forwarded call's own status callback is the reliable Forward Call
 *  result, because Twilio does not guarantee the Dial action request when
 *  the caller hangs up first. Reaching Voicemail never reports Voicemail by
 *  itself: only a completed recording with captured audio does, so a
 *  Voicemail step reports Missed or Abandoned by its entry path until the
 *  recording callback corrects it. A connected conversation is recorded only
 *  when the pinned Flow Version plays the Recording Disclosure right after
 *  Incoming Call, the same rule publication enforces, because a Call keeps
 *  its pinned Flow Version even if recording is enabled after a later
 *  publication.
 *
 * @see
 *  data/call-flow.ts
 *  https://www.twilio.com/docs/voice/twiml/dial
 *  https://www.twilio.com/docs/voice/twiml/gather
 *  https://www.twilio.com/docs/voice/twiml/record
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { businessHoursOpen, recordingDisclosureText, voicemailLimits, type CallFlowGraph, type EdgeHandle, type FlowNode, type OutcomeKind } from "@/data/call-flow";

export interface VoiceUrls {
  forwardAction(nodeId: string): string;
  forwardStatus(nodeId: string): string;
  whisper(nodeId: string): string;
  voicemailAction(nodeId: string): string;
  voicemailStatus(nodeId: string): string;
  gatherAction(nodeId: string, attempt: number): string;
  recordingStatus(nodeId: string): string;
}

export interface VoiceContext {
  urls: VoiceUrls;
  at: Date;
  timeZone: string;
  recordingEnabled: boolean;
}

export interface StepOutcome {
  outcome: OutcomeKind;
  reason: string;
}

export interface VoiceStep {
  twiml: string;
  forwardNodeId: string | null;
  outcome: StepOutcome | null;
  pending: StepOutcome | null;
}

export const keypadGateAttempts = 2;

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function response(verbs: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${verbs}</Response>`;
}

const hangup = response("<Hangup/>");

function ended(outcome: StepOutcome | null): VoiceStep {
  return { twiml: hangup, forwardNodeId: null, outcome, pending: null };
}

function say(voice: string, text: string): string {
  return `<Say voice="${escapeXml(voice)}">${escapeXml(text)}</Say>`;
}

function nextNode(graph: CallFlowGraph, nodeId: string, handle: EdgeHandle): FlowNode | undefined {
  const edge = graph.edges.find((candidate) => candidate.source === nodeId && candidate.sourceHandle === handle);
  return edge ? graph.nodes.find((node) => node.id === edge.target) : undefined;
}

function gather(node: Extract<FlowNode, { type: "keypad_gate" }>, attempt: number, context: VoiceContext): string {
  return (
    `<Gather numDigits="1" timeout="${node.timeoutSeconds}" action="${escapeXml(context.urls.gatherAction(node.id, attempt))}" method="POST" actionOnEmptyResult="true">` +
    `${say(node.voice, node.prompt)}</Gather>`
  );
}

function record(node: Extract<FlowNode, { type: "voicemail" }>, context: VoiceContext): string {
  return (
    say(node.voice, node.greeting) +
    `<Record maxLength="${voicemailLimits.maxSeconds}" timeout="${voicemailLimits.silenceTimeoutSeconds}" finishOnKey="${voicemailLimits.finishOnKey}" ` +
    `action="${escapeXml(context.urls.voicemailAction(node.id))}" method="POST" ` +
    `recordingStatusCallback="${escapeXml(context.urls.voicemailStatus(node.id))}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed absent"/>`
  );
}

function disclosesRecording(graph: CallFlowGraph): boolean {
  const incoming = graph.nodes.find((node) => node.type === "incoming_call");
  return incoming !== undefined && nextNode(graph, incoming.id, "next")?.type === "recording_disclosure";
}

function dialRecording(forwardNodeId: string, context: VoiceContext): string {
  return (
    ` record="record-from-answer-dual" recordingStatusCallback="${escapeXml(context.urls.recordingStatus(forwardNodeId))}" ` +
    'recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed absent"'
  );
}

const gateNotCompleted: StepOutcome = { outcome: "Blocked", reason: "gate_not_completed" };
export const correctableOutcomeReasons = ["ended_before_forward", "voicemail_not_captured"] as const;

function walk(graph: CallFlowGraph, start: FlowNode | undefined, context: VoiceContext, entry: EdgeHandle | null = null): VoiceStep {
  const verbs: string[] = [];
  const visited = new Set<string>();
  let whisperNodeId: string | null = null;
  let node = start;
  while (node && !visited.has(node.id)) {
    visited.add(node.id);
    switch (node.type) {
      case "incoming_call":
        node = nextNode(graph, node.id, "next");
        break;
      case "recording_disclosure":
        verbs.push(say(node.voice, recordingDisclosureText));
        node = nextNode(graph, node.id, "next");
        break;
      case "business_hours":
        entry = businessHoursOpen(node, context.at, context.timeZone) ? "open" : "closed";
        node = nextNode(graph, node.id, entry);
        break;
      case "keypad_gate":
        verbs.push(gather(node, 1, context));
        return { twiml: response(verbs.join("")), forwardNodeId: null, outcome: null, pending: gateNotCompleted };
      case "whisper":
        whisperNodeId = node.id;
        node = nextNode(graph, node.id, "next");
        if (node?.type !== "forward_call") return ended({ outcome: "Failed", reason: "whisper_without_forward" });
        break;
      case "forward_call":
        verbs.push(
          `<Dial action="${escapeXml(context.urls.forwardAction(node.id))}" method="POST" timeout="${node.timeoutSeconds}"${context.recordingEnabled && disclosesRecording(graph) ? dialRecording(node.id, context) : ""}>` +
            `<Number ${whisperNodeId ? `url="${escapeXml(context.urls.whisper(whisperNodeId))}" method="POST" ` : ""}statusCallback="${escapeXml(context.urls.forwardStatus(node.id))}" statusCallbackEvent="initiated answered completed" statusCallbackMethod="POST">${escapeXml(node.destinationNumber)}</Number>` +
            "</Dial>",
        );
        return { twiml: response(verbs.join("")), forwardNodeId: node.id, outcome: null, pending: null };
      case "voicemail":
        verbs.push(record(node, context));
        return {
          twiml: response(verbs.join("")),
          forwardNodeId: null,
          outcome: null,
          pending: { outcome: entry === "missed" ? "Missed" : "Abandoned", reason: "voicemail_not_captured" },
        };
      case "outcome":
        return ended({ outcome: node.outcome, reason: "flow_outcome" });
    }
  }
  return ended({ outcome: "Failed", reason: "flow_incomplete" });
}

export function renderCallStart(graph: CallFlowGraph, context: VoiceContext): VoiceStep {
  return walk(graph, graph.nodes.find((node) => node.type === "incoming_call"), context);
}

export function keypadGateResult(graph: CallFlowGraph, gateNodeId: string, digits: string, attempt: number): "passed" | "failed" | "retry" | null {
  const gate = graph.nodes.find((node) => node.id === gateNodeId);
  if (gate?.type !== "keypad_gate") return null;
  if (digits === gate.digit) return "passed";
  return attempt < keypadGateAttempts ? "retry" : "failed";
}

export function renderGatherResult(graph: CallFlowGraph, gateNodeId: string, digits: string, attempt: number, context: VoiceContext): VoiceStep {
  const gate = graph.nodes.find((node) => node.id === gateNodeId);
  if (gate?.type !== "keypad_gate") return ended({ outcome: "Failed", reason: "unknown_step" });
  const result = keypadGateResult(graph, gateNodeId, digits, attempt);
  if (result === "passed") return walk(graph, nextNode(graph, gate.id, "pass"), context, "pass");
  if (result === "retry") {
    return { twiml: response(gather(gate, attempt + 1, context)), forwardNodeId: null, outcome: null, pending: gateNotCompleted };
  }
  return walk(graph, nextNode(graph, gate.id, "blocked"), context, "blocked");
}

export function renderWhisper(graph: CallFlowGraph | null, whisperNodeId: string): string {
  const whisper = graph?.nodes.find((node) => node.id === whisperNodeId);
  return response(whisper?.type === "whisper" ? say(whisper.voice, whisper.message) : "");
}

const forwardHandles: Readonly<Record<string, EdgeHandle>> = {
  completed: "answered",
  busy: "missed",
  "no-answer": "missed",
  failed: "failed",
};

export function renderForwardResult(graph: CallFlowGraph, forwardNodeId: string, status: string, context: VoiceContext): VoiceStep {
  if (status === "canceled") return ended({ outcome: "Abandoned", reason: "caller_hung_up" });
  const handle = forwardHandles[status];
  if (!handle) return ended(null);
  return walk(graph, nextNode(graph, forwardNodeId, handle), context, handle);
}

export function voicemailCaptureOutcome(recordingStatus: string, durationSeconds: number): StepOutcome | null {
  if (recordingStatus === "failed") return { outcome: "Failed", reason: "voicemail_capture_failed" };
  return recordingStatus === "completed" && durationSeconds >= 1 ? { outcome: "Voicemail", reason: "voicemail_captured" } : null;
}
