/**
 * -------------------------------------------------------------------------
 * @file   calls-view.tsx
 * @brief  Renders the server-backed Calls Data Grid.
 *
 * @description
 *  Shows one page of Calls in single-line rows of Started, Caller,
 *  Workspace, Outcome, Duration, and Lead. The first page arrives from the
 *  server and is not fetched again on mount; searching, filtering, sorting,
 *  and paging fetch the next page from the Calls endpoint, keep the page,
 *  sort, search, and filters in the URL, and show Skeleton rows while it
 *  loads. Any search or filter change returns to the first page. A row and
 *  its Started link open Call Detail with this list's URL as the `back`
 *  param so Call Detail can return to it and step through it. Workspace
 *  Calls fixes the Workspace scope and omits the Workspace column and
 *  filter.
 *
 * @remarks
 *  The Lead Score, Recording availability, Play Recording, and Download MP3
 *  live behind the row on Call Detail so every row fits one line. Below the
 *  md breakpoint only Started, Caller, and Outcome show, sized to their
 *  content, so the grid fits a 390px screen without scrolling. Started
 *  shows the short time, with the full timestamp as its hover title.
 *  The list refreshes every 30 seconds while the tab is visible, pauses
 *  while it is hidden, and refreshes at once on return when the last load
 *  is 30 seconds old. A refresh rereads the same page, sort, and filters
 *  without Skeletons and updates rows in place by Call id; a failed
 *  refresh keeps the rows and the next one tries again, and a refresh
 *  never overrides a load the user started.
 *  Export Recordings and Export CSV confirm and export the current scope
 *  and the filters in the URL.
 *  The Empty and fetch error states render inside the grid so the header
 *  actions and toolbar stay in place. A scope with no Calls explains where
 *  Calls come from, while filters that match nothing keep the filters and
 *  offer Clear Filters. Search waits for typing to settle before fetching.
 *  Dates use the timezone the server names for the scope: the user's for
 *  global Calls and the Workspace's for Workspace Calls. Clicking Started
 *  while it sorts descending flips it to ascending instead of clearing to
 *  the same default.
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

import { DataGrid, dataGridFeatures, type DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { DataGridColumnHeader } from "@/components/reui/data-grid/data-grid-column-header";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { EmptyState } from "@/components/tracer/empty-state";
import { PageHeader, Panel } from "@/components/tracer/page-parts";
import { NoCallsArt, NoResultsArt } from "@/components/tracer/line-art";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CallsExportActions } from "@/components/tracer/call-export";
import CallFilterToolbar, { callFiltersFromTrees, filterTreesFromCallFilters, type CallFilterTrees } from "@/components/tracer/call-filters";
import CallOutcomeBadge from "@/components/tracer/call-outcome-badge";
import { formatCallTime, formatClock, formatShortTime } from "@/components/tracer/call-format";
import LeadClassificationBadge from "@/components/tracer/lead-classification-badge";
import { useIsMobile } from "@/hooks/use-mobile";
import { callListSearchParams, callPageSize, defaultCallSort, emptyCallFilters, type CallListQuery, type CallSort, type CallSortColumn } from "@/data/call-list-query";
import { callDetailHref } from "@/data/call-source";
import type { CallListItem, CallListResult } from "@/data/calls";

const refreshIntervalMs = 30_000;
const narrowHiddenColumns = { workspace: false, connectedDuration: false, leadClassification: false };

function callHref(call: CallListItem, back: string): string {
  return callDetailHref({ id: call.id, workspaceId: call.workspace.id }, back);
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
  workspaceOptions,
}: {
  initialResult: CallListResult;
  initialQuery: CallListQuery;
  workspace?: { id: string; name: string };
  workspaceOptions?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [result, setResult] = useState<CallListResult>(initialResult);
  const [query, setQuery] = useState<CallListQuery>(initialQuery);
  const [filterTrees, setFilterTrees] = useState<CallFilterTrees>(() => filterTreesFromCallFilters(initialQuery.filters));
  const [searchInput, setSearchInput] = useState(initialQuery.filters.search);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const mounted = useRef(false);
  const requestId = useRef(0);
  const loadingRef = useRef(false);
  const loadedAt = useRef(0);
  const workspaceId = workspace?.id;
  const narrow = useIsMobile();

  const loadCalls = useCallback(async (quiet: boolean) => {
    if (quiet && loadingRef.current) return;
    const id = quiet ? requestId.current : ++requestId.current;
    if (!quiet) {
      loadingRef.current = true;
      setLoading(true);
      setFetchError(false);
    }
    const params = callListSearchParams(query);
    if (workspaceId) params.set("workspaceId", workspaceId);
    const search = params.toString();
    try {
      const response = await fetch(`/api/calls${search ? `?${search}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Calls unavailable");
      const body = (await response.json()) as CallListResult;
      if (id !== requestId.current) return;
      setResult(body);
      setFetchError(false);
      loadedAt.current = Date.now();
    } catch {
      if (id === requestId.current && !quiet) setFetchError(true);
    } finally {
      if (id === requestId.current && !quiet) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [query, workspaceId]);

  const loadCallsRef = useRef(loadCalls);
  useEffect(() => {
    loadCallsRef.current = loadCalls;
  }, [loadCalls]);

  useEffect(() => {
    loadedAt.current = Date.now();
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      timer = setInterval(() => void loadCallsRef.current(true), refreshIntervalMs);
    };
    const changeVisibility = () => {
      if (document.visibilityState !== "visible") return stop();
      if (Date.now() - loadedAt.current >= refreshIntervalMs) void loadCallsRef.current(true);
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
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const url = new URL(window.location.href);
    const search = callListSearchParams(query).toString();
    window.history.replaceState(null, "", `${url.pathname}${search ? `?${search}` : ""}`);
    const timer = window.setTimeout(() => void loadCalls(false), 0);
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
          <Link
            href={callHref(row.original, back)}
            prefetch
            title={formatCallTime(row.original.startedAt, timeZone)}
            className="font-medium whitespace-nowrap tabular-nums transition-colors hover:text-muted-foreground"
          >
            {formatShortTime(row.original.startedAt, timeZone)}
          </Link>
        ),
        size: 110,
        meta: { skeleton: <Skeleton className="h-4 w-16" /> },
      },
      {
        id: "callerNumber",
        accessorFn: (row) => row.callerNumber,
        header: ({ column }) => <DataGridColumnHeader title="Caller" column={column} />,
        cell: ({ row }) => <span className="font-mono whitespace-nowrap tabular-nums">{row.original.callerNumber ?? "Unknown caller"}</span>,
        size: 150,
        meta: { skeleton: <Skeleton className="h-4 w-28" /> },
      },
      {
        id: "workspace",
        accessorFn: (row) => row.workspace.name,
        header: ({ column }) => <DataGridColumnHeader title="Workspace" column={column} />,
        cell: ({ row }) => <span className="block truncate">{row.original.workspace.name}</span>,
        size: 200,
        meta: { skeleton: <Skeleton className="h-4 w-28" /> },
      },
      {
        id: "outcome",
        accessorFn: (row) => row.outcome,
        header: ({ column }) => <DataGridColumnHeader title="Outcome" column={column} />,
        cell: ({ row }) => <CallOutcomeBadge outcome={row.original.outcome} />,
        size: 130,
        meta: { skeleton: <Skeleton className="h-5 w-20" /> },
      },
      {
        id: "connectedDuration",
        accessorFn: (row) => row.connectedDurationSeconds,
        header: ({ column }) => <DataGridColumnHeader title="Duration" column={column} />,
        cell: ({ row }) =>
          row.original.connectedDurationSeconds === null ? <span className="text-muted-foreground">None</span> : <span className="tabular-nums">{formatClock(row.original.connectedDurationSeconds)}</span>,
        size: 120,
        meta: { skeleton: <Skeleton className="h-4 w-12" /> },
      },
      {
        id: "leadClassification",
        accessorFn: (row) => row.effectiveLeadClassification?.classification,
        header: ({ column }) => <DataGridColumnHeader title="Lead" column={column} />,
        cell: ({ row }) => {
          const effective = row.original.effectiveLeadClassification;
          return effective ? <LeadClassificationBadge classification={effective.classification} automated={effective.source === "assessment"} /> : <span className="text-muted-foreground">None</span>;
        },
        size: 170,
        meta: { skeleton: <Skeleton className="h-5 w-24" /> },
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
    state: { pagination, sorting, columnVisibility: narrow ? narrowHiddenColumns : {} },
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
    <div className="flex flex-col gap-5">
      <PageHeader title="Calls" description={<span className="tabular-nums">{callCount(result.total)}{workspace ? ` in ${workspace.name}` : null}</span>}>
        <CallsExportActions workspaceId={workspaceId} query={listSearch} />
      </PageHeader>
      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
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
          tableLayout={{ width: narrow ? "auto" : "fixed" }}
          onRowClick={(call) => router.push(callHref(call, back))}
        >
          <DataGridScrollArea orientation="horizontal">
            <DataGridTable />
          </DataGridScrollArea>
          <div className="border-t border-border px-4 py-2">
            <DataGridPagination sizes={[callPageSize]} />
          </div>
        </DataGrid>
      </Panel>
    </div>
  );
}
