/**
 * -------------------------------------------------------------------------
 * @file   call-flow.test.ts
 * @brief  Verifies pure Call Flow graph behavior.
 *
 * @description
 *  Covers Call Flow generation, parsing, validation, and read-only summaries.
 *
 * @remarks
 *  These tests keep graph behavior independent from persistence and providers.
 *
 * @see
 *  data/call-flow.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import {
  generateInitialCallFlow,
  parseCallFlowGraph,
  summarizeCallFlow,
  validateCallFlow,
  type CallFlowGraph,
  type FlowNode,
} from "@/data/call-flow";

const baseOptions = {
  destinationNumber: "+14155552671",
  recordingEnabled: true,
  spamGateEnabled: true,
  whisperEnabled: true,
  whisperMessage: "From Tracer.",
  disclosureVoice: "Polly.Joanna" as const,
};

function issueCodes(graph: CallFlowGraph, recordingEnabled = false): string[] {
  return validateCallFlow(graph, { recordingEnabled }).issues.map((issue) => issue.code);
}

function node(graph: CallFlowGraph, id: string): FlowNode {
  const found = graph.nodes.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing node ${id}`);
  return found;
}

describe("Call Flow graph generation", () => {
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])("generates a valid graph for recording=%s and spamGate=%s", (recordingEnabled, spamGateEnabled) => {
    const graph = generateInitialCallFlow({ ...baseOptions, recordingEnabled, spamGateEnabled });

    expect(validateCallFlow(graph, { recordingEnabled })).toEqual({ valid: true, issues: [] });
  });

  it("adds optional whisper routing and fixed outcomes", () => {
    const graph = generateInitialCallFlow(baseOptions);

    expect(graph.nodes.map(({ id }) => id)).toEqual([
      "incoming",
      "disclosure",
      "gate",
      "whisper",
      "forward",
      "outcome-answered",
      "outcome-missed",
      "outcome-failed",
      "outcome-blocked",
    ]);
    expect(node(graph, "forward")).toMatchObject({ destinationNumber: "+14155552671", timeoutSeconds: 30 });
    expect(issueCodes(graph, true)).toEqual([]);
  });
});

describe("Call Flow validation", () => {
  it("requires disclosure when recording is enabled", () => {
    const graph = generateInitialCallFlow({ ...baseOptions, recordingEnabled: false });
    const result = validateCallFlow(graph, { recordingEnabled: true });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("disclosure_required");
  });

  it("reports a missing forward-call missed branch", () => {
    const graph = generateInitialCallFlow(baseOptions);
    graph.edges = graph.edges.filter((edge) => !(edge.source === "forward" && edge.sourceHandle === "missed"));

    expect(issueCodes(graph, true)).toContain("missing_branch");
  });

  it("detects a cycle and reports its offending edge", () => {
    const graph = generateInitialCallFlow({ ...baseOptions, recordingEnabled: false, spamGateEnabled: false });
    graph.edges.push({ id: "cycle-edge", source: "forward", sourceHandle: "answered", target: "forward" });

    const result = validateCallFlow(graph, { recordingEnabled: false });

    expect(result.issues).toContainEqual({ code: "cycle", message: "Call Flow contains a cycle.", edgeId: "cycle-edge" });
  });

  it("reports nodes unreachable from the incoming call", () => {
    const graph = generateInitialCallFlow({ ...baseOptions, recordingEnabled: false });
    graph.nodes.push({ id: "orphan", type: "outcome", position: { x: 0, y: 0 }, outcome: "Abandoned" });

    expect(issueCodes(graph)).toContain("unreachable_node");
  });

  it("rejects voicemail from an answered forward-call branch", () => {
    const graph = generateInitialCallFlow({ ...baseOptions, recordingEnabled: false });
    graph.nodes.push({ id: "voicemail", type: "voicemail", position: { x: 100, y: 100 }, greeting: "Please leave a message.", voice: "Polly.Joanna" });
    graph.nodes.push({ id: "voicemail-outcome", type: "outcome", position: { x: 100, y: 260 }, outcome: "Voicemail" });
    graph.edges = graph.edges.map((edge) => edge.id === "forward-answered" ? { ...edge, target: "voicemail" } : edge);
    graph.edges.push({ id: "voicemail-next", source: "voicemail", sourceHandle: "next", target: "voicemail-outcome" });

    expect(issueCodes(graph)).toContain("voicemail_unsupported_path");
  });

  it("allows voicemail from missed to a Voicemail outcome", () => {
    const graph = generateInitialCallFlow({ ...baseOptions, recordingEnabled: false });
    graph.nodes.push({ id: "voicemail", type: "voicemail", position: { x: 100, y: 100 }, greeting: "Please leave a message.", voice: "Polly.Joanna" });
    graph.nodes.push({ id: "voicemail-outcome", type: "outcome", position: { x: 100, y: 260 }, outcome: "Voicemail" });
    graph.nodes = graph.nodes.filter((candidate) => candidate.id !== "outcome-missed");
    graph.edges = graph.edges.map((edge) => edge.id === "forward-missed" ? { ...edge, target: "voicemail" } : edge);
    graph.edges.push({ id: "voicemail-next", source: "voicemail", sourceHandle: "next", target: "voicemail-outcome" });

    expect(validateCallFlow(graph, { recordingEnabled: false })).toEqual({ valid: true, issues: [] });
  });

  it("validates destination numbers and business hours", () => {
    const graph = generateInitialCallFlow({ ...baseOptions, recordingEnabled: false });
    const forward = node(graph, "forward");
    if (forward.type !== "forward_call") throw new Error("Expected forward node");
    forward.destinationNumber = "not a phone number";
    const destinationIssues = validateCallFlow(graph, { recordingEnabled: false }).issues;
    expect(destinationIssues.map((issue) => issue.code)).toContain("invalid_destination_number");

    const businessHours: CallFlowGraph = {
      version: 1,
      nodes: [
        { id: "incoming", type: "incoming_call", position: { x: 0, y: 0 } },
        { id: "hours", type: "business_hours", position: { x: 0, y: 160 }, weeklyWindows: [{ day: 1, start: "10:00", end: "09:00" }], dateOverrides: [] },
        { id: "closed", type: "outcome", position: { x: 80, y: 320 }, outcome: "Missed" },
        { id: "forward", type: "forward_call", position: { x: 0, y: 480 }, destinationNumber: "+14155552671", timeoutSeconds: 30 },
        { id: "answered", type: "outcome", position: { x: -80, y: 640 }, outcome: "Answered" },
        { id: "missed", type: "outcome", position: { x: 80, y: 640 }, outcome: "Missed" },
        { id: "failed", type: "outcome", position: { x: 0, y: 640 }, outcome: "Failed" },
      ],
      edges: [
        { id: "incoming-next", source: "incoming", sourceHandle: "next", target: "hours" },
        { id: "hours-open", source: "hours", sourceHandle: "open", target: "forward" },
        { id: "hours-closed", source: "hours", sourceHandle: "closed", target: "closed" },
        { id: "forward-answered", source: "forward", sourceHandle: "answered", target: "answered" },
        { id: "forward-missed", source: "forward", sourceHandle: "missed", target: "missed" },
        { id: "forward-failed", source: "forward", sourceHandle: "failed", target: "failed" },
      ],
    };
    expect(issueCodes(businessHours)).toContain("invalid_business_hours");
    const validHours = businessHours.nodes.find((candidate) => candidate.id === "hours");
    if (!validHours || validHours.type !== "business_hours") throw new Error("Expected business hours node");
    validHours.weeklyWindows = [{ day: 1, start: "09:00", end: "17:00" }];
    expect(validateCallFlow(businessHours, { recordingEnabled: false })).toEqual({ valid: true, issues: [] });
  });
});

describe("Call Flow parsing and summaries", () => {
  it("rejects malformed input and round-trips generated graphs", () => {
    expect(parseCallFlowGraph({ version: 1, nodes: [{ id: "incoming", type: "unknown", position: { x: 0, y: 0 } }], edges: [] })).toBeNull();
    expect(parseCallFlowGraph({ version: 1, nodes: [{ id: "incoming", type: "incoming_call" }], edges: [] })).toBeNull();

    const graph = generateInitialCallFlow(baseOptions);
    expect(parseCallFlowGraph(JSON.parse(JSON.stringify(graph)))).toEqual(graph);
  });

  it("summarizes generated execution order", () => {
    const graph = generateInitialCallFlow(baseOptions);

    expect(summarizeCallFlow(graph)).toEqual([
      "Incoming Call",
      "Recording Disclosure",
      "Keypad Gate: press 1 to continue (Blocked -> Blocked)",
      "Whisper: From Tracer.",
      "Forward Call to +14155552671",
      "Answered -> Answered",
      "Missed -> Missed",
      "Failed -> Failed",
      "Blocked -> Blocked",
    ]);
  });
});
