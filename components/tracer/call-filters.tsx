/**
 * -------------------------------------------------------------------------
 * @file   call-filters.tsx
 * @brief  Renders the Calls search box, basic filters, and advanced filters.
 *
 * @description
 *  Edits the Calls filter query with two ReUI Filters trees. The toolbar
 *  chip row holds the basic filters (Started date range, Workspace on
 *  global Calls only, Call Outcome, and Effective Lead Classification) as
 *  a flat And with one chip per field. The advanced popover offers every
 *  filter, Lead Score, Recording Availability, Analysis Status, and
 *  Connected Duration included, and builds a tree with And or Or, nested
 *  groups, and a field used more than once. The chip row and the popover
 *  are joined by And, and both compile into the URL filter query the Calls
 *  endpoint reads.
 *
 * @remarks
 *  A popover tree that is a plain And of fields the chip row does not use
 *  compiles to the flat URL keys, so simple links keep their old shape;
 *  anything else becomes the advanced tree. The veto point refuses
 *  negation everywhere, groups, Or, and repeated fields in the chip row,
 *  and popover trees beyond the server's depth and size bounds. Unfinished
 *  rules and empty groups stay in the tree but never reach the query.
 *  Activity uses the chip row alone with Processing State, the Calls
 *  analysis status, added to the basic fields and no advanced popover, so
 *  it edits the same filter query with only the fields Activity offers.
 *  Dates are calendar days; the server resolves them in the scope's
 *  timezone. The date range editor follows ReUI's c-filters-5 composition,
 *  since Filters ships no date editor.
 *
 * @see
 *  components/tracer/calls-view.tsx
 *  data/call-list-query.ts
 *  https://reui.io/preview/base/components/c-filters-5
 *  https://reui.io/preview/base/components/c-filters-10
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { CalendarRangeIcon } from "lucide-react";

import { Filters } from "@/components/reui/filters/filters";
import { formatFilterDate, resolveFilterDate, toFilterDateValue, type FilterDateValue } from "@/components/reui/filters/filters-date";
import { createFilterGroup, createFilterRule, flattenFilterRules, isFilterGroup, isFilterRuleComplete } from "@/components/reui/filters/filters-query";
import type { FilterEditorProps, FilterField, FilterGroupNode, FilterLabels, FilterOperator, FilterQuery, FilterRule } from "@/components/reui/filters/filters-types";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  analysisStatusFilters,
  callOutcomeFilters,
  emptyCallFilters,
  flatCallFilterConditions,
  leadClassificationFilters,
  maxCallFilterDepth,
  maxCallFilterNodes,
  type AnalysisStatusFilter,
  type CallFilterCondition,
  type CallFilterGroup,
  type CallFilterNode,
  type CallFilters,
  type CallOutcomeFilter,
  type LeadClassificationFilter,
  type RecordingAvailabilityFilter,
} from "@/data/call-list-query";

type DateRange = [FilterDateValue | undefined, FilterDateValue | undefined];
type NumberRange = [number | undefined, number | undefined];

const anyOf: FilterOperator[] = [{ value: "is_any_of", label: "is any of", arity: "many" }];
const dateRange: FilterOperator[] = [{ value: "between", label: "is between", arity: "range" }];
const numberRange: FilterOperator[] = [
  { value: "between", label: "is between", arity: "range" },
  { value: "gte", label: "is at least" },
  { value: "lte", label: "is at most" },
];

const recordingOptions = [
  { value: "Ready", label: "Available" },
  { value: "Processing", label: "Processing" },
  { value: "Failed", label: "Failed" },
  { value: "Unavailable", label: "Not available" },
  { value: "Purged", label: "Purged" },
  { value: "Expired", label: "Expired" },
];

const basicFieldIds = new Set(["startedAt", "workspace", "outcome", "leadClassification"]);
const activityFieldIds = new Set([...basicFieldIds, "analysis"]);

const processingField: FilterField = { id: "analysis", label: "Processing State", type: "select", operators: anyOf, options: analysisStatusFilters.map((status) => ({ value: status, label: status })) };

const labels: Partial<FilterLabels> = { addFilter: "Add Filter", addCondition: "Add Filter", advancedFilter: "Advanced Filters" };

const DAY_GRID = "p-0 [--cell-size:--spacing(7)] [&_.rdp-month]:gap-2 [&_tbody_tr]:mt-1";

function DateRangeEditor({ value, onValueChange, commit, cancel, autoFocusProps, labels }: FilterEditorProps<DateRange>) {
  const tuple = Array.isArray(value) ? value : undefined;
  const from = resolveFilterDate(tuple?.[0]) ?? undefined;
  const to = resolveFilterDate(tuple?.[1]) ?? undefined;
  return (
    <div className="flex flex-col gap-2 p-2" {...autoFocusProps} tabIndex={-1}>
      <Calendar
        mode="range"
        numberOfMonths={2}
        className={DAY_GRID}
        selected={{ from, to }}
        defaultMonth={from}
        onSelect={(range) => {
          if (!range?.from) return;
          onValueChange([toFilterDateValue(range.from), toFilterDateValue(range.to ?? range.from)]);
        }}
      />
      <div className="-mx-2 flex items-center justify-end gap-1.5 border-t px-2 pt-2">
        <Button type="button" variant="ghost" size="sm" onClick={cancel}>
          {labels.discard}
        </Button>
        <Button type="button" size="sm" disabled={!tuple?.[0]} onClick={() => commit()}>
          {labels.apply}
        </Button>
      </div>
    </div>
  );
}

function dateRangeText(value: unknown, valueRange: (from: string, to: string) => string): string {
  const [from, to] = (Array.isArray(value) ? value : []) as DateRange;
  return valueRange(formatFilterDate(from) || "any day", formatFilterDate(to) || "any day");
}

function wholeNumberCheck(max: number) {
  return ({ value }: { value: unknown }) => {
    const values = (Array.isArray(value) ? value : [value]).filter((entry) => entry !== undefined);
    return values.every((entry) => Number.isInteger(entry) && (entry as number) >= 0 && (entry as number) <= max)
      ? null
      : max === 100 ? "Use whole numbers from 0 to 100" : "Use whole seconds";
  };
}

function basicFields(workspaceOptions: { id: string; name: string }[] | undefined): FilterField[] {
  return [
    {
      id: "startedAt",
      label: "Started",
      icon: <CalendarRangeIcon />,
      operators: dateRange,
      editor: DateRangeEditor as FilterField["editor"],
      renderValue: ({ value, labels }) => dateRangeText(value, labels.valueRange),
      valueText: ({ value, labels }) => dateRangeText(value, labels.valueRange),
    },
    ...(workspaceOptions
      ? [{ id: "workspace", label: "Workspace", type: "select" as const, operators: anyOf, options: workspaceOptions.map((workspace) => ({ value: workspace.id, label: workspace.name })) }]
      : []),
    { id: "outcome", label: "Call Outcome", type: "select", operators: anyOf, options: callOutcomeFilters.map((outcome) => ({ value: outcome, label: outcome })) },
    {
      id: "leadClassification",
      label: "Effective Lead Classification",
      type: "select",
      operators: anyOf,
      options: leadClassificationFilters.map((classification) => ({ value: classification, label: classification })),
    },
  ];
}

const advancedFields: FilterField[] = [
  { id: "leadScore", label: "Lead Score", type: "range", operators: numberRange, validate: wholeNumberCheck(100) },
  { id: "recording", label: "Recording Availability", type: "select", operators: anyOf, options: recordingOptions },
  { id: "analysis", label: "Analysis Status", type: "select", operators: anyOf, options: analysisStatusFilters.map((status) => ({ value: status, label: status })) },
  { id: "connectedDuration", label: "Connected Duration (seconds)", type: "range", operators: numberRange, validate: wholeNumberCheck(Number.MAX_SAFE_INTEGER) },
];

export interface CallFilterTrees {
  basic: FilterQuery;
  advanced: FilterQuery;
}

function ruleFromCondition(condition: CallFilterCondition, id: string): FilterRule {
  const path = [condition.field];
  if (condition.field === "startedAt") {
    return createFilterRule({ id, path, operator: "between", value: [condition.from ? { date: condition.from } : undefined, condition.to ? { date: condition.to } : undefined] });
  }
  if ("values" in condition) return createFilterRule({ id, path, operator: "is_any_of", value: [...condition.values] });
  if (condition.min !== null && condition.max !== null) return createFilterRule({ id, path, operator: "between", value: [condition.min, condition.max] });
  return condition.min !== null ? createFilterRule({ id, path, operator: "gte", value: condition.min }) : createFilterRule({ id, path, operator: "lte", value: condition.max });
}

function queryFromGroup(group: CallFilterGroup, id: string): FilterGroupNode {
  return createFilterGroup({
    id,
    combinator: group.combinator,
    rules: group.rules.map((node, index) => ("rules" in node ? queryFromGroup(node, `${id}-${index}`) : ruleFromCondition(node, `${id}-${index}`))),
  });
}

export function filterTreesFromCallFilters(filters: CallFilters, options: { activity?: boolean } = {}): CallFilterTrees {
  const basicIds = options.activity ? activityFieldIds : basicFieldIds;
  const flat = flatCallFilterConditions(filters);
  const advancedFlat = flat.filter((condition) => !basicIds.has(condition.field));
  const tree = filters.advanced;
  const advanced: CallFilterGroup = !tree
    ? { combinator: "and", rules: advancedFlat }
    : advancedFlat.length === 0
      ? tree
      : { combinator: "and", rules: [...advancedFlat, ...(tree.combinator === "and" ? tree.rules : [tree])] };
  return {
    basic: queryFromGroup({ combinator: "and", rules: flat.filter((condition) => basicIds.has(condition.field)) }, "root"),
    advanced: queryFromGroup(advanced, "root"),
  };
}

function bounds(operator: string, values: unknown[], max: number): [number | null, number | null] {
  const valid = (value: unknown) => (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max ? (value as number) : null);
  if (operator === "gte") return [valid(values[0]), null];
  if (operator === "lte") return [null, valid(values[0])];
  const [min, upper] = values as NumberRange;
  return [valid(min), valid(upper)];
}

function calendarDay(value: unknown): string | null {
  const date = (value as FilterDateValue | undefined)?.date;
  return typeof date === "string" ? date : null;
}

function conditionFromRule(rule: FilterRule): CallFilterCondition | null {
  if (!isFilterRuleComplete(rule)) return null;
  const values = rule.value === undefined || rule.value === null ? [] : Array.isArray(rule.value) ? (rule.value as unknown[]) : [rule.value];
  const strings = values.filter((value): value is string => typeof value === "string");
  const field = rule.path[0];
  let condition: CallFilterCondition;
  if (field === "startedAt") condition = { field, from: calendarDay(values[0]), to: calendarDay(values[1]) };
  else if (field === "workspace") condition = { field, values: strings };
  else if (field === "outcome") condition = { field, values: strings as CallOutcomeFilter[] };
  else if (field === "leadClassification") condition = { field, values: strings as LeadClassificationFilter[] };
  else if (field === "recording") condition = { field, values: strings as RecordingAvailabilityFilter[] };
  else if (field === "analysis") condition = { field, values: strings as AnalysisStatusFilter[] };
  else if (field === "leadScore" || field === "connectedDuration") {
    const [min, max] = bounds(rule.operator, values, field === "leadScore" ? 100 : Number.MAX_SAFE_INTEGER);
    condition = { field, min, max };
  } else return null;
  if ("values" in condition) return condition.values.length > 0 ? condition : null;
  if ("from" in condition) return condition.from || condition.to ? condition : null;
  return condition.min !== null || condition.max !== null ? condition : null;
}

function groupFromQuery(group: FilterGroupNode): CallFilterGroup | null {
  const rules = group.rules
    .map((node) => (isFilterGroup(node) ? groupFromQuery(node) : conditionFromRule(node)))
    .filter((node): node is CallFilterNode => node !== null);
  return rules.length > 0 ? { combinator: group.combinator, rules } : null;
}

function isCondition(node: CallFilterNode): node is CallFilterCondition {
  return !("rules" in node);
}

function callFiltersFromConditions(conditions: CallFilterCondition[], search: string): CallFilters {
  const filters: CallFilters = { ...emptyCallFilters, search };
  for (const condition of conditions) {
    if (condition.field === "startedAt") [filters.startedFrom, filters.startedTo] = [condition.from, condition.to];
    if (condition.field === "workspace") filters.workspaceIds = condition.values;
    if (condition.field === "outcome") filters.outcomes = condition.values;
    if (condition.field === "leadClassification") filters.leadClassifications = condition.values;
    if (condition.field === "recording") filters.recordingAvailability = condition.values;
    if (condition.field === "analysis") filters.analysisStatus = condition.values;
    if (condition.field === "leadScore") [filters.leadScoreMin, filters.leadScoreMax] = [condition.min, condition.max];
    if (condition.field === "connectedDuration") [filters.connectedSecondsMin, filters.connectedSecondsMax] = [condition.min, condition.max];
  }
  return filters;
}

export function callFiltersFromTrees(trees: CallFilterTrees, search: string): CallFilters {
  const basic = trees.basic.rules.map((node) => (isFilterGroup(node) ? null : conditionFromRule(node))).filter((condition): condition is CallFilterCondition => condition !== null);
  const advanced = groupFromQuery(trees.advanced);
  const advancedConditions = advanced?.rules.filter(isCondition) ?? [];
  const fields = [...basic, ...advancedConditions].map((condition) => condition.field);
  const flat = !advanced || (advanced.combinator === "and" && advancedConditions.length === advanced.rules.length && new Set(fields).size === fields.length);
  return { ...callFiltersFromConditions(flat ? [...basic, ...advancedConditions] : basic, search), advanced: flat ? null : advanced };
}

function fitsBounds(group: FilterGroupNode, depth = 1, count = { nodes: 0 }): boolean {
  if (depth > maxCallFilterDepth) return false;
  return group.rules.every((node) => {
    count.nodes += 1;
    return count.nodes <= maxCallFilterNodes && (!isFilterGroup(node) || fitsBounds(node, depth + 1, count));
  });
}

function isFlatConjunction(tree: FilterQuery): boolean {
  if (tree.combinator !== "and" || tree.rules.some(isFilterGroup)) return false;
  const fields = flattenFilterRules(tree).map((rule) => rule.path[0]);
  return new Set(fields).size === fields.length;
}

export default function CallFilterToolbar({
  trees,
  onTreesChange,
  workspaceOptions,
  activity = false,
}: {
  trees: CallFilterTrees;
  onTreesChange: (trees: CallFilterTrees) => void;
  workspaceOptions?: { id: string; name: string }[];
  activity?: boolean;
}) {
  const acceptBasic = (next: FilterQuery, details: { reason: string }) => details.reason !== "negate" && isFlatConjunction(next);
  const acceptAdvanced = (next: FilterQuery, details: { reason: string }) => details.reason !== "negate" && fitsBounds(next);

  if (activity) {
    return (
      <Filters
        size="sm"
        fields={[...basicFields(workspaceOptions), processingField]}
        labels={labels}
        query={trees.basic}
        onBeforeQueryChange={acceptBasic}
        onQueryChange={(basic) => onTreesChange({ ...trees, basic })}
      />
    );
  }

  return (
    <>
      <Filters
        size="sm"
        fields={basicFields(workspaceOptions)}
        labels={labels}
        query={trees.basic}
        onBeforeQueryChange={acceptBasic}
        onQueryChange={(basic) => onTreesChange({ ...trees, basic })}
      />
      <Filters
        size="sm"
        variant="advanced"
        advancedMode="popover"
        advancedAlign="end"
        fields={[...basicFields(workspaceOptions), ...advancedFields]}
        labels={labels}
        query={trees.advanced}
        onBeforeQueryChange={acceptAdvanced}
        onQueryChange={(advanced) => onTreesChange({ ...trees, advanced })}
      />
    </>
  );
}
