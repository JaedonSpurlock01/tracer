/**
 * -------------------------------------------------------------------------
 * @file   reports-view.tsx
 * @brief  Renders the Reports page and the Workspace Reports tab.
 *
 * @description
 *  A Frame-led page with the Reports header and Generate Report, then the
 *  requester's report history in a Data Grid with the DESIGN columns:
 *  Requested, Requested By, Scope, Period, Files, Status, Expires, and row
 *  actions. Rows offer Download for each completed file, Regenerate when
 *  the server allows it, named Retry for a Failed job, and View
 *  Parameters, which shows the stored scope, timezone, period or Calls
 *  filters, and files readably. History shows Skeleton rows while it
 *  loads, an Empty state explaining on-demand generation with Generate
 *  Report, an inline Retry when it fails to load, Generating rows that
 *  never block the page, a Failed row's concise reason, and Expired rows
 *  kept during metadata retention. Workspace Reports fixes the Generate
 *  Report scope to its Workspace and reporting timezone, keeps the
 *  Workspace tabs, and lists only jobs whose scope covers that Workspace.
 *
 * @remarks
 *  History comes from the shared jobs provider, which this view refreshes
 *  on mount and which polls while a job is Queued or Generating, so the
 *  popover and the grid always agree. Report history also lists Calls
 *  exports, because the API returns every job the requester made. A
 *  regenerated job is added from its response. Times use the scope's
 *  timezone: the account's on global Reports and the Workspace's on
 *  Workspace Reports.
 *
 * @see
 *  components/tracer/report-jobs.tsx
 *  components/tracer/generate-report-dialog.tsx
 *  data/reports-handler.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTable, type ColumnDef, type PaginationState } from "@tanstack/react-table";

import { Badge } from "@/components/reui/badge";
import { DataGrid, dataGridFeatures, type DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { Frame, FramePanel } from "@/components/reui/frame";
import { EmptyState } from "@/components/tracer/empty-state";
import { NoReportsArt } from "@/components/tracer/line-art";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCallDate, formatCallTime } from "@/components/tracer/call-format";
import { GenerateReportDialog, type GenerateReportScope } from "@/components/tracer/generate-report-dialog";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import {
  fileLabels,
  jobDisplayStatus,
  jobKindLabel,
  jobPeriodLabel,
  jobScopeLabel,
  reportErrorMessage,
  responseErrorCode,
  statusVariants,
  useReportJobs,
  type ReportJobItem,
} from "@/components/tracer/report-jobs";
import WorkspaceTabs from "@/components/tracer/workspace-tabs";
import type { CallFilters } from "@/data/call-list-query";

const pageSize = 25;

function calendarLabel(date: string): string {
  return formatCallDate(`${date}T12:00:00Z`, "UTC");
}

function rangeLabel(from: string | number | null, to: string | number | null, format: (value: string | number) => string = String): string {
  if (from !== null && to !== null) return `${format(from)} - ${format(to)}`;
  return from !== null ? `from ${format(from)}` : `through ${format(to ?? "")}`;
}

function filterLines(filters: CallFilters, names: Map<string, string | null>): string[] {
  const lines: string[] = [];
  if (filters.search) lines.push(`Search: ${filters.search}`);
  if (filters.startedFrom || filters.startedTo) lines.push(`Started: ${rangeLabel(filters.startedFrom, filters.startedTo, (value) => calendarLabel(String(value)))}`);
  if (filters.workspaceIds.length) lines.push(`Workspace: ${filters.workspaceIds.map((id) => names.get(id) ?? "Unavailable Workspace").join(", ")}`);
  if (filters.outcomes.length) lines.push(`Call Outcome: ${filters.outcomes.join(", ")}`);
  if (filters.leadClassifications.length) lines.push(`Effective Lead Classification: ${filters.leadClassifications.join(", ")}`);
  if (filters.leadScoreMin !== null || filters.leadScoreMax !== null) lines.push(`Lead Score: ${rangeLabel(filters.leadScoreMin, filters.leadScoreMax)}`);
  if (filters.recordingAvailability.length) lines.push(`Recording Availability: ${filters.recordingAvailability.join(", ")}`);
  if (filters.analysisStatus.length) lines.push(`Analysis: ${filters.analysisStatus.join(", ")}`);
  if (filters.connectedSecondsMin !== null || filters.connectedSecondsMax !== null) lines.push(`Connected Duration seconds: ${rangeLabel(filters.connectedSecondsMin, filters.connectedSecondsMax)}`);
  if (filters.advanced) lines.push(`Advanced conditions: ${filters.advanced.rules.length} matched with ${filters.advanced.combinator.toUpperCase()}`);
  return lines.length ? lines : ["All Calls in scope"];
}

function ParameterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function ParametersDialog({ job, timeZone, checkedAt, onClose }: { job: ReportJobItem | null; timeZone: string; checkedAt: number; onClose: () => void }) {
  const parameters = job?.parameters;
  const names = new Map(job?.scope.map(({ id, name }) => [id, name]) ?? []);
  return (
    <Dialog open={job !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{job ? `${jobKindLabel(job)} parameters` : "Parameters"}</DialogTitle>
          <DialogDescription>What this job was requested to cover.</DialogDescription>
        </DialogHeader>
        {job && parameters ? (
          <dl className="flex flex-col gap-2">
            <ParameterRow label="Requested">
              <span className="tabular-nums">{formatCallTime(job.requestedAt, timeZone)}</span>
            </ParameterRow>
            <ParameterRow label="Requested By">{job.requestedBy}</ParameterRow>
            <ParameterRow label="Workspaces">{jobScopeLabel(job)}</ParameterRow>
            <ParameterRow label="Timezone">{job.timeZone}</ParameterRow>
            {"selection" in parameters ? (
              parameters.selection.kind === "call" ? (
                <ParameterRow label="Call">
                  {job.scope[0] ? (
                    <Link href={`/workspaces/${job.scope[0].id}/calls/${parameters.selection.callId}`} className="font-medium transition-colors hover:text-muted-foreground">
                      Open Call
                    </Link>
                  ) : (
                    "Single Call"
                  )}
                </ParameterRow>
              ) : (
                <ParameterRow label="Calls filters">
                  <ul className="flex flex-col gap-0.5">
                    {filterLines(parameters.selection.filters, names).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </ParameterRow>
              )
            ) : (
              <ParameterRow label="Period">{jobPeriodLabel(job)}</ParameterRow>
            )}
            <ParameterRow label="Files">{parameters.files.map((file) => fileLabels[file]).join(", ")}</ParameterRow>
            <ParameterRow label="Status">{jobDisplayStatus(job, checkedAt)}</ParameterRow>
            {job.failureReason ? <ParameterRow label="Failure">{job.failureReason}</ParameterRow> : null}
          </dl>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default function ReportsView({ scope, operator = false }: { scope: GenerateReportScope; operator?: boolean }) {
  const { jobs, checkedAt, failed, refresh, addJob } = useReportJobs();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [parametersJob, setParametersJob] = useState<ReportJobItem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize });
  const workspace = scope.kind === "workspace" ? scope.workspace : null;
  const timeZone = workspace ? workspace.reportingTimezone : scope.kind === "global" ? scope.accountTimeZone : "UTC";

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const rows = useMemo(() => (jobs ?? []).filter((job) => !workspace || job.scope.some(({ id }) => id === workspace.id)), [jobs, workspace]);

  const columns = useMemo<ColumnDef<DataGridFeatures, ReportJobItem>[]>(() => {
    async function regenerate(job: ReportJobItem) {
      setActionError(null);
      setRegenerating(job.id);
      try {
        const response = await mutationFetch(`/api/reports/${job.id}/regenerate`, { method: "POST" });
        if (!response.ok) {
          setActionError(reportErrorMessage(await responseErrorCode(response)));
          return;
        }
        addJob(((await response.json()) as { job: ReportJobItem }).job);
      } catch {
        setActionError(reportErrorMessage(null));
      } finally {
        setRegenerating(null);
      }
    }

    return [
      {
        id: "requested",
        header: "Requested",
        cell: ({ row }) => <span className="tabular-nums">{formatCallTime(row.original.requestedAt, timeZone)}</span>,
        size: 200,
        meta: { skeleton: <Skeleton className="h-4 w-40" /> },
      },
      { id: "requestedBy", header: "Requested By", cell: ({ row }) => row.original.requestedBy, size: 160, meta: { skeleton: <Skeleton className="h-4 w-28" /> } },
      { id: "scope", header: "Scope", cell: ({ row }) => jobScopeLabel(row.original), size: 200, meta: { skeleton: <Skeleton className="h-4 w-32" /> } },
      {
        id: "period",
        header: "Period",
        cell: ({ row }) => <span className="tabular-nums">{jobPeriodLabel(row.original)}</span>,
        size: 280,
        meta: { skeleton: <Skeleton className="h-4 w-48" /> },
      },
      {
        id: "files",
        header: "Files",
        cell: ({ row }) => row.original.files.map(({ file }) => fileLabels[file]).join(", "),
        size: 100,
        meta: { skeleton: <Skeleton className="h-4 w-16" /> },
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const status = jobDisplayStatus(row.original, checkedAt);
          return (
            <div className="flex flex-col items-start gap-1">
              <Badge variant={statusVariants[status]}>{status}</Badge>
              {status === "Failed" && row.original.failureReason ? <span className="text-xs text-muted-foreground">{row.original.failureReason}</span> : null}
            </div>
          );
        },
        size: 200,
        meta: { skeleton: <Skeleton className="h-5 w-20" /> },
      },
      {
        id: "expires",
        header: "Expires",
        cell: ({ row }) => <span className="tabular-nums">{row.original.expiresAt ? formatCallDate(row.original.expiresAt, timeZone) : "-"}</span>,
        size: 130,
        meta: { skeleton: <Skeleton className="h-4 w-24" /> },
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            {row.original.files.map((file) =>
              file.downloadable && file.href ? (
                <a key={file.file} className={buttonVariants({ variant: "ghost", size: "sm" })} href={file.href} download>
                  Download {fileLabels[file.file]}
                </a>
              ) : null,
            )}
            {row.original.canRegenerate ? (
              <Button type="button" variant="ghost" size="sm" disabled={regenerating === row.original.id} onClick={() => void regenerate(row.original)}>
                {row.original.status === "Failed" ? "Retry" : "Regenerate"}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" onClick={() => setParametersJob(row.original)}>
              View Parameters
            </Button>
          </div>
        ),
        size: 380,
        meta: { skeleton: <Skeleton className="h-8 w-40" /> },
      },
    ];
  }, [addJob, checkedAt, regenerating, timeZone]);

  const table = useTable({
    features: dataGridFeatures,
    data: rows,
    columns,
    getRowId: (row) => row.id,
    state: { pagination },
    onPaginationChange: setPagination,
  });

  const loading = jobs === null && !failed;
  const emptyMessage = jobs === null && failed ? (
    <div className="flex flex-col items-center gap-3">
      <p role="alert">Report history is unavailable.</p>
      <Button type="button" variant="outline" onClick={() => void refresh()}>
        Retry
      </Button>
    </div>
  ) : (
    <EmptyState
      art={<NoReportsArt />}
      title="No Reports yet"
      description="Reports generate on demand from your Calls. Generate one to see it here."
      action={
        <Button type="button" variant="outline" onClick={() => setGenerateOpen(true)}>
          Generate Report
        </Button>
      }
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">
            {workspace ? `Reports and exports covering ${workspace.name}.` : "Reports and exports you requested. Files stay downloadable for 7 days."}
          </p>
        </div>
        <Button type="button" onClick={() => setGenerateOpen(true)}>
          Generate Report
        </Button>
      </div>
      {workspace ? <WorkspaceTabs workspaceId={workspace.id} operator={operator} current="reports" /> : null}
      <Frame>
        <FramePanel className="flex flex-col gap-4">
          {actionError ? (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          ) : null}
          <DataGrid table={table} recordCount={rows.length} isLoading={loading} emptyMessage={emptyMessage}>
            <DataGridScrollArea orientation="horizontal">
              <DataGridTable />
            </DataGridScrollArea>
            {rows.length > pageSize ? <DataGridPagination sizes={[pageSize]} /> : null}
          </DataGrid>
        </FramePanel>
      </Frame>
      <GenerateReportDialog scope={scope} open={generateOpen} onOpenChange={setGenerateOpen} />
      <ParametersDialog job={parametersJob} timeZone={timeZone} checkedAt={checkedAt} onClose={() => setParametersJob(null)} />
    </div>
  );
}
