/**
 * -------------------------------------------------------------------------
 * @file   activity-view.tsx
 * @brief  Renders the day-grouped Activity timeline of authorized Calls.
 *
 * @description
 *  Shows one timeline entry per Call under Today, Yesterday, or a calendar
 *  date in the result's timezone. Each entry shows the start time, caller
 *  number, Workspace, current or final Call Outcome, effective Lead
 *  classification, and connected duration; its header opens Call Detail
 *  with this Activity URL as the `back` param, and expanding it lists the
 *  steps that occurred with one status Badge each and a neutral pending
 *  step while processing is unfinished. The header counts the Calls in
 *  view and shows how long ago the last successful refresh was. The first
 *  page arrives from the server; caller search and the Activity filters
 *  keep their state in the URL and reload the first page under timeline
 *  Skeletons, and Load more appends the Calls before the oldest entry.
 *
 * @remarks
 *  The view refreshes every 30 seconds while the document is visible,
 *  pauses while it is hidden, and refreshes at once on return when the
 *  last success is 30 seconds old. A refresh rereads every Call through
 *  the oldest loaded entry and merges by Call id, so entries update in
 *  place with stable keys and no positional animation, and older loaded
 *  entries beyond a capped refresh stay. A refresh error keeps every entry
 *  and marks freshness unavailable with an inline Retry, a Load more error
 *  stays inside its own region, and a result for filters that have since
 *  changed is dropped. The entry composition adapts ReUI's c-timeline-6
 *  collapsible pipeline: a node per Call and a stacked Frame whose header
 *  is the expand control.
 *
 * @see
 *  data/activity.ts
 *  data/activity-query.ts
 *  components/tracer/call-filters.tsx
 *  https://reui.io/preview/base/components/c-timeline-6
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import Link from "next/link";
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Badge } from "@/components/reui/badge";
import { Frame, FrameHeader, FramePanel } from "@/components/reui/frame";
import { Timeline, TimelineContent, TimelineHeader, TimelineIndicator, TimelineItem, TimelineSeparator, TimelineTitle } from "@/components/reui/timeline";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import CallFilterToolbar, { callFiltersFromTrees, filterTreesFromCallFilters, type CallFilterTrees } from "@/components/tracer/call-filters";
import CallOutcomeBadge from "@/components/tracer/call-outcome-badge";
import { formatCallDate, formatClock, formatTimeOfDay } from "@/components/tracer/call-format";
import LeadClassificationBadge from "@/components/tracer/lead-classification-badge";
import type { ActivityEntry, ActivityResult, ActivityStep, ActivityStepKind } from "@/data/activity";
import { activitySearchParams, parseActivityCursor } from "@/data/activity-query";
import type { OutcomeKind } from "@/data/call-flow";
import { emptyCallFilters, type CallFilters } from "@/data/call-list-query";
import { callDetailHref } from "@/data/call-source";

type StepBadge = readonly [string, "success-light" | "info-light" | "warning-light" | "destructive-light" | "outline"];

const stepCopy = {
  call_received: ["Call received", ["Received", "info-light"]],
  spam_gate_passed: ["Spam gate passed", ["Passed", "success-light"]],
  spam_gate_failed: ["Spam gate failed", ["Failed", "destructive-light"]],
  forwarding_attempted: ["Forwarding attempted", ["Attempted", "info-light"]],
  call_completed: ["Call completed", ["Completed", "success-light"]],
  recording_transferred: ["Recording transferred", ["Stored", "success-light"]],
  recording_transfer_failed: ["Recording transfer failed", ["Failed", "destructive-light"]],
  recording_pending: ["Recording processing", ["Pending", "outline"]],
  transcript_completed: ["Transcript completed", ["Completed", "success-light"]],
  transcript_skipped: ["Transcript skipped", ["Skipped", "outline"]],
  transcript_failed: ["Transcript failed", ["Failed", "destructive-light"]],
  transcript_expired: ["Transcript expired", ["Expired", "warning-light"]],
  transcript_pending: ["Transcript pending", ["Pending", "outline"]],
  lead_assessment_completed: ["Lead Assessment completed", ["Completed", "success-light"]],
  lead_assessment_failed: ["Lead Assessment failed", ["Failed", "destructive-light"]],
  lead_assessment_pending: ["Lead Assessment pending", ["Pending", "outline"]],
  lead_review_added: ["Lead Review added", ["Added", "success-light"]],
} as const satisfies Record<ActivityStepKind, readonly [string, StepBadge]>;

const outcomeCopy = {
  Answered: "Call answered",
  Voicemail: "Voicemail captured",
  Missed: "Call missed",
  Abandoned: "Call abandoned",
  Blocked: "Call blocked",
  Failed: "Call failed",
} as const satisfies Record<OutcomeKind, string>;

function stepLabel(step: ActivityStep): string {
  if (step.kind === "call_completed" && step.outcome) return outcomeCopy[step.outcome];
  if (step.kind === "lead_review_added" && step.reviewerName) return `Lead Review added by ${step.reviewerName}`;
  return stepCopy[step.kind][0];
}

function stepBadge(step: ActivityStep): ReactNode {
  if (step.kind === "call_completed" && step.outcome) return <CallOutcomeBadge outcome={step.outcome} />;
  if (step.classification) return <LeadClassificationBadge classification={step.classification} automated={step.kind === "lead_assessment_completed"} />;
  const [label, variant] = stepCopy[step.kind][1];
  return <Badge variant={variant}>{label}</Badge>;
}

const refreshIntervalMs = 30_000;

function freshness(lastRefreshedAt: number, now: number): string {
  const minutes = Math.floor((now - lastRefreshedAt) / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  return `Updated ${Math.floor(minutes / 60)} hr ago`;
}

function isOlder(entry: ActivityEntry, than: ActivityEntry): boolean {
  const a = parseActivityCursor(entry.cursor);
  const b = parseActivityCursor(than.cursor);
  if (!a || !b) return false;
  return a.startedAt < b.startedAt || (a.startedAt === b.startedAt && a.id < b.id);
}

function mergeRefresh(current: ActivityEntry[], refreshed: ActivityEntry[]): ActivityEntry[] {
  const oldest = refreshed.at(-1);
  if (!oldest) return [];
  const ids = new Set(refreshed.map((entry) => entry.id));
  return [...refreshed, ...current.filter((entry) => !ids.has(entry.id) && isOlder(entry, oldest))];
}

function appendOlder(current: ActivityEntry[], older: ActivityEntry[]): ActivityEntry[] {
  const ids = new Set(current.map((entry) => entry.id));
  return [...current, ...older.filter((entry) => !ids.has(entry.id))];
}

async function fetchActivity(params: URLSearchParams): Promise<ActivityResult> {
  const search = params.toString();
  const response = await fetch(`/api/activity${search ? `?${search}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Activity unavailable");
  return (await response.json()) as ActivityResult;
}

function callCount(count: number): string {
  return `${count} ${count === 1 ? "Call" : "Calls"} in view`;
}

function calendarDay(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(at));
}

function dayLabel(day: string, timeZone: string): string {
  const now = Date.now();
  if (day === calendarDay(now, timeZone)) return "Today";
  const previous = new Date(`${calendarDay(now, timeZone)}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  if (day === previous.toISOString().slice(0, 10)) return "Yesterday";
  return formatCallDate(`${day}T12:00:00Z`, "UTC");
}

function dayGroups(entries: ActivityEntry[]): { day: string; entries: ActivityEntry[] }[] {
  const groups: { day: string; entries: ActivityEntry[] }[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last?.day === entry.day) last.entries.push(entry);
    else groups.push({ day: entry.day, entries: [entry] });
  }
  return groups;
}

function ActivitySkeletons({ count }: { count: number }) {
  return (
    <Timeline defaultValue={0}>
      {Array.from({ length: count }, (_, index) => (
        <TimelineItem key={index} step={index + 1} className="ms-10 pb-6">
          <TimelineHeader>
            <TimelineSeparator className="group-data-[orientation=vertical]/timeline:-left-7 group-data-[orientation=vertical]/timeline:h-[calc(100%-1.5rem-0.25rem)] group-data-[orientation=vertical]/timeline:translate-y-7" />
            <Skeleton className="h-5 w-56" />
            <TimelineIndicator className="flex size-6 items-center justify-center border-none bg-muted group-data-[orientation=vertical]/timeline:-left-7" />
          </TimelineHeader>
          <TimelineContent className="mt-2">
            <Skeleton className="h-10 w-full" />
          </TimelineContent>
        </TimelineItem>
      ))}
    </Timeline>
  );
}

function ActivityItem({ entry, step, back, timeZone }: { entry: ActivityEntry; step: number; back: string; timeZone: string }) {
  const completed = entry.state === "Completed";
  const effective = entry.effectiveLeadClassification;
  return (
    <TimelineItem step={step} className="ms-10 pb-6">
      <TimelineHeader>
        <TimelineSeparator className="group-data-[orientation=vertical]/timeline:-left-7 group-data-[orientation=vertical]/timeline:h-[calc(100%-1.5rem-0.25rem)] group-data-[orientation=vertical]/timeline:translate-y-7" />
        <div className="flex flex-wrap items-center gap-2">
          <TimelineTitle className="text-sm font-semibold">
            <Link href={callDetailHref({ id: entry.id, workspaceId: entry.workspace.id }, back)} prefetch className="flex flex-wrap items-center gap-2 tabular-nums transition-colors hover:text-muted-foreground">
              <span>{formatTimeOfDay(entry.startedAt, timeZone)}</span>
              <span>{entry.callerNumber ?? "Unknown caller"}</span>
            </Link>
          </TimelineTitle>
          <CallOutcomeBadge outcome={entry.outcome} />
        </div>
        <TimelineIndicator
          className={
            completed
              ? "flex size-6 items-center justify-center border-none bg-primary text-primary-foreground group-data-[orientation=vertical]/timeline:-left-7"
              : "flex size-6 items-center justify-center border-none bg-muted text-muted-foreground ring-2 ring-primary/20 group-data-[orientation=vertical]/timeline:-left-7"
          }
        >
          {completed ? <CheckIcon className="size-3.5" /> : <CircleIcon className="size-3.5" />}
        </TimelineIndicator>
      </TimelineHeader>
      <TimelineContent className="mt-2">
        <Frame stacked dense spacing="sm">
          <Collapsible className="group/collapsible">
            <CollapsibleTrigger className="flex w-full">
              <FrameHeader className="flex grow flex-row items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-muted-foreground">{entry.workspace.name}</span>
                  {effective ? <LeadClassificationBadge classification={effective.classification} automated={effective.source === "assessment"} /> : null}
                  <span className="tabular-nums text-muted-foreground">{entry.connectedDurationSeconds === null ? "-" : formatClock(entry.connectedDurationSeconds)}</span>
                </div>
                <ChevronRightIcon className="size-4 text-muted-foreground transition-transform duration-200 group-data-open/collapsible:rotate-90 motion-reduce:transition-none" />
              </FrameHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <FramePanel>
                <ol className="flex flex-col gap-2">
                  {entry.steps.map((step) => (
                    <li key={step.id} className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="w-20 text-xs tabular-nums text-muted-foreground">{step.occurredAt ? formatTimeOfDay(step.occurredAt, timeZone) : null}</span>
                        <span data-step-label className="text-sm">{stepLabel(step)}</span>
                      </div>
                      {stepBadge(step)}
                    </li>
                  ))}
                </ol>
              </FramePanel>
            </CollapsibleContent>
          </Collapsible>
        </Frame>
      </TimelineContent>
    </TimelineItem>
  );
}

export default function ActivityView({
  initialResult,
  initialFilters,
  workspaceOptions,
}: {
  initialResult: ActivityResult;
  initialFilters: CallFilters;
  workspaceOptions: { id: string; name: string }[];
}) {
  const [result, setResult] = useState<ActivityResult>(initialResult);
  const [filters, setFilters] = useState<CallFilters>(initialFilters);
  const [filterTrees, setFilterTrees] = useState<CallFilterTrees>(() => filterTreesFromCallFilters(initialFilters, { activity: true }));
  const [searchInput, setSearchInput] = useState(initialFilters.search);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [loadMore, setLoadMore] = useState<"idle" | "loading" | "error">("idle");
  const resultRef = useRef(result);
  const lastRefreshedRef = useRef(lastRefreshedAt);
  const generation = useRef(0);
  const filtersChanged = useRef(false);
  const { entries, timeZone } = result;
  const search = activitySearchParams(filters).toString();
  const back = `/activity${search ? `?${search}` : ""}`;

  useEffect(() => {
    resultRef.current = result;
    lastRefreshedRef.current = lastRefreshedAt;
  }, [result, lastRefreshedAt]);

  const markRefreshed = useCallback(() => {
    setLastRefreshedAt(Date.now());
    setNow(Date.now());
    setRefreshError(false);
  }, []);

  const loadFirstPage = useCallback(async () => {
    const id = ++generation.current;
    setLoading(true);
    setListError(false);
    setLoadMore("idle");
    try {
      const body = await fetchActivity(activitySearchParams(filters));
      if (id !== generation.current) return;
      setResult(body);
      markRefreshed();
    } catch {
      if (id === generation.current) setListError(true);
    } finally {
      if (id === generation.current) setLoading(false);
    }
  }, [filters, markRefreshed]);

  const refresh = useCallback(async () => {
    const id = generation.current;
    const params = activitySearchParams(filters);
    const oldest = resultRef.current.entries.at(-1);
    if (oldest) params.set("through", oldest.cursor);
    setRefreshing(true);
    try {
      const body = await fetchActivity(params);
      if (id !== generation.current) return;
      setResult((current) => ({ ...body, entries: mergeRefresh(current.entries, body.entries) }));
      markRefreshed();
    } catch {
      if (id === generation.current) setRefreshError(true);
    } finally {
      setRefreshing(false);
    }
  }, [filters, markRefreshed]);

  async function loadOlder() {
    const id = generation.current;
    const oldest = resultRef.current.entries.at(-1);
    const params = activitySearchParams(filters);
    if (oldest) params.set("before", oldest.cursor);
    setLoadMore("loading");
    try {
      const body = await fetchActivity(params);
      if (id !== generation.current) return;
      setResult((current) => ({ ...current, entries: appendOlder(current.entries, body.entries), hasMore: body.hasMore }));
      setLoadMore("idle");
    } catch {
      if (id === generation.current) setLoadMore("error");
    }
  }

  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      timer = setInterval(() => {
        setNow(Date.now());
        void refreshRef.current();
      }, refreshIntervalMs);
    };
    const changeVisibility = () => {
      if (document.visibilityState !== "visible") return stop();
      setNow(Date.now());
      if (Date.now() - lastRefreshedRef.current >= refreshIntervalMs) void refreshRef.current();
      start();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", changeVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", changeVisibility);
    };
  }, []);

  useEffect(() => {
    if (!filtersChanged.current) return;
    window.history.replaceState(null, "", back);
    const timer = window.setTimeout(() => void loadFirstPage(), 0);
    return () => window.clearTimeout(timer);
  }, [back, loadFirstPage]);

  useEffect(() => {
    const trimmed = searchInput.trim();
    const timer = window.setTimeout(() => changeFilters((current) => (current.search === trimmed ? current : { ...current, search: trimmed })), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  function changeFilters(update: (current: CallFilters) => CallFilters) {
    setFilters((current) => {
      const next = update(current);
      if (next !== current) filtersChanged.current = true;
      return next;
    });
  }

  function changeFilterTrees(trees: CallFilterTrees) {
    setFilterTrees(trees);
    changeFilters((current) => callFiltersFromTrees(trees, current.search));
  }

  function clearFilters() {
    setFilterTrees(filterTreesFromCallFilters(emptyCallFilters, { activity: true }));
    setSearchInput("");
    changeFilters(() => emptyCallFilters);
  }

  const groups = dayGroups(entries);
  const filtered = search !== "";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
          <p className="text-sm text-muted-foreground tabular-nums">{callCount(entries.length)}</p>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground" aria-live="polite">{refreshError ? "Updates unavailable" : freshness(lastRefreshedAt, now)}</p>
          <Button type="button" variant="outline" size="sm" disabled={refreshing || loading} onClick={() => void refresh()}>
            {refreshError ? "Retry" : "Refresh"}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          aria-label="Search caller number"
          placeholder="Search caller number..."
          className="w-full sm:w-64"
        />
        <CallFilterToolbar trees={filterTrees} onTreesChange={changeFilterTrees} workspaceOptions={workspaceOptions} activity />
      </div>
      <div className="flex flex-col gap-6">
        {loading ? (
          groups.length > 0 ? (
            groups.map((group) => (
              <section key={group.day} className="flex flex-col gap-3">
                <h2 className="text-xs font-medium text-muted-foreground">{dayLabel(group.day, timeZone)}</h2>
                <ActivitySkeletons count={Math.min(group.entries.length, 3)} />
              </section>
            ))
          ) : (
            <ActivitySkeletons count={3} />
          )
        ) : listError ? (
          <Frame>
            <FramePanel className="flex flex-col items-center gap-3 py-10 text-center text-sm">
              <p role="alert">Activity is unavailable.</p>
              <Button type="button" variant="outline" onClick={() => void loadFirstPage()}>
                Retry
              </Button>
            </FramePanel>
          </Frame>
        ) : (
          <>
            {entries.length === 0 ? (
              <Frame>
                <FramePanel className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
                  {!result.hasCalls ? (
                    "Call events appear after the first inbound Call."
                  ) : filtered ? (
                    <>
                      <p>No Calls match these filters.</p>
                      <Button type="button" variant="outline" onClick={clearFilters}>
                        Clear Filters
                      </Button>
                    </>
                  ) : (
                    "No Calls in the last 7 days."
                  )}
                </FramePanel>
              </Frame>
            ) : null}
            {groups.map((group) => (
              <section key={group.day} className="flex flex-col gap-3">
                <h2 className="text-xs font-medium text-muted-foreground">{dayLabel(group.day, timeZone)}</h2>
                <Timeline defaultValue={0}>
                  {group.entries.map((entry, index) => (
                    <ActivityItem key={entry.id} entry={entry} step={index + 1} back={back} timeZone={timeZone} />
                  ))}
                </Timeline>
              </section>
            ))}
            {result.hasMore ? (
              <div data-region="load-more" className="flex flex-col gap-3">
                {loadMore === "loading" ? <ActivitySkeletons count={2} /> : null}
                {loadMore === "error" ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <p role="alert" className="text-sm text-muted-foreground">Older Activity is unavailable.</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => void loadOlder()}>
                      Retry
                    </Button>
                  </div>
                ) : (
                  <Button type="button" variant="outline" className="self-start" disabled={loadMore === "loading"} onClick={() => void loadOlder()}>
                    Load more
                  </Button>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
