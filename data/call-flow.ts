/**
 * -------------------------------------------------------------------------
 * @file   call-flow.ts
 * @brief  Defines the pure Call Flow graph domain.
 *
 * @description
 *  Models, parses, validates, generates, and summarizes constrained inbound
 *  call-routing graphs without persistence or provider dependencies.
 *
 * @remarks
 *  Graph validation stays independent from React Flow and database concerns so
 *  drafts can be checked before they are published. Adding a node type touches
 *  this file (the FlowNode union, nodeHandles, parseNode, validateCallFlow,
 *  describeFlowNode, flowNodeCatalog, createFlowNode), the icon map in
 *  components/tracer/flow/node-icon.tsx, and the type's fields in
 *  components/tracer/flow/flow-inspector.tsx; every renderer reads the
 *  description and tree from here.
 *
 * @see
 *  CONTEXT.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { normalizeE164PhoneNumber } from "@/data/phone-number";

export type OutcomeKind = "Answered" | "Voicemail" | "Missed" | "Abandoned" | "Blocked" | "Failed";
export const outcomeKinds: readonly OutcomeKind[] = ["Answered", "Voicemail", "Missed", "Abandoned", "Blocked", "Failed"];

export type TtsVoice = "Polly.Joanna" | "Polly.Matthew" | "Polly.Salli" | "Polly.Joey";
export const ttsVoices: readonly TtsVoice[] = ["Polly.Joanna", "Polly.Matthew", "Polly.Salli", "Polly.Joey"];

export const recordingDisclosureText = "This call may be recorded for quality purposes.";
export const voicemailLimits = { maxSeconds: 120, silenceTimeoutSeconds: 5, finishOnKey: "#" } as const;
export const promptMaxLength = 500;

export interface FlowPosition {
  x: number;
  y: number;
}

export interface WeeklyWindow {
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  start: string;
  end: string;
}

export interface DateOverride {
  date: string;
  open: boolean;
  start?: string;
  end?: string;
}

export type FlowNode =
  | { id: string; type: "incoming_call"; position: FlowPosition }
  | { id: string; type: "recording_disclosure"; position: FlowPosition; voice: TtsVoice }
  | { id: string; type: "business_hours"; position: FlowPosition; weeklyWindows: WeeklyWindow[]; dateOverrides: DateOverride[] }
  | { id: string; type: "keypad_gate"; position: FlowPosition; prompt: string; voice: TtsVoice; digit: string; timeoutSeconds: number }
  | { id: string; type: "forward_call"; position: FlowPosition; destinationNumber: string; timeoutSeconds: number }
  | { id: string; type: "whisper"; position: FlowPosition; message: string; voice: TtsVoice }
  | { id: string; type: "voicemail"; position: FlowPosition; greeting: string; voice: TtsVoice }
  | { id: string; type: "outcome"; position: FlowPosition; outcome: OutcomeKind };

export type FlowNodeType = FlowNode["type"];
export type EdgeHandle = "next" | "open" | "closed" | "pass" | "blocked" | "answered" | "missed" | "failed";

export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle: EdgeHandle;
  target: string;
}

export interface CallFlowGraph {
  version: 1;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export const nodeHandles: Record<FlowNodeType, readonly EdgeHandle[]> = {
  incoming_call: ["next"],
  recording_disclosure: ["next"],
  business_hours: ["open", "closed"],
  keypad_gate: ["pass", "blocked"],
  forward_call: ["answered", "missed", "failed"],
  whisper: ["next"],
  voicemail: ["next"],
  outcome: [],
};

/** Semantic tone of a branch or Outcome, mapped to Badge variants and edge colors by renderers. */
export type FlowTone = "neutral" | "success" | "warning" | "destructive";

export const branchTones: Record<EdgeHandle, FlowTone> = {
  next: "neutral",
  open: "success",
  closed: "warning",
  pass: "success",
  blocked: "destructive",
  answered: "success",
  missed: "warning",
  failed: "destructive",
};

export const outcomeTones: Record<OutcomeKind, FlowTone> = {
  Answered: "success",
  Voicemail: "success",
  Missed: "warning",
  Abandoned: "warning",
  Blocked: "destructive",
  Failed: "destructive",
};

export interface ValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface InitialFlowOptions {
  destinationNumber: string;
  recordingEnabled: boolean;
  spamGateEnabled: boolean;
  whisperEnabled: boolean;
  whisperMessage: string | null;
  disclosureVoice: TtsVoice;
}

const nodeTypes: readonly FlowNodeType[] = [
  "incoming_call",
  "recording_disclosure",
  "business_hours",
  "keypad_gate",
  "forward_call",
  "whisper",
  "voicemail",
  "outcome",
];

const edgeHandles: readonly EdgeHandle[] = ["next", "open", "closed", "pass", "blocked", "answered", "missed", "failed"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeType(value: unknown): value is FlowNodeType {
  return typeof value === "string" && nodeTypes.includes(value as FlowNodeType);
}

function isEdgeHandle(value: unknown): value is EdgeHandle {
  return typeof value === "string" && edgeHandles.includes(value as EdgeHandle);
}

function isOutcomeKind(value: unknown): value is OutcomeKind {
  return typeof value === "string" && outcomeKinds.includes(value as OutcomeKind);
}

function isTtsVoice(value: unknown): value is TtsVoice {
  return typeof value === "string" && ttsVoices.includes(value as TtsVoice);
}

function parsePosition(value: unknown): FlowPosition | null {
  if (!isRecord(value) || typeof value.x !== "number" || !Number.isFinite(value.x) || typeof value.y !== "number" || !Number.isFinite(value.y)) {
    return null;
  }
  return { x: value.x, y: value.y };
}

function parseWeeklyWindow(value: unknown): WeeklyWindow | null {
  if (!isRecord(value) || typeof value.day !== "number" || !Number.isInteger(value.day) || typeof value.start !== "string" || typeof value.end !== "string") {
    return null;
  }
  return { day: value.day as WeeklyWindow["day"], start: value.start, end: value.end };
}

function parseDateOverride(value: unknown): DateOverride | null {
  if (!isRecord(value) || typeof value.date !== "string" || typeof value.open !== "boolean") return null;
  if (value.start !== undefined && typeof value.start !== "string") return null;
  if (value.end !== undefined && typeof value.end !== "string") return null;
  return { date: value.date, open: value.open, ...(value.start === undefined ? {} : { start: value.start }), ...(value.end === undefined ? {} : { end: value.end }) };
}

function parseNode(value: unknown): FlowNode | null {
  if (!isRecord(value) || typeof value.id !== "string" || !isNodeType(value.type)) return null;
  const position = parsePosition(value.position);
  if (!position) return null;

  switch (value.type) {
    case "incoming_call":
      return { id: value.id, type: value.type, position };
    case "recording_disclosure":
      return isTtsVoice(value.voice) ? { id: value.id, type: value.type, position, voice: value.voice } : null;
    case "business_hours": {
      if (!Array.isArray(value.weeklyWindows) || !Array.isArray(value.dateOverrides)) return null;
      const weeklyWindows = value.weeklyWindows.map(parseWeeklyWindow);
      const dateOverrides = value.dateOverrides.map(parseDateOverride);
      return weeklyWindows.every((window): window is WeeklyWindow => window !== null) && dateOverrides.every((override): override is DateOverride => override !== null)
        ? { id: value.id, type: value.type, position, weeklyWindows, dateOverrides }
        : null;
    }
    case "keypad_gate":
      return typeof value.prompt === "string" && isTtsVoice(value.voice) && typeof value.digit === "string" && typeof value.timeoutSeconds === "number"
        ? { id: value.id, type: value.type, position, prompt: value.prompt, voice: value.voice, digit: value.digit, timeoutSeconds: value.timeoutSeconds }
        : null;
    case "forward_call":
      return typeof value.destinationNumber === "string" && typeof value.timeoutSeconds === "number"
        ? { id: value.id, type: value.type, position, destinationNumber: value.destinationNumber, timeoutSeconds: value.timeoutSeconds }
        : null;
    case "whisper":
      return typeof value.message === "string" && isTtsVoice(value.voice) ? { id: value.id, type: value.type, position, message: value.message, voice: value.voice } : null;
    case "voicemail":
      return typeof value.greeting === "string" && isTtsVoice(value.voice) ? { id: value.id, type: value.type, position, greeting: value.greeting, voice: value.voice } : null;
    case "outcome":
      return isOutcomeKind(value.outcome) ? { id: value.id, type: value.type, position, outcome: value.outcome } : null;
  }
}

export function parseCallFlowGraph(value: unknown): CallFlowGraph | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return null;
  const nodes = value.nodes.map(parseNode);
  if (!nodes.every((node): node is FlowNode => node !== null)) return null;
  const edges = value.edges.map((edge): FlowEdge | null => {
    if (!isRecord(edge) || typeof edge.id !== "string" || typeof edge.source !== "string" || !isEdgeHandle(edge.sourceHandle) || typeof edge.target !== "string") return null;
    return { id: edge.id, source: edge.source, sourceHandle: edge.sourceHandle, target: edge.target };
  });
  return edges.every((edge): edge is FlowEdge => edge !== null) ? { version: 1, nodes, edges } : null;
}

function issue(code: string, message: string, details: Pick<ValidationIssue, "nodeId" | "edgeId"> = {}): ValidationIssue {
  return { code, message, ...details };
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validWindow(start: unknown, end: unknown): boolean {
  return validTime(start) && (validTime(end) || end === "24:00") && start < (end as string);
}

export interface BusinessHours {
  weeklyWindows: WeeklyWindow[];
  dateOverrides: DateOverride[];
}

export function businessHoursOpen(hours: BusinessHours, at: Date, timeZone: string): boolean {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const overrides = hours.dateOverrides.filter((override) => override.date === date);
  const windows = overrides.length > 0
    ? overrides.flatMap((override) => (override.open && override.start && override.end ? [{ start: override.start, end: override.end }] : []))
    : hours.weeklyWindows.filter((window) => window.day === day);
  return windows.some((window) => window.start <= time && time < window.end);
}

function nodeById(nodes: FlowNode[]): Map<string, FlowNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

export function validateCallFlow(graph: CallFlowGraph, context: { recordingEnabled: boolean }): ValidationResult {
  const issues: ValidationIssue[] = [];
  const nodes = graph.nodes;
  const edges = graph.edges;
  const byId = nodeById(nodes);
  const incomingNodes = nodes.filter((node) => node.type === "incoming_call");
  const incomingCountValid = incomingNodes.length === 1 && !edges.some((edge) => edge.target === incomingNodes[0]?.id);

  if (incomingNodes.length !== 1) issues.push(issue("incoming_call_count", "Call Flow must have one incoming call node."));
  if (incomingNodes.length === 1 && !incomingCountValid) issues.push(issue("incoming_call_count", "Incoming call cannot have incoming edges.", { nodeId: incomingNodes[0].id }));

  const seenIds = new Set<string>();
  for (const node of nodes) {
    if (seenIds.has(node.id)) issues.push(issue("duplicate_node_id", "Node ids must be unique.", { nodeId: node.id }));
    seenIds.add(node.id);
  }

  for (const edge of edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source) issues.push(issue("unknown_node", "Edge source node is missing.", { edgeId: edge.id }));
    if (!target) issues.push(issue("unknown_node", "Edge target node is missing.", { edgeId: edge.id }));
    if (source && isNodeType(source.type) && !nodeHandles[source.type].includes(edge.sourceHandle)) {
      issues.push(issue("unknown_handle", "Edge handle is not supported by its source.", { edgeId: edge.id }));
    }
  }

  for (const node of nodes) {
    if (node.type === "outcome" && edges.some((edge) => edge.source === node.id)) {
      issues.push(issue("outcome_has_outgoing", "Outcome nodes cannot have outgoing edges.", { nodeId: node.id }));
    }
  }

  if (incomingCountValid) {
    for (const node of nodes) {
      if (!isNodeType(node.type)) continue;
      for (const handle of nodeHandles[node.type]) {
        const outgoing = edges.filter((edge) => edge.source === node.id && edge.sourceHandle === handle);
        if (outgoing.length === 0) issues.push(issue("missing_branch", "A required branch is missing.", { nodeId: node.id }));
        if (outgoing.length > 1) issues.push(issue("duplicate_branch", "A branch has multiple edges.", { nodeId: node.id }));
      }
    }

    const visited = new Set<string>();
    const active = new Set<string>();
    let cycleEdgeId: string | undefined;
    const visit = (nodeId: string): void => {
      if (cycleEdgeId || active.has(nodeId)) return;
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      active.add(nodeId);
      for (const edge of edges.filter((candidate) => candidate.source === nodeId)) {
        if (active.has(edge.target)) {
          cycleEdgeId = edge.id;
          break;
        }
        if (byId.has(edge.target)) visit(edge.target);
        if (cycleEdgeId) break;
      }
      active.delete(nodeId);
    };
    const incoming = incomingNodes[0];
    if (incoming) visit(incoming.id);
    if (cycleEdgeId) issues.push(issue("cycle", "Call Flow contains a cycle.", { edgeId: cycleEdgeId }));

    for (const node of nodes) {
      if (!visited.has(node.id)) issues.push(issue("unreachable_node", "Node is unreachable from the incoming call.", { nodeId: node.id }));
    }
  }

  if (!nodes.some((node) => node.type === "forward_call")) issues.push(issue("missing_forward_call", "Call Flow must contain a forward call."));

  const disclosureNodes = nodes.filter((node) => node.type === "recording_disclosure");
  if (disclosureNodes.length > 1) issues.push(issue("disclosure_duplicate", "Call Flow may contain one recording disclosure.", { nodeId: disclosureNodes[1].id }));
  if (context.recordingEnabled && incomingNodes.length === 1) {
    const disclosureEdge = edges.find((edge) => edge.source === incomingNodes[0].id && edge.sourceHandle === "next");
    const target = disclosureEdge ? byId.get(disclosureEdge.target) : undefined;
    if (!target || target.type !== "recording_disclosure") issues.push(issue("disclosure_required", "Recording requires a disclosure step.", { nodeId: incomingNodes[0].id }));
  }

  for (const edge of edges) {
    const target = byId.get(edge.target);
    const source = byId.get(edge.source);
    if (target?.type === "voicemail" && (!source || !(source.type === "business_hours" && edge.sourceHandle === "closed") && !(source.type === "forward_call" && edge.sourceHandle === "missed"))) {
      issues.push(issue("voicemail_unsupported_path", "Voicemail has an unsupported entry path.", { edgeId: edge.id }));
    }
  }

  for (const node of nodes) {
    if (node.type !== "whisper") continue;
    const next = edges.find((edge) => edge.source === node.id && edge.sourceHandle === "next");
    if (next && byId.get(next.target)?.type !== "forward_call") {
      issues.push(issue("whisper_requires_forward", "Whisper must lead directly to a forward call.", { nodeId: node.id }));
    }
  }

  for (const node of nodes) {
    if (node.type !== "voicemail") continue;
    const nextEdges = edges.filter((edge) => edge.source === node.id && edge.sourceHandle === "next");
    const target = nextEdges.length === 1 ? byId.get(nextEdges[0].target) : undefined;
    if (nextEdges.length !== 1 || target?.type !== "outcome" || target.outcome !== "Voicemail") {
      issues.push(issue("voicemail_outcome", "Voicemail must end in a Voicemail outcome.", { nodeId: node.id }));
    }
  }

  for (const node of nodes) {
    switch (node.type) {
      case "recording_disclosure":
      case "keypad_gate":
      case "whisper":
      case "voicemail":
        if (!isTtsVoice(node.voice)) issues.push(issue("invalid_voice", "Voice is not supported.", { nodeId: node.id }));
        break;
    }
    if (node.type === "forward_call" && (typeof node.destinationNumber !== "string" || !normalizeE164PhoneNumber(node.destinationNumber))) {
      issues.push(issue("invalid_destination_number", "Destination Number is invalid.", { nodeId: node.id }));
    }
    if ((node.type === "forward_call" && (!Number.isInteger(node.timeoutSeconds) || node.timeoutSeconds < 5 || node.timeoutSeconds > 120)) || (node.type === "keypad_gate" && (!Number.isInteger(node.timeoutSeconds) || node.timeoutSeconds < 1 || node.timeoutSeconds > 30))) {
      issues.push(issue("invalid_timeout", "Timeout is outside the supported range.", { nodeId: node.id }));
    }
    if (node.type === "keypad_gate" && (typeof node.prompt !== "string" || node.prompt.trim().length < 1 || node.prompt.trim().length > promptMaxLength)) {
      issues.push(issue("invalid_prompt", "Prompt must be 1 to 500 characters.", { nodeId: node.id }));
    }
    if (node.type === "whisper" && (typeof node.message !== "string" || node.message.trim().length < 1 || node.message.trim().length > promptMaxLength)) {
      issues.push(issue("invalid_prompt", "Message must be 1 to 500 characters.", { nodeId: node.id }));
    }
    if (node.type === "voicemail" && (typeof node.greeting !== "string" || node.greeting.trim().length < 1 || node.greeting.trim().length > promptMaxLength)) {
      issues.push(issue("invalid_prompt", "Greeting must be 1 to 500 characters.", { nodeId: node.id }));
    }
    if (node.type === "keypad_gate" && (typeof node.digit !== "string" || !/^[0-9]$/.test(node.digit))) {
      issues.push(issue("invalid_digit", "Keypad digit must be one number.", { nodeId: node.id }));
    }
    if (node.type === "business_hours") {
      let valid = node.weeklyWindows.length > 0 || node.dateOverrides.some((override) => override.open === true);
      for (const window of node.weeklyWindows) {
        if (!Number.isInteger(window.day) || window.day < 0 || window.day > 6 || !validWindow(window.start, window.end)) valid = false;
      }
      for (const override of node.dateOverrides) {
        if (!validDate(override.date) || typeof override.open !== "boolean") valid = false;
        if (override.open && !validWindow(override.start, override.end)) valid = false;
      }
      if (!valid) issues.push(issue("invalid_business_hours", "Business hours configuration is invalid.", { nodeId: node.id }));
    }
  }

  return { valid: issues.length === 0, issues };
}

export function generateInitialCallFlow(options: InitialFlowOptions): CallFlowGraph {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const addNode = <T extends FlowNode>(node: Omit<T, "position">): T => {
    const positioned = { ...node, position: { x: 0, y: nodes.length * 160 } } as T;
    nodes.push(positioned);
    return positioned;
  };
  const addEdge = (source: string, sourceHandle: EdgeHandle, target: string): void => {
    edges.push({ id: `${source}-${sourceHandle}`, source, sourceHandle, target });
  };

  addNode<Extract<FlowNode, { type: "incoming_call" }>>({ id: "incoming", type: "incoming_call" });
  let previousId = "incoming";
  if (options.recordingEnabled) {
    addNode<Extract<FlowNode, { type: "recording_disclosure" }>>({ id: "disclosure", type: "recording_disclosure", voice: options.disclosureVoice });
    addEdge(previousId, "next", "disclosure");
    previousId = "disclosure";
  }
  if (options.spamGateEnabled) {
    addNode<Extract<FlowNode, { type: "keypad_gate" }>>({ id: "gate", type: "keypad_gate", prompt: "Press 1 to be connected.", voice: options.disclosureVoice, digit: "1", timeoutSeconds: 10 });
    addEdge(previousId, "next", "gate");
    previousId = "gate";
  }
  if (options.whisperEnabled) {
    addNode<Extract<FlowNode, { type: "whisper" }>>({ id: "whisper", type: "whisper", message: options.whisperMessage ?? "", voice: options.disclosureVoice });
    addEdge(previousId, options.spamGateEnabled ? "pass" : "next", "whisper");
    previousId = "whisper";
  }
  addNode<Extract<FlowNode, { type: "forward_call" }>>({ id: "forward", type: "forward_call", destinationNumber: options.destinationNumber, timeoutSeconds: 30 });
  const forwardHandle: EdgeHandle = options.spamGateEnabled && !options.whisperEnabled ? "pass" : "next";
  addEdge(previousId, forwardHandle, "forward");

  const outcomeBranches: Array<[EdgeHandle, OutcomeKind, string]> = [["answered", "Answered", "outcome-answered"], ["missed", "Missed", "outcome-missed"], ["failed", "Failed", "outcome-failed"]];
  for (const [, outcome, id] of outcomeBranches) addNode<Extract<FlowNode, { type: "outcome" }>>({ id, type: "outcome", outcome });
  for (const [handle, , id] of outcomeBranches) addEdge("forward", handle, id);
  if (options.spamGateEnabled) {
    addNode<Extract<FlowNode, { type: "outcome" }>>({ id: "outcome-blocked", type: "outcome", outcome: "Blocked" });
    addEdge("gate", "blocked", "outcome-blocked");
  }

  return { version: 1, nodes, edges };
}

export interface FlowSummaryItem {
  branch: string | null;
  depth: number;
  label: string;
}

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const branchLabels: Record<EdgeHandle, string | null> = {
  next: null,
  open: "Open",
  closed: "Closed",
  pass: "Pass",
  blocked: "Blocked",
  answered: "Answered",
  missed: "Missed",
  failed: "Failed",
};

function summaryLabel(node: FlowNode): string {
  switch (node.type) {
    case "incoming_call": return "Incoming Call";
    case "recording_disclosure": return "Recording Disclosure";
    case "business_hours": {
      const windows = node.weeklyWindows.map((window) => `${weekdayNames[window.day]} ${window.start}-${window.end}`).join(", ") || "No weekly windows";
      const overrides = node.dateOverrides.length === 0 ? "" : `; ${node.dateOverrides.length} date override${node.dateOverrides.length === 1 ? "" : "s"}`;
      return `Business Hours: ${windows}${overrides}`;
    }
    case "keypad_gate": return `Keypad Gate: press ${node.digit} to continue`;
    case "forward_call": return `Forward Call to ${node.destinationNumber}`;
    case "whisper": return `Whisper: "${node.message}"`;
    case "voicemail": return `Voicemail: "${node.greeting}"`;
    case "outcome": return `Outcome: ${node.outcome}`;
  }
}

export function summarizeCallFlow(graph: CallFlowGraph): FlowSummaryItem[] {
  const byId = nodeById(graph.nodes);
  const items: FlowSummaryItem[] = [];
  const visit = (nodeId: string, branch: string | null, depth: number, path: ReadonlySet<string>): void => {
    const node = byId.get(nodeId);
    if (!node || path.has(nodeId)) return;
    items.push({ branch, depth, label: summaryLabel(node) });
    const nextPath = new Set(path).add(nodeId);
    const outgoing = nodeHandles[node.type].flatMap((handle) => graph.edges.filter((edge) => edge.source === node.id && edge.sourceHandle === handle));
    const branching = outgoing.length > 1;
    for (const edge of outgoing) visit(edge.target, branchLabels[edge.sourceHandle], branching ? depth + 1 : depth, nextPath);
  };
  const incoming = graph.nodes.find((node) => node.type === "incoming_call");
  if (incoming) visit(incoming.id, null, 0, new Set());
  return items;
}

const nodeTitles: Record<FlowNodeType, string> = {
  incoming_call: "Incoming Call",
  recording_disclosure: "Recording Disclosure",
  business_hours: "Business Hours",
  keypad_gate: "Keypad Gate",
  forward_call: "Forward Call",
  whisper: "Whisper",
  voicemail: "Voicemail",
  outcome: "Outcome",
};

export interface FlowNodeDescription {
  title: string;
  detail: string;
}

/** One title and one detail line per node, shared by the canvas, inspector, and Overview. */
export function describeFlowNode(node: FlowNode): FlowNodeDescription {
  const title = nodeTitles[node.type];
  switch (node.type) {
    case "incoming_call":
      return { title, detail: "Caller dials the Tracking Number" };
    case "recording_disclosure":
      return { title, detail: `"${recordingDisclosureText}" · ${node.voice}` };
    case "business_hours": {
      const windows = node.weeklyWindows.map((window) => `${weekdayNames[window.day]} ${window.start}–${window.end}`).join(", ") || "No weekly windows";
      const overrides = node.dateOverrides.length === 0 ? "" : ` · ${node.dateOverrides.length} date override${node.dateOverrides.length === 1 ? "" : "s"}`;
      return { title, detail: `${windows}${overrides}` };
    }
    case "keypad_gate":
      return { title, detail: `Press ${node.digit} within ${node.timeoutSeconds}s · "${node.prompt}"` };
    case "forward_call":
      return { title, detail: `${node.destinationNumber || "No destination"} · rings ${node.timeoutSeconds}s` };
    case "whisper":
      return { title, detail: node.message ? `"${node.message}"` : "No message" };
    case "voicemail":
      return { title, detail: `"${node.greeting}"` };
    case "outcome":
      return { title, detail: node.outcome };
  }
}

/** Node types an Operator can add from the palette, with the hint shown beside each. */
export const flowNodeCatalog: ReadonlyArray<{ type: Exclude<FlowNodeType, "incoming_call">; title: string; hint: string }> = [
  { type: "recording_disclosure", title: nodeTitles.recording_disclosure, hint: "Required when recording; one per flow" },
  { type: "business_hours", title: nodeTitles.business_hours, hint: "Open and Closed branches" },
  { type: "keypad_gate", title: nodeTitles.keypad_gate, hint: "Pass and Blocked branches" },
  { type: "whisper", title: nodeTitles.whisper, hint: "Heard by the business before connecting" },
  { type: "forward_call", title: nodeTitles.forward_call, hint: "Rings the Destination Number" },
  { type: "voicemail", title: nodeTitles.voicemail, hint: "After Closed or Missed" },
  { type: "outcome", title: nodeTitles.outcome, hint: "Ends the Call" },
];

/** A new node of the given type with sensible defaults; position is assigned by the canvas layout. */
export function createFlowNode(type: FlowNodeType, context: { destinationNumber: string }): FlowNode {
  const id = `${type}-${crypto.randomUUID()}`;
  const position = { x: 0, y: 0 };
  switch (type) {
    case "incoming_call":
      return { id, type, position };
    case "recording_disclosure":
      return { id, type, position, voice: "Polly.Joanna" };
    case "business_hours":
      return {
        id,
        type,
        position,
        weeklyWindows: ([1, 2, 3, 4, 5] as const).map((day) => ({ day, start: "09:00", end: "17:00" })),
        dateOverrides: [],
      };
    case "keypad_gate":
      return { id, type, position, prompt: "Press 1 to be connected.", voice: "Polly.Joanna", digit: "1", timeoutSeconds: 10 };
    case "forward_call":
      return { id, type, position, destinationNumber: context.destinationNumber, timeoutSeconds: 30 };
    case "whisper":
      return { id, type, position, message: "", voice: "Polly.Joanna" };
    case "voicemail":
      return { id, type, position, greeting: "Please leave a message after the tone.", voice: "Polly.Joanna" };
    case "outcome":
      return { id, type, position, outcome: "Answered" };
  }
}

export interface FlowTreeBranch {
  handle: EdgeHandle;
  /** The step this branch leads to, or null when the handle is not connected. */
  child: FlowTreeNode | null;
  /** True when the child was already placed under an earlier branch; its own branches are then empty. */
  shared: boolean;
}

export interface FlowTreeNode {
  node: FlowNode;
  branches: FlowTreeBranch[];
}

/**
 * Walks the graph from the Incoming Call in handle order. Each node is expanded
 * once, where it is first reached; later edges to it become shared references,
 * so renderers get a tree even though targets may be reused.
 */
export function callFlowTree(graph: CallFlowGraph): FlowTreeNode | null {
  const byId = nodeById(graph.nodes);
  const expanded = new Set<string>();
  const visit = (node: FlowNode): FlowTreeNode => {
    expanded.add(node.id);
    const branches = nodeHandles[node.type].map((handle): FlowTreeBranch => {
      const edge = graph.edges.find((candidate) => candidate.source === node.id && candidate.sourceHandle === handle);
      const target = edge ? byId.get(edge.target) : undefined;
      if (!target) return { handle, child: null, shared: false };
      if (expanded.has(target.id)) return { handle, child: { node: target, branches: [] }, shared: true };
      return { handle, child: visit(target), shared: false };
    });
    return { node, branches };
  };
  const incoming = graph.nodes.find((node) => node.type === "incoming_call");
  return incoming ? visit(incoming) : null;
}
