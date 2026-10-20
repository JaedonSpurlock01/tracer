/**
 * -------------------------------------------------------------------------
 * @file   calls-view.tsx
 * @brief  Renders the server-backed Calls Data Grid.
 *
 * @description
 *  Shows one page of Calls with Started, Caller, Workspace, Call Outcome,
 *  Connected Duration, Effective Lead Classification, Lead Score, Recording
 *  Availability, and row actions. The first page arrives from the server;
 *  searching, filtering, sorting, and paging fetch the next page from the
 *  Calls endpoint, keep the page, sort, search, and filters in the URL, and
 *  show Skeleton rows while it loads. Any search or filter change returns
 *  to the first page. Rows open Call Detail, and Play Recording opens it
 *  with playback started; both carry this list's URL as the `back` param so
 *  Call Detail can return to it and step through it. Download MP3 appears
 *  only when the row's Recording has a retained MP3 and downloads it
 *  through the Workspace-authorized MP3 route. Workspace Calls fixes the
 *  Workspace scope, omits
 *  the Workspace column and filter, and shows the Workspace tabs below the
 *  header.
 *
 * @remarks
 *  Export Recordings and Export CSV confirm and export the current scope
 *  and the filters in the URL.
 *  The Empty and fetch error states render inside the grid so the header
 *  actions and toolbar stay in place. A scope with no Calls explains where
 *  Calls come from, while filters that match nothing keep the filters and
 *  offer Clear Filters. Search waits for typing to settle before fetching. Dates use the timezone the server names for the
 *  scope: the user's for global Calls and the Workspace's for Workspace
 *  Calls. Clicking Started while it sorts descending flips it to ascending
 *  instead of clearing to the same default.
 *
 * @see
 *  data/calls.ts
 *  data/call-list-query.ts
 *  components/tracer/call-filters.tsx
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTable, type ColumnDef, type PaginationState, type SortingState, type Updater } from "@tanstack/react-table";

import { Badge } from "@/components/reui/badge";
import { DataGrid, dataGridFeatures, type DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { Frame, FramePanel } from "@/components/reui/frame";
import { EmptyState } from "@/components/tracer/empty-state";
import { NoCallsArt, NoResultsArt } from "@/components/tracer/line-art";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CallsExportActions } from "@/components/tracer/call-export";
import CallFilterToolbar, { callFiltersFromTrees, filterTreesFromCallFilters, type CallFilterTrees } from "@/components/tracer/call-filters";
import CallOutcomeBadge from "@/components/tracer/call-outcome-badge";
import { formatCallTime, formatClock } from "@/components/tracer/call-format";
import LeadClassificationBadge from "@/components/tracer/lead-classification-badge";
import WorkspaceTabs from "@/components/tracer/workspace-tabs";
import { callListSearchParams, callPageSize, defaultCallSort, emptyCallFilters, type CallListQuery, type CallSort, type CallSortColumn } from "@/data/call-list-query";
import { callDetailHref } from "@/data/call-source";
import type { CallListItem, CallListResult } from "@/data/calls";

const recordingBadges = {
  Ready: ["Available", "success-light"],
  Processing: ["Processing", "info-light"],
  Failed: ["Failed", "destructive-light"],
  Unavailable: ["Not available", "outline"],
  Purged: ["Purged", "warning-light"],
  Expired: ["Expired", "warning-light"],
} as const satisfies Record<CallListItem["recording"], readonly [string, string]>;

function callHref(call: CallListItem, back: string, options?: { play?: boolean }): string {
  return callDetailHref({ id: call.id, workspaceId: call.workspace.id }, back, options);
}

function callCount(total: number): string {
  return `${total} ${total === 1 ? "Call" : "Calls"}`;
}

function nextSort(current: CallSort, sorting: SortingState): CallSort {
  const [first] = sorting;
  if (first) return { column: first.id as CallSortColumn, direction: first.desc ? "desc" : "asc" };
  return current.column === defaultCallSort.column && current.direction === defaultCallSort.direction ? { ...defaultCallSort, direction: "asc" } : defaultCallSort;
}

export default function CallsView({
  initialResult,
  initialQuery,
  workspace,
  operator = false,
  workspaceOptions,
}: {
  initialResult: CallListResult;
  initialQuery: CallListQuery;
  workspace?: { id: string; name: string };
  operator?: boolean;
  workspaceOptions?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [result, setResult] = useState<CallListResult>(initialResult);
  const [query, setQuery] = useState<CallListQuery>(initialQuery);
  const [filterTrees, setFilterTrees] = useState<CallFilterTrees>(() => filterTreesFromCallFilters(initialQuery.filters));
  const [searchInput, setSearchInput] = useState(initialQuery.filters.search);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const revalidated = useRef(false);
  const requestId = useRef(0);
  const workspaceId = workspace?.id;

  const loadCalls = useCallback(async (quiet: boolean) => {
    const id = ++requestId.current;
    if (!quiet) setLoading(true);
    setFetchError(false);
    const params = callListSearchParams(query);
    if (workspaceId) params.set("workspaceId", workspaceId);
    const search = params.toString();
    try {
      const response = await fetch(`/api/calls${search ? `?${search}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Calls unavailable");
      const body = (await response.json()) as CallListResult;
      if (id === requestId.current) setResult(body);
    } catch {
      if (id === requestId.current && !quiet) setFetchError(true);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [query, workspaceId]);

  useEffect(() => {
    const quiet = !revalidated.current;
    revalidated.current = true;
    if (!quiet) {
      const url = new URL(window.location.href);
      const search = callListSearchParams(query).toString();
      window.history.replaceState(null, "", `${url.pathname}${search ? `?${search}` : ""}`);
    }
    const timer = window.setTimeout(() => void loadCalls(quiet), 0);
    return () => window.clearTimeout(timer);
  }, [loadCalls, query]);

  useEffect(() => {
    const search = searchInput.trim();
    const timer = window.setTimeout(() => {
      setQuery((current) => (current.filters.search === search ? current : { ...current, page: 1, filters: { ...current.filters, search } }));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const pagination: PaginationState = { pageIndex: query.page - 1, pageSize: callPageSize };
  const sorting: SortingState = [{ id: query.sort.column, desc: query.sort.direction === "desc" }];

  function changePagination(updater: Updater<PaginationState>) {
    const next = typeof updater === "function" ? updater(pagination) : updater;
    setQuery((current) => ({ ...current, page: next.pageIndex + 1 }));
  }

  function changeSorting(updater: Updater<SortingState>) {
    const next = typeof updater === "function" ? updater(sorting) : updater;
    setQuery((current) => ({ ...current, page: 1, sort: nextSort(current.sort, next) }));
  }

  function clearFilters() {
    setFilterTrees(filterTreesFromCallFilters(emptyCallFilters));
    setSearchInput("");
    setQuery((current) => ({ ...current, page: 1, filters: emptyCallFilters }));
  }

  function changeFilterTrees(trees: CallFilterTrees) {
    setFilterTrees(trees);
    setQuery((current) => ({ ...current, page: 1, filters: callFiltersFromTrees(trees, current.filters.search) }));
  }

  const timeZone = result.timeZone;
  const listSearch = callListSearchParams(query).toString();
  const back = `${workspaceId ? `/workspaces/${workspaceId}/calls` : "/calls"}${listSearch ? `?${listSearch}` : ""}`;
  const columns = useMemo<ColumnDef<DataGridFeatures, CallListItem>[]>(() => {
    const all: ColumnDef<DataGridFeatures, CallListItem>[] = [
      {
        id: "startedAt",
        accessorFn: (row) => row.startedAt,
        header: ({ column }) => <DataGridColumnHeader title="Started" column={column} />,
        cell: ({ row }) => (
          <Link href={callHref(row.original, back)} prefetch className="font-mono font-medium tabular-nums transition-colors hover:text-muted-foreground">
            {formatCallTime(row.original.startedAt, timeZone)}
          </Link>
        ),
        size: 200,
        meta: { skeleton: <Skeleton className="h-4 w-40" /> },
      },
      {
        id: "callerNumber",
        accessorFn: (row) => row.callerNumber,
        header: ({ column }) => <DataGridColumnHeader title="Caller" column={column} />,
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.callerNumber ?? "Unknown caller"}</span>,
        size: 150,
        meta: { skeleton: <Skeleton className="h-4 w-28" /> },
      },
      {
        id: "workspace",
        accessorFn: (row) => row.workspace.name,
        header: ({ column }) => <DataGridColumnHeader title="Workspace" column={column} />,
        cell: ({ row }) => row.original.workspace.name,
        size: 160,
        meta: { skeleton: <Skeleton className="h-4 w-28" /> },
      },
      {
        id: "outcome",
        accessorFn: (row) => row.outcome,
        header: ({ column }) => <DataGridColumnHeader title="Call Outcome" column={column} />,
        cell: ({ row }) => <CallOutcomeBadge outcome={row.original.outcome} />,
        size: 140,
        meta: { skeleton: <Skeleton className="h-5 w-20" /> },
      },
      {
        id: "connectedDuration",
        accessorFn: (row) => row.connectedDurationSeconds,
        header: ({ column }) => <DataGridColumnHeader title="Connected Duration" column={column} />,
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.connectedDurationSeconds === null ? "-" : formatClock(row.original.connectedDurationSeconds)}</span>,
        size: 170,
        meta: { skeleton: <Skeleton className="h-4 w-12" /> },
      },
      {
        id: "leadClassification",
        accessorFn: (row) => row.effectiveLeadClassification?.classification,
        header: ({ column }) => <DataGridColumnHeader title="Effective Lead Classification" column={column} />,
        cell: ({ row }) => {
          const effective = row.original.effectiveLeadClassification;
          return effective ? <LeadClassificationBadge classification={effective.classification} automated={effective.source === "assessment"} /> : "-";
        },
        size: 240,
        meta: { skeleton: <Skeleton className="h-5 w-24" /> },
      },
      {
        id: "leadScore",
        accessorFn: (row) => row.leadScore,
        header: ({ column }) => <DataGridColumnHeader title="Lead Score" column={column} />,
        cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.leadScore ?? ""}</span>,
        size: 120,
        meta: { skeleton: <Skeleton className="h-4 w-8" /> },
      },
      {
        id: "recording",
        header: "Recording Availability",
        cell: ({ row }) => {
          const [label, variant] = recordingBadges[row.original.recording];
          return <Badge variant={variant}>{label}</Badge>;
        },
        enableSorting: false,
        size: 190,
        meta: { skeleton: <Skeleton className="h-5 w-20" /> },
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
            {row.original.recording === "Ready" ? (
              <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href={callHref(row.original, back, { play: true })}>
                Play Recording
              </Link>
            ) : null}
            <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href={callHref(row.original, back)} prefetch>
              Open Call
            </Link>
            {row.original.mp3RecordingId ? (
              <a className={buttonVariants({ variant: "ghost", size: "sm" })} href={`/api/workspaces/${row.original.workspace.id}/recordings/${row.original.mp3RecordingId}/mp3`} download>
                Download MP3
              </a>
            ) : null}
          </div>
        ),
        enableSorting: false,
        size: 340,
        meta: { skeleton: <Skeleton className="h-8 w-32" /> },
      },
    ];
    return workspaceId ? all.filter((column) => column.id !== "workspace") : all;
  }, [back, timeZone, workspaceId]);

  const table = useTable({
    features: dataGridFeatures,
    data: fetchError ? [] : result.calls,
    columns,
    manualPagination: true,
    manualSorting: true,
    enableMultiSort: false,
    rowCount: result.total,
    getRowId: (row) => row.id,
    state: { pagination, sorting },
    onPaginationChange: changePagination,
    onSortingChange: changeSorting,
  });

  const emptyMessage = fetchError ? (
    <div className="flex flex-col items-center gap-3">
      <p role="alert">Calls are unavailable.</p>
      <Button type="button" variant="outline" onClick={() => void loadCalls(false)}>
        Retry
      </Button>
    </div>
  ) : result.hasCalls ? (
    <EmptyState
      art={<NoResultsArt />}
      title="No matching Calls"
      description="No Calls match these filters."
      action={
        <Button type="button" variant="outline" onClick={clearFilters}>
          Clear Filters
        </Button>
      }
    />
  ) : (
    <EmptyState
      art={<NoCallsArt />}
      title="No Calls yet"
      description="Calls appear after inbound traffic reaches an assigned Tracking Number."
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">Calls</h1>
          <p className="text-sm text-muted-foreground tabular-nums">
            {callCount(result.total)}
            {workspace ? ` in ${workspace.name}` : null}
          </p>
        </div>
        <CallsExportActions workspaceId={workspaceId} query={listSearch} />
      </div>
      {workspace ? <WorkspaceTabs workspaceId={workspace.id} operator={operator} current="calls" /> : null}
      <Frame>
        <FramePanel className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label="Search Calls"
              placeholder="Search caller number or Workspace..."
              className="w-full sm:w-64"
            />
            <CallFilterToolbar trees={filterTrees} onTreesChange={changeFilterTrees} workspaceOptions={workspace ? undefined : workspaceOptions} />
          </div>
          <DataGrid
            table={table}
            recordCount={fetchError ? 0 : result.total}
            isLoading={loading}
            emptyMessage={emptyMessage}
            onRowClick={(call) => router.push(callHref(call, back))}
          >
            <DataGridScrollArea orientation="horizontal">
              <DataGridTable />
            </DataGridScrollArea>
            <DataGridPagination sizes={[callPageSize]} />
          </DataGrid>
        </FramePanel>
      </Frame>
    </div>
  );
}
