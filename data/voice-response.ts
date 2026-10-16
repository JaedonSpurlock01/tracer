/**
 * -------------------------------------------------------------------------
 * @file   voice-response.ts
 * @brief  Renders constrained TwiML from a Call's pinned Flow Version.
 *
 * @description
 *  Walks a published Call Flow graph from Incoming Call and emits only the
 *  approved verbs: the fixed Recording Disclosure, Forward Call, and Hangup
 *  at a terminal Outcome step. Forward Call results follow the published
 *  answered, missed, or failed branch to a canonical Call Outcome.
 *
 * @remarks
 *  M9 executes Incoming Call, Recording Disclosure, Forward Call, and
 *  Outcome steps. A Call whose path reaches a step deferred to M10 plays
 *  nothing and ends as Failed rather than silently skipping that step. The
 *  forwarded call's own status callback is the reliable Forward Call result,
 *  because Twilio does not guarantee the Dial action request when the caller
 *  hangs up first.
 *
 * @see
 *  data/call-flow.ts
 *  https://www.twilio.com/docs/voice/twiml/dial
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { recordingDisclosureText, type CallFlowGraph, type EdgeHandle, type FlowNode, type OutcomeKind } from "@/data/call-flow";

export interface VoiceUrls {
  forwardAction(nodeId: string): string;
  forwardStatus(nodeId: string): string;
}

export interface VoiceStep {
  twiml: string;
  forwardNodeId: string | null;
  outcome: { outcome: OutcomeKind; reason: string } | null;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function response(verbs: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${verbs}</Response>`;
}

const hangup = response("<Hangup/>");

function nextNode(graph: CallFlowGraph, nodeId: string, handle: EdgeHandle): FlowNode | undefined {
  const edge = graph.edges.find((candidate) => candidate.source === nodeId && candidate.sourceHandle === handle);
  return edge ? graph.nodes.find((node) => node.id === edge.target) : undefined;
}

function walk(graph: CallFlowGraph, start: FlowNode | undefined, urls: VoiceUrls | null): VoiceStep {
  const verbs: string[] = [];
  const visited = new Set<string>();
  let node = start;
  while (node && !visited.has(node.id)) {
    visited.add(node.id);
    switch (node.type) {
      case "incoming_call":
        node = nextNode(graph, node.id, "next");
        break;
      case "recording_disclosure":
        verbs.push(`<Say voice="${escapeXml(node.voice)}">${escapeXml(recordingDisclosureText)}</Say>`);
        node = nextNode(graph, node.id, "next");
        break;
      case "forward_call":
        if (!urls) return { twiml: hangup, forwardNodeId: null, outcome: { outcome: "Failed", reason: "unsupported_step:forward_call" } };
        verbs.push(
          `<Dial action="${escapeXml(urls.forwardAction(node.id))}" method="POST" timeout="${node.timeoutSeconds}">` +
            `<Number statusCallback="${escapeXml(urls.forwardStatus(node.id))}" statusCallbackEvent="initiated answered completed" statusCallbackMethod="POST">${escapeXml(node.destinationNumber)}</Number>` +
            "</Dial>",
        );
        return { twiml: response(verbs.join("")), forwardNodeId: node.id, outcome: null };
      case "outcome":
        return { twiml: hangup, forwardNodeId: null, outcome: { outcome: node.outcome, reason: "flow_outcome" } };
      default:
        return { twiml: hangup, forwardNodeId: null, outcome: { outcome: "Failed", reason: `unsupported_step:${node.type}` } };
    }
  }
  return { twiml: hangup, forwardNodeId: null, outcome: { outcome: "Failed", reason: "flow_incomplete" } };
}

export function renderCallStart(graph: CallFlowGraph, urls: VoiceUrls): VoiceStep {
  return walk(graph, graph.nodes.find((node) => node.type === "incoming_call"), urls);
}

const forwardHandles: Readonly<Record<string, EdgeHandle>> = {
  completed: "answered",
  busy: "missed",
  "no-answer": "missed",
  failed: "failed",
};

export function renderForwardResult(graph: CallFlowGraph, forwardNodeId: string, status: string): VoiceStep {
  if (status === "canceled") return { twiml: hangup, forwardNodeId: null, outcome: { outcome: "Abandoned", reason: "caller_hung_up" } };
  const handle = forwardHandles[status];
  if (!handle) return { twiml: hangup, forwardNodeId: null, outcome: null };
  return walk(graph, nextNode(graph, forwardNodeId, handle), null);
}
