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
  businessHoursOpen,
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

  it("summarizes generated execution order with branch outcomes", () => {
    const graph = generateInitialCallFlow(baseOptions);

    expect(summarizeCallFlow(graph)).toEqual([
      { branch: null, depth: 0, label: "Incoming Call" },
      { branch: null, depth: 0, label: "Recording Disclosure" },
      { branch: null, depth: 0, label: "Keypad Gate: press 1 to continue" },
      { branch: "Pass", depth: 1, label: 'Whisper: "From Tracer."' },
      { branch: null, depth: 1, label: "Forward Call to +14155552671" },
      { branch: "Answered", depth: 2, label: "Outcome: Answered" },
      { branch: "Missed", depth: 2, label: "Outcome: Missed" },
      { branch: "Failed", depth: 2, label: "Outcome: Failed" },
      { branch: "Blocked", depth: 1, label: "Outcome: Blocked" },
    ]);
  });

  it("summarizes Business Hours windows, overrides, and the Voicemail branch", () => {
    const graph: CallFlowGraph = {
      version: 1,
      nodes: [
        { id: "incoming", type: "incoming_call", position: { x: 0, y: 0 } },
        { id: "hours", type: "business_hours", position: { x: 0, y: 0 }, weeklyWindows: [{ day: 1, start: "09:00", end: "17:00" }, { day: 5, start: "22:00", end: "24:00" }], dateOverrides: [{ date: "2026-12-25", open: false }] },
        { id: "forward", type: "forward_call", position: { x: 0, y: 0 }, destinationNumber: "+14155552671", timeoutSeconds: 30 },
        { id: "voicemail", type: "voicemail", position: { x: 0, y: 0 }, greeting: "Leave a message.", voice: "Polly.Joanna" },
        { id: "outcome-voicemail", type: "outcome", position: { x: 0, y: 0 }, outcome: "Voicemail" },
        { id: "outcome-answered", type: "outcome", position: { x: 0, y: 0 }, outcome: "Answered" },
        { id: "outcome-failed", type: "outcome", position: { x: 0, y: 0 }, outcome: "Failed" },
      ],
      edges: [
        { id: "e1", source: "incoming", sourceHandle: "next", target: "hours" },
        { id: "e2", source: "hours", sourceHandle: "open", target: "forward" },
        { id: "e3", source: "hours", sourceHandle: "closed", target: "voicemail" },
        { id: "e4", source: "forward", sourceHandle: "answered", target: "outcome-answered" },
        { id: "e5", source: "forward", sourceHandle: "missed", target: "voicemail" },
        { id: "e6", source: "forward", sourceHandle: "failed", target: "outcome-failed" },
        { id: "e7", source: "voicemail", sourceHandle: "next", target: "outcome-voicemail" },
      ],
    };

    expect(summarizeCallFlow(graph)).toEqual([
      { branch: null, depth: 0, label: "Incoming Call" },
      { branch: null, depth: 0, label: "Business Hours: Mon 09:00-17:00, Fri 22:00-24:00; 1 date override" },
      { branch: "Open", depth: 1, label: "Forward Call to +14155552671" },
      { branch: "Answered", depth: 2, label: "Outcome: Answered" },
      { branch: "Missed", depth: 2, label: 'Voicemail: "Leave a message."' },
      { branch: null, depth: 2, label: "Outcome: Voicemail" },
      { branch: "Failed", depth: 2, label: "Outcome: Failed" },
      { branch: "Closed", depth: 1, label: 'Voicemail: "Leave a message."' },
      { branch: null, depth: 1, label: "Outcome: Voicemail" },
    ]);
  });
});

describe("Business Hours evaluation", () => {
  const weekdays = [1, 2, 3, 4, 5].map((day) => ({ day: day as 1 | 2 | 3 | 4 | 5, start: "09:00", end: "17:00" }));
  const hours = { weeklyWindows: weekdays, dateOverrides: [] };
  const timeZone = "America/Los_Angeles";

  it.each([
    ["2026-10-19T15:59:00Z", false],
    ["2026-10-19T16:00:00Z", true],
    ["2026-10-19T23:59:00Z", true],
    ["2026-10-20T00:00:00Z", false],
  ])("treats a weekly window as open from its start until its end in the Workspace timezone at %s", (at, open) => {
    expect(businessHoursOpen(hours, new Date(at), timeZone)).toBe(open);
  });

  it("follows the Workspace timezone across a daylight saving transition", () => {
    expect(businessHoursOpen(hours, new Date("2026-11-02T16:59:00Z"), timeZone)).toBe(false);
    expect(businessHoursOpen(hours, new Date("2026-11-02T17:00:00Z"), timeZone)).toBe(true);
  });

  it("stays closed on days without a weekly window", () => {
    expect(businessHoursOpen(hours, new Date("2026-10-18T19:00:00Z"), timeZone)).toBe(false);
  });

  it("keeps an overnight window open through midnight when entered as segments ending at 24:00", () => {
    const overnight = { weeklyWindows: [{ day: 5 as const, start: "22:00", end: "24:00" }, { day: 6 as const, start: "00:00", end: "02:00" }], dateOverrides: [] };
    expect(businessHoursOpen(overnight, new Date("2026-10-24T06:59:00Z"), timeZone)).toBe(true);
    expect(businessHoursOpen(overnight, new Date("2026-10-24T07:00:00Z"), timeZone)).toBe(true);
    expect(businessHoursOpen(overnight, new Date("2026-10-24T09:00:00Z"), timeZone)).toBe(false);
  });

  it("lets a closed date override close a whole weekday", () => {
    const closedMonday = { weeklyWindows: weekdays, dateOverrides: [{ date: "2026-10-19", open: false }] };
    expect(businessHoursOpen(closedMonday, new Date("2026-10-19T19:00:00Z"), timeZone)).toBe(false);
  });

  it("replaces the weekly windows of a date with its open overrides", () => {
    const shortMonday = {
      weeklyWindows: weekdays,
      dateOverrides: [{ date: "2026-10-19", open: true, start: "10:00", end: "12:00" }, { date: "2026-10-19", open: true, start: "13:00", end: "14:00" }],
    };
    expect(businessHoursOpen(shortMonday, new Date("2026-10-19T16:30:00Z"), timeZone)).toBe(false);
    expect(businessHoursOpen(shortMonday, new Date("2026-10-19T17:30:00Z"), timeZone)).toBe(true);
    expect(businessHoursOpen(shortMonday, new Date("2026-10-19T20:30:00Z"), timeZone)).toBe(true);
    expect(businessHoursOpen(shortMonday, new Date("2026-10-19T22:00:00Z"), timeZone)).toBe(false);
  });

  it("opens a weekend date through an open override", () => {
    const openSunday = { weeklyWindows: weekdays, dateOverrides: [{ date: "2026-10-18", open: true, start: "11:00", end: "15:00" }] };
    expect(businessHoursOpen(openSunday, new Date("2026-10-18T19:00:00Z"), timeZone)).toBe(true);
  });

  it("accepts 24:00 as a window end and rejects it as a start", () => {
    const graph = generateInitialCallFlow({ ...baseOptions, spamGateEnabled: false, whisperEnabled: false, recordingEnabled: false });
    const withHours = (weeklyWindows: Array<{ day: 1; start: string; end: string }>): CallFlowGraph => ({
      ...graph,
      nodes: [...graph.nodes, { id: "hours", type: "business_hours", position: { x: 0, y: 0 }, weeklyWindows, dateOverrides: [] }],
    });
    expect(issueCodes(withHours([{ day: 1, start: "22:00", end: "24:00" }]))).not.toContain("invalid_business_hours");
    expect(issueCodes(withHours([{ day: 1, start: "24:00", end: "24:00" }]))).toContain("invalid_business_hours");
  });
});

describe("Whisper validation", () => {
  it("requires a Whisper to lead directly to a Forward Call", () => {
    const graph = generateInitialCallFlow({ ...baseOptions, spamGateEnabled: false });
    const misplaced: CallFlowGraph = {
      ...graph,
      nodes: [...graph.nodes, { id: "outcome-early", type: "outcome", position: { x: 0, y: 0 }, outcome: "Answered" }],
      edges: graph.edges.map((edge) => (edge.source === "whisper" ? { ...edge, target: "outcome-early" } : edge)),
    };
    expect(issueCodes(graph, true)).not.toContain("whisper_requires_forward");
    expect(issueCodes(misplaced, true)).toContain("whisper_requires_forward");
  });
});
