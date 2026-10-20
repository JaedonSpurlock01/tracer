/**
 * -------------------------------------------------------------------------
 * @file   report-jobs.tsx
 * @brief  Shares the requester's report and export jobs across the app shell.
 *
 * @description
 *  The provider loads Report history from `GET /api/reports` once when the
 *  shell mounts, so the notification popover can show an in-progress
 *  indicator, and Reports pages, the Generate Report dialog, and the Calls
 *  export confirmations all read and add to the same list. While any job
 *  is Queued or Generating it refetches every 30 seconds, only while the
 *  document is visible; returning to a visible tab refetches at once. With
 *  no job in progress it does not poll, and a view refreshes on demand,
 *  as the popover does when it opens. A job a view requests is added to
 *  the list straight from the request's response. Expiry is judged
 *  against the time of the last successful load, so rendering stays pure. The module also maps the
 *  Reports API error codes to concise messages and names each job's kind,
 *  period, and status for every Reports surface.
 *
 * @remarks
 *  Outside the provider, as in an isolated component test, the hook
 *  answers an empty list whose actions do nothing, so a view renders
 *  without the shell. A failed refresh keeps the jobs already shown. The
 *  history route is cheap enough to poll, as the Reports handler notes.
 *
 * @see
 *  data/reports-handler.ts
 *  components/tracer/report-notifications.tsx
 *  components/tracer/activity-view.tsx
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { formatCallDate } from "@/components/tracer/call-format";
import type { ReportFileKind, ReportJobParameters, ReportJobStatus } from "@/data/report-jobs";

export interface ReportJobItem {
  id: string;
  kind: "report" | "call_export";
  status: ReportJobStatus;
  failureReason: string | null;
  requestedAt: string;
  requestedBy: string;
  scope: Array<{ id: string; name: string | null }>;
  timeZone: string;
  parameters: ReportJobParameters;
  files: Array<{ file: ReportFileKind; downloadable: boolean; href: string | null }>;
  expiresAt: string | null;
  canRegenerate: boolean;
}

export type ReportJobDisplayStatus = ReportJobStatus | "Expired";

export const reportPollIntervalMs = 30_000;

const errorMessages: Record<string, string> = {
  invalid_input: "Check the selections and try again.",
  invalid_period: "Choose a valid date range, with the start on or before the end.",
  invalid_timezone: "Choose a valid document timezone.",
  empty_scope: "Select at least one Workspace.",
  empty_files: "Select at least one file.",
  not_found: "A Workspace in this request is no longer available to you.",
  no_matching_calls: "No matching Calls. Change the Workspaces or period to include Calls.",
  no_recordings: "No retained Recordings match. Change the filters to include Calls with Recordings.",
  export_too_large: "More than 500 retained Recordings match. Narrow the filters and try again.",
  generation_unavailable: "Report generation is not configured yet. Try again later.",
  provider_unavailable: "Report generation is unavailable right now. Try again.",
  not_regenerable: "This job can no longer be regenerated.",
};

export function reportErrorMessage(code: string | null | undefined): string {
  return (code && errorMessages[code]) || "Something went wrong. Try again.";
}

export async function responseErrorCode(response: Response): Promise<string | null> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : null;
}

export function jobInProgress(job: Pick<ReportJobItem, "status">): boolean {
  return job.status === "Queued" || job.status === "Generating";
}

export function jobDisplayStatus(job: ReportJobItem, now: number): ReportJobDisplayStatus {
  if (job.status === "Completed" && job.expiresAt !== null && Date.parse(job.expiresAt) <= now) return "Expired";
  return job.status;
}

export const statusVariants = {
  Queued: "info-light",
  Generating: "info-light",
  Completed: "success-light",
  Failed: "destructive-light",
  Expired: "warning-light",
} as const satisfies Record<ReportJobDisplayStatus, string>;

export const fileLabels: Record<ReportFileKind, string> = { pdf: "PDF", csv: "CSV", zip: "ZIP" };

export function jobKindLabel(job: Pick<ReportJobItem, "kind" | "parameters">): string {
  if (job.kind === "report") return "Report";
  const parameters = job.parameters;
  if ("selection" in parameters && parameters.selection.kind === "call") return "Call export";
  return parameters.files[0] === "zip" ? "Recording export" : "Calls CSV export";
}

export function jobScopeLabel(job: Pick<ReportJobItem, "scope">): string {
  if (job.scope.length === 0) return "No Workspaces";
  return job.scope.map((workspace) => workspace.name ?? "Unavailable Workspace").join(", ");
}

const presetLabels = { previousWeek: "Previous Week", previousMonth: "Previous Month", all: "All Time", custom: "Custom Range" } as const;

function calendarLabel(date: string): string {
  return formatCallDate(`${date}T12:00:00Z`, "UTC");
}

export function jobPeriodLabel(job: Pick<ReportJobItem, "parameters">): string {
  const parameters = job.parameters;
  if ("selection" in parameters) return parameters.selection.kind === "call" ? "Single Call" : "Calls filters";
  const window = parameters.window ? `${calendarLabel(parameters.window.from)} - ${calendarLabel(parameters.window.to)}` : null;
  if (parameters.period.kind === "custom") return window ?? presetLabels.custom;
  return window ? `${presetLabels[parameters.period.kind]}, ${window}` : presetLabels[parameters.period.kind];
}

interface ReportJobsContextValue {
  jobs: ReportJobItem[] | null;
  checkedAt: number;
  failed: boolean;
  refresh: () => Promise<void>;
  addJob: (job: ReportJobItem) => void;
}

const noop = async () => undefined;

const ReportJobsContext = createContext<ReportJobsContextValue | null>(null);

const fallbackContext: ReportJobsContextValue = { jobs: [], checkedAt: 0, failed: false, refresh: noop, addJob: () => undefined };

export function useReportJobs(): ReportJobsContextValue {
  return useContext(ReportJobsContext) ?? fallbackContext;
}

export function ReportJobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<ReportJobItem[] | null>(null);
  const [checkedAt, setCheckedAt] = useState(0);
  const [failed, setFailed] = useState(false);
  const requestId = useRef(0);
  const lastRefreshed = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    lastRefreshed.current = Date.now();
    try {
      const response = await fetch("/api/reports", { cache: "no-store" });
      if (!response.ok) throw new Error("Report history unavailable");
      const body = (await response.json()) as { jobs: ReportJobItem[] };
      if (id !== requestId.current) return;
      setJobs(body.jobs);
      setCheckedAt(Date.now());
      setFailed(false);
    } catch {
      if (id === requestId.current) setFailed(true);
    }
  }, []);

  const addJob = useCallback((job: ReportJobItem) => {
    setJobs((current) => [job, ...(current ?? []).filter((existing) => existing.id !== job.id)]);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const active = jobs?.some(jobInProgress) ?? false;

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      timer = setInterval(() => void refresh(), reportPollIntervalMs);
    };
    const changeVisibility = () => {
      if (document.visibilityState !== "visible") return stop();
      if (Date.now() - lastRefreshed.current >= reportPollIntervalMs) void refresh();
      start();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", changeVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", changeVisibility);
    };
  }, [active, refresh]);

  const value = useMemo(() => ({ jobs, checkedAt, failed, refresh, addJob }), [jobs, checkedAt, failed, refresh, addJob]);
  return <ReportJobsContext.Provider value={value}>{children}</ReportJobsContext.Provider>;
}
