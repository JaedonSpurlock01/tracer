/**
 * -------------------------------------------------------------------------
 * @file   call-list-query.ts
 * @brief  Parses and writes the Calls page, sort, and filters held in the URL.
 *
 * @description
 *  Reads the page number, the sort column and direction, and the one Calls
 *  filter query from URL search parameters, and writes them back, omitting
 *  the first page, the default Started descending sort, and unset filters so
 *  the plain Calls URL is the default view. The filter query holds the
 *  search text, the Started date range as calendar dates, Workspaces, Call
 *  Outcomes or In Progress, effective Lead classifications or None, the
 *  Lead Score range, Recording availability, analysis status, and the
 *  connected duration range in seconds. Those flat keys are joined by And.
 *  An advanced condition tree built with groups, Or, or a field used twice
 *  travels in the one `adv` param as plain JSON, a group being
 *  `{"combinator":"and"|"or","rules":[...]}` and each rule a condition such
 *  as `{"field":"outcome","values":["Voicemail"]}`,
 *  `{"field":"leadScore","min":40,"max":null}`, or
 *  `{"field":"startedAt","from":"2026-10-01","to":null}`; the tree is
 *  joined to the flat keys by And.
 *
 * @remarks
 *  Sort columns and every enumerated filter are allow-lists, and dates and
 *  numbers must be well formed and in range. Anything else is dropped, so
 *  the server reads exactly what the UI can write; the Calls query binds
 *  each surviving value as a SQL parameter. The calendar dates carry no
 *  timezone because the server resolves them in the scope's timezone. Flat
 *  keys stay the format for a plain And of distinct fields so shared links
 *  keep working. In the tree, each condition's values pass the same checks
 *  as the flat keys and bad values are dropped, then empty conditions and
 *  groups; anything structural (malformed JSON, an unknown field or
 *  combinator, more than three levels, more than 20 conditions and groups,
 *  or more than 4000 characters) rejects the whole tree. Negation is not
 *  part of the format. This module has no server imports so the Calls view
 *  can share it.
 *
 * @see
 *  data/calls.ts
 *  components/tracer/calls-view.tsx
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export const callSortColumns = ["startedAt", "callerNumber", "workspace", "outcome", "connectedDuration", "leadClassification", "leadScore"] as const;

export type CallSortColumn = (typeof callSortColumns)[number];

export interface CallSort {
  column: CallSortColumn;
  direction: "asc" | "desc";
}

export const callOutcomeFilters = ["Answered", "Voicemail", "Missed", "Abandoned", "Blocked", "Failed", "In Progress"] as const;
export const leadClassificationFilters = ["Good Lead", "Not Good Lead", "Uncertain", "None"] as const;
export const recordingAvailabilityFilters = ["Ready", "Processing", "Failed", "Unavailable", "Expired"] as const;
export const analysisStatusFilters = ["Pending", "Completed", "Failed", "Skipped", "Not applicable"] as const;

export type CallOutcomeFilter = (typeof callOutcomeFilters)[number];
export type LeadClassificationFilter = (typeof leadClassificationFilters)[number];
export type RecordingAvailabilityFilter = (typeof recordingAvailabilityFilters)[number];
export type AnalysisStatusFilter = (typeof analysisStatusFilters)[number];

export interface CallFilters {
  search: string;
  startedFrom: string | null;
  startedTo: string | null;
  workspaceIds: string[];
  outcomes: CallOutcomeFilter[];
  leadClassifications: LeadClassificationFilter[];
  leadScoreMin: number | null;
  leadScoreMax: number | null;
  recordingAvailability: RecordingAvailabilityFilter[];
  analysisStatus: AnalysisStatusFilter[];
  connectedSecondsMin: number | null;
  connectedSecondsMax: number | null;
  advanced: CallFilterGroup | null;
}

export type CallFilterCondition =
  | { field: "startedAt"; from: string | null; to: string | null }
  | { field: "workspace"; values: string[] }
  | { field: "outcome"; values: CallOutcomeFilter[] }
  | { field: "leadClassification"; values: LeadClassificationFilter[] }
  | { field: "leadScore"; min: number | null; max: number | null }
  | { field: "recording"; values: RecordingAvailabilityFilter[] }
  | { field: "analysis"; values: AnalysisStatusFilter[] }
  | { field: "connectedDuration"; min: number | null; max: number | null };

export type CallFilterNode = CallFilterCondition | CallFilterGroup;

export interface CallFilterGroup {
  combinator: "and" | "or";
  rules: CallFilterNode[];
}

export interface CallListQuery {
  page: number;
  sort: CallSort;
  filters: CallFilters;
}

export const callPageSize = 25;

export const defaultCallSort: CallSort = { column: "startedAt", direction: "desc" };

export const emptyCallFilters: CallFilters = {
  search: "",
  startedFrom: null,
  startedTo: null,
  workspaceIds: [],
  outcomes: [],
  leadClassifications: [],
  leadScoreMin: null,
  leadScoreMax: null,
  recordingAvailability: [],
  analysisStatus: [],
  connectedSecondsMin: null,
  connectedSecondsMax: null,
  advanced: null,
};

const maxSearchLength = 100;
const maxWorkspaceIds = 100;
const maxWorkspaceIdLength = 128;
const maxAdvancedLength = 4000;

export const maxCallFilterDepth = 3;
export const maxCallFilterNodes = 20;

type SearchParams = URLSearchParams | Readonly<Record<string, string | string[] | undefined>>;

function read(params: SearchParams, name: string): string {
  if (params instanceof URLSearchParams) return params.get(name) ?? "";
  const value = params[name];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function readAll(params: SearchParams, name: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(name);
  const value = params[name];
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function allowed<T extends string>(values: string[], allowList: readonly T[]): T[] {
  return [...new Set(values.filter((value): value is T => (allowList as readonly string[]).includes(value)))];
}

function calendarDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) ? value : null;
}

function wholeNumber(value: string, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  return number <= max ? number : null;
}

function workspaceIdList(values: string[]): string[] {
  return [...new Set(values.filter((id) => id.length > 0 && id.length <= maxWorkspaceIdLength))].slice(0, maxWorkspaceIds);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function scalar(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class InvalidFilterTree extends Error {}

function conditionFromJson(node: Record<string, unknown>): CallFilterCondition | null {
  const values = strings(node.values);
  const range = (max: number) => ({ min: wholeNumber(scalar(node.min), max), max: wholeNumber(scalar(node.max), max) });
  let condition: CallFilterCondition;
  if (node.field === "startedAt") condition = { field: "startedAt", from: calendarDate(scalar(node.from)), to: calendarDate(scalar(node.to)) };
  else if (node.field === "workspace") condition = { field: "workspace", values: workspaceIdList(values) };
  else if (node.field === "outcome") condition = { field: "outcome", values: allowed(values, callOutcomeFilters) };
  else if (node.field === "leadClassification") condition = { field: "leadClassification", values: allowed(values, leadClassificationFilters) };
  else if (node.field === "leadScore") condition = { field: "leadScore", ...range(100) };
  else if (node.field === "recording") condition = { field: "recording", values: allowed(values, recordingAvailabilityFilters) };
  else if (node.field === "analysis") condition = { field: "analysis", values: allowed(values, analysisStatusFilters) };
  else if (node.field === "connectedDuration") condition = { field: "connectedDuration", ...range(Number.MAX_SAFE_INTEGER) };
  else throw new InvalidFilterTree();
  if ("values" in condition) return condition.values.length > 0 ? condition : null;
  if ("from" in condition) return condition.from || condition.to ? condition : null;
  return condition.min !== null || condition.max !== null ? condition : null;
}

function groupFromJson(node: unknown, depth: number, count: { nodes: number }): CallFilterGroup | null {
  if (!isRecord(node) || (node.combinator !== "and" && node.combinator !== "or") || !Array.isArray(node.rules) || depth > maxCallFilterDepth) throw new InvalidFilterTree();
  const rules: CallFilterNode[] = [];
  for (const child of node.rules) {
    count.nodes += 1;
    if (!isRecord(child) || count.nodes > maxCallFilterNodes) throw new InvalidFilterTree();
    const parsed = "rules" in child ? groupFromJson(child, depth + 1, count) : conditionFromJson(child);
    if (parsed) rules.push(parsed);
  }
  return rules.length > 0 ? { combinator: node.combinator, rules } : null;
}

function advancedFromParam(value: string): CallFilterGroup | null {
  if (!value || value.length > maxAdvancedLength) return null;
  try {
    return groupFromJson(JSON.parse(value), 1, { nodes: 0 });
  } catch {
    return null;
  }
}

function callFiltersFromSearchParams(params: SearchParams): CallFilters {
  return {
    search: read(params, "q").trim().slice(0, maxSearchLength),
    startedFrom: calendarDate(read(params, "from")),
    startedTo: calendarDate(read(params, "to")),
    workspaceIds: workspaceIdList(readAll(params, "workspace")),
    outcomes: allowed(readAll(params, "outcome"), callOutcomeFilters),
    leadClassifications: allowed(readAll(params, "classification"), leadClassificationFilters),
    leadScoreMin: wholeNumber(read(params, "scoreMin"), 100),
    leadScoreMax: wholeNumber(read(params, "scoreMax"), 100),
    recordingAvailability: allowed(readAll(params, "recording"), recordingAvailabilityFilters),
    analysisStatus: allowed(readAll(params, "analysis"), analysisStatusFilters),
    connectedSecondsMin: wholeNumber(read(params, "durationMin"), Number.MAX_SAFE_INTEGER),
    connectedSecondsMax: wholeNumber(read(params, "durationMax"), Number.MAX_SAFE_INTEGER),
    advanced: advancedFromParam(read(params, "adv")),
  };
}

function appendCallFilters(params: URLSearchParams, filters: CallFilters): void {
  if (filters.search) params.set("q", filters.search);
  if (filters.startedFrom) params.set("from", filters.startedFrom);
  if (filters.startedTo) params.set("to", filters.startedTo);
  for (const id of filters.workspaceIds) params.append("workspace", id);
  for (const outcome of filters.outcomes) params.append("outcome", outcome);
  for (const classification of filters.leadClassifications) params.append("classification", classification);
  if (filters.leadScoreMin !== null) params.set("scoreMin", String(filters.leadScoreMin));
  if (filters.leadScoreMax !== null) params.set("scoreMax", String(filters.leadScoreMax));
  for (const state of filters.recordingAvailability) params.append("recording", state);
  for (const status of filters.analysisStatus) params.append("analysis", status);
  if (filters.connectedSecondsMin !== null) params.set("durationMin", String(filters.connectedSecondsMin));
  if (filters.connectedSecondsMax !== null) params.set("durationMax", String(filters.connectedSecondsMax));
  if (filters.advanced) params.set("adv", JSON.stringify(filters.advanced));
}

export function flatCallFilterConditions(filters: CallFilters): CallFilterCondition[] {
  const conditions: CallFilterCondition[] = [
    { field: "startedAt", from: filters.startedFrom, to: filters.startedTo },
    { field: "workspace", values: filters.workspaceIds },
    { field: "outcome", values: filters.outcomes },
    { field: "leadClassification", values: filters.leadClassifications },
    { field: "leadScore", min: filters.leadScoreMin, max: filters.leadScoreMax },
    { field: "recording", values: filters.recordingAvailability },
    { field: "analysis", values: filters.analysisStatus },
    { field: "connectedDuration", min: filters.connectedSecondsMin, max: filters.connectedSecondsMax },
  ];
  return conditions.filter((condition) => ("values" in condition ? condition.values.length > 0 : "from" in condition ? condition.from || condition.to : condition.min !== null || condition.max !== null));
}

function isCallSortColumn(value: string): value is CallSortColumn {
  return (callSortColumns as readonly string[]).includes(value);
}

export function callListQueryFromSearchParams(params: SearchParams): CallListQuery {
  const page = Number(read(params, "page"));
  const column = read(params, "sort");
  const order = read(params, "order");
  const sort: CallSort = isCallSortColumn(column) && (order === "asc" || order === "desc") ? { column, direction: order } : defaultCallSort;
  return { page: Number.isInteger(page) && page > 0 ? page : 1, sort, filters: callFiltersFromSearchParams(params) };
}

export function callListSearchParams(query: CallListQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.page > 1) params.set("page", String(query.page));
  if (query.sort.column !== defaultCallSort.column || query.sort.direction !== defaultCallSort.direction) {
    params.set("sort", query.sort.column);
    params.set("order", query.sort.direction);
  }
  appendCallFilters(params, query.filters);
  return params;
}
