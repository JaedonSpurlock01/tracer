/**
 * -------------------------------------------------------------------------
 * @file   workspaces-view.tsx
 * @brief  Renders the Workspaces triage ledger and hosts the setup wizard.
 *
 * @description
 *  Lists Organization-scoped Workspaces as one table grouped in triage
 *  order: Needs attention (Setup Required, or an Active Workspace whose
 *  attention roll-up asks for an Operator), then Running, then Archived
 *  collapsed. Each row shows the Workspace's routing pair, its Calls and
 *  Good Leads for the last 30 days with the lead rate, its last Call in its
 *  reporting timezone, and the attention roll-up with its reason. Setup
 *  Required rows name the next setup step and make Resume Setup the row's
 *  primary action. Search, the Workspace State chips, and the page live in
 *  the URL, and the list revalidates quietly after it renders.
 *
 * @remarks
 *  The wizard is a separate module mounted with a fresh key per opening;
 *  this view only decides when it opens and refreshes after it reports.
 *
 * @see
 *  components/tracer/workspace-setup-wizard.tsx
 *  data/analytics.ts
 *  data/workspace-policy.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon, SearchIcon } from "lucide-react";

import { Badge } from "@/components/reui/badge";
import { Frame, FramePanel } from "@/components/reui/frame";
import { EmptyState } from "@/components/tracer/empty-state";
import { NoResultsArt, NoWorkspacesArt } from "@/components/tracer/line-art";
import WorkspaceSetupWizard from "@/components/tracer/workspace-setup-wizard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCallTime } from "@/components/tracer/call-format";
import type { WorkspaceAttention, WorkspaceListStats, WorkspaceListWithStats } from "@/data/analytics";
import type { WorkspaceListResult, WorkspaceRecord } from "@/data/workspaces";
import { nextSetupStep, type WorkspaceState } from "@/data/workspace-policy";

const pageSize = 10;
const states: Array<"All" | WorkspaceState> = ["All", "Setup Required", "Active", "Archived"];
const numberFormatter = new Intl.NumberFormat("en-US");

type WorkspaceRow = WorkspaceRecord & { stats?: WorkspaceListStats };
type GroupKey = "attention" | "running" | "archived";
const groups: Record<GroupKey, { title: string; tone: string }> = {
  attention: { title: "Needs attention", tone: "bg-warning" },
  running: { title: "Running", tone: "bg-success" },
  archived: { title: "Archived", tone: "bg-muted-foreground/40" },
};
const attentionTone: Record<WorkspaceAttention["status"], string> = {
  Healthy: "bg-success",
  "Needs attention": "bg-warning",
  "Not applicable": "bg-muted-foreground/40",
};

function stateVariant(state: WorkspaceState): "primary-light" | "success-light" | "destructive-light" {
  return state === "Active" ? "success-light" : state === "Archived" ? "destructive-light" : "primary-light";
}
function groupOf(row: WorkspaceRow): GroupKey {
  if (row.state === "Archived") return "archived";
  if (row.state === "Setup Required" || row.stats?.attention.status === "Needs attention") return "attention";
  return "running";
}
function responseBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

export interface WorkspacesViewQuery {
  search: string;
  state: "All" | WorkspaceState;
  page: number;
}

function Dot({ className }: { className: string }) {
  return <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${className}`} />;
}

const headerCell = "h-10 px-3 text-left align-middle text-xs font-medium text-muted-foreground first:ps-(--frame-panel-px) last:pe-(--frame-panel-px)";
const bodyCell = "px-3 py-2.5 align-top text-sm first:ps-(--frame-panel-px) last:pe-(--frame-panel-px)";

function LedgerRow({ row, readOnly, onResume }: { row: WorkspaceRow; readOnly: boolean; onResume: (workspace: WorkspaceRecord) => void }) {
  const stats = row.stats;
  const attention = stats?.attention;
  const next = row.state === "Setup Required" ? nextSetupStep(row) : null;
  const rate = stats && stats.callsLast30Days > 0 ? Math.round((stats.goodLeadsLast30Days / stats.callsLast30Days) * 100) : null;
  return (
    <tr className="border-t border-border transition-colors hover:bg-muted/40">
      <td className={bodyCell}>
        <div className="flex flex-col gap-0.5">
          <Link className="font-medium hover:underline" href={`/workspaces/${row.id}`} prefetch>
            {row.name}
          </Link>
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={stateVariant(row.state)} size="sm">
              {row.state}
            </Badge>
            <span>{next ? `Next: ${next}` : row.reportingTimezone}</span>
          </span>
        </div>
      </td>
      <td className={bodyCell}>
        <div className="flex flex-col gap-0.5 font-mono text-xs tabular-nums">
          <span className={row.trackingNumber ? "" : "text-muted-foreground"}>{row.trackingNumber ?? "No Tracking Number"}</span>
          <span className="text-muted-foreground">{row.destinationNumber ? `→ ${row.destinationNumber}` : "→ No Destination Number"}</span>
        </div>
      </td>
      <td className={`${bodyCell} text-right font-mono tabular-nums`}>{stats ? numberFormatter.format(stats.callsLast30Days) : "-"}</td>
      <td className={`${bodyCell} text-right font-mono tabular-nums`}>{stats ? numberFormatter.format(stats.goodLeadsLast30Days) : "-"}</td>
      <td className={bodyCell}>
        {rate === null ? (
          <span className="text-muted-foreground">-</span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <span className="h-1 w-14 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span className="block h-full rounded-full bg-primary" style={{ width: `${rate}%` }} />
            </span>
            <span className="font-mono text-xs tabular-nums">{rate}%</span>
          </span>
        )}
      </td>
      <td className={`${bodyCell} font-mono tabular-nums`}>{stats?.lastCallAt ? formatCallTime(stats.lastCallAt, row.reportingTimezone) : "-"}</td>
      <td className={bodyCell}>
        {attention ? (
          <span className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1.5">
              <Dot className={attentionTone[attention.status]} />
              {attention.status}
            </span>
            {attention.reason ? <span className="text-xs text-muted-foreground">{attention.reason}</span> : null}
          </span>
        ) : (
          "-"
        )}
      </td>
      <td className={`${bodyCell} text-right`}>
        {row.state === "Setup Required" && !readOnly ? (
          <Button size="xs" onClick={() => onResume(row)}>
            Resume Setup
          </Button>
        ) : (
          <Button variant="outline" size="xs" render={<Link href={`/workspaces/${row.id}`} prefetch />}>
            Open
          </Button>
        )}
      </td>
    </tr>
  );
}

function LedgerGroup({ group, rows, defaultOpen, children }: { group: GroupKey; rows: WorkspaceRow[]; defaultOpen: boolean; children: (row: WorkspaceRow) => ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  if (rows.length === 0) return null;
  return (
    <tbody>
      <tr className="border-t border-border bg-muted/30">
        <th colSpan={8} scope="rowgroup" className="px-(--frame-panel-px) py-1.5 text-left text-xs font-medium text-muted-foreground">
          <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="inline-flex items-center gap-2">
            <ChevronDownIcon className={`size-3.5 transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden />
            <Dot className={groups[group].tone} />
            <span className="uppercase tracking-wider">{groups[group].title}</span>
            <span className="font-mono tabular-nums">{rows.length}</span>
          </button>
        </th>
      </tr>
      {open ? rows.map(children) : null}
    </tbody>
  );
}

export default function WorkspacesView({
  initialTimezone,
  initialResult,
  initialQuery,
  readOnly = false,
  cloudflareConnected = true,
}: {
  initialTimezone: string;
  initialResult: WorkspaceListWithStats;
  initialQuery: WorkspacesViewQuery;
  readOnly?: boolean;
  cloudflareConnected?: boolean;
}) {
  const searchParams = useSearchParams();
  const resumeId = searchParams.get("resume");
  const [result, setResult] = useState<WorkspaceListWithStats>(initialResult);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState(initialQuery.search);
  const [stateFilter, setStateFilter] = useState<"All" | WorkspaceState>(initialQuery.state);
  const [page, setPage] = useState(initialQuery.page);
  const revalidated = useRef(false);
  const requestId = useRef(0);
  const [status, setStatus] = useState("");
  const [resumeHandled, setResumeHandled] = useState(false);
  const [wizard, setWizard] = useState<{ key: number; workspace: WorkspaceRecord | null; open: boolean } | null>(null);

  const loadWorkspaces = useCallback(async (quiet = false) => {
    const id = ++requestId.current;
    if (!quiet) setLoading(true);
    setFetchError(false);
    const params = new URLSearchParams({ search, state: stateFilter, page: String(page), pageSize: String(pageSize) });
    try {
      const response = await fetch(`/api/workspaces?${params}`);
      if (!response.ok) throw new Error("Workspaces unavailable");
      const body = await responseBody(response);
      if (id !== requestId.current) return;
      setResult({
        workspaces: Array.isArray(body.workspaces) ? (body.workspaces as WorkspaceRecord[]) : [],
        total: typeof body.total === "number" ? body.total : 0,
        page: typeof body.page === "number" ? body.page : 1,
        pageSize: typeof body.pageSize === "number" ? body.pageSize : pageSize,
        counts: (body.counts as WorkspaceListResult["counts"]) ?? { setupRequired: 0, active: 0, archived: 0 },
        stats: (body.stats as WorkspaceListWithStats["stats"]) ?? {},
      });
    } catch {
      if (id === requestId.current) setFetchError(true);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [page, search, stateFilter]);

  const openWizard = useCallback((workspace: WorkspaceRecord | null) => {
    setWizard((current) => ({ key: (current?.key ?? 0) + 1, workspace, open: true }));
  }, []);

  useEffect(() => {
    const quiet = !revalidated.current;
    revalidated.current = true;
    if (!quiet) {
      const url = new URL(window.location.href);
      if (search) url.searchParams.set("search", search);
      else url.searchParams.delete("search");
      if (stateFilter !== "All") url.searchParams.set("state", stateFilter);
      else url.searchParams.delete("state");
      if (page > 1) url.searchParams.set("page", String(page));
      else url.searchParams.delete("page");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    }
    const timer = window.setTimeout(() => void loadWorkspaces(quiet), 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspaces, page, search, stateFilter]);
  useEffect(() => {
    if (readOnly || !resumeId || resumeHandled || loading) return;
    const listed = result.workspaces.find((item) => item.id === resumeId);
    if (listed) {
      const timer = window.setTimeout(() => {
        openWizard(listed);
        setResumeHandled(true);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    void fetch(`/api/workspaces/${resumeId}`)
      .then(async (response) => (response.ok ? ((await responseBody(response)).workspace as WorkspaceRecord) : null))
      .then((value) => {
        if (!cancelled && value) openWizard(value);
        if (!cancelled) setResumeHandled(true);
      })
      .catch(() => {
        if (!cancelled) setResumeHandled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loading, openWizard, readOnly, result.workspaces, resumeHandled, resumeId]);

  const rows = useMemo(() => result.workspaces.map((workspace): WorkspaceRow => ({ ...workspace, stats: result.stats[workspace.id] })), [result]);
  const grouped = useMemo(() => {
    const byGroup: Record<GroupKey, WorkspaceRow[]> = { attention: [], running: [], archived: [] };
    for (const row of rows) byGroup[groupOf(row)].push(row);
    return byGroup;
  }, [rows]);
  const counts = {
    All: result.counts.setupRequired + result.counts.active + result.counts.archived,
    "Setup Required": result.counts.setupRequired,
    Active: result.counts.active,
    Archived: result.counts.archived,
  };
  const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
  const first = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const last = Math.min(result.total, result.page * result.pageSize);
  const filtered = Boolean(search) || stateFilter !== "All";
  const noResults = !fetchError && !loading && result.workspaces.length === 0;
  const renderRow = (row: WorkspaceRow) => <LedgerRow key={row.id} row={row} readOnly={readOnly} onResume={openWizard} />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Workspaces</h1>
          <p className="text-sm text-muted-foreground">
            {readOnly ? null : `${result.counts.setupRequired} Setup Required, `}{result.counts.active} Active, {result.counts.archived} Archived
          </p>
        </div>
        {readOnly ? null : (
          <Button type="button" onClick={() => openWizard(null)}>
            Create Workspace
          </Button>
        )}
      </div>
      <Frame>
        <FramePanel className="flex flex-col gap-3 p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-(--frame-panel-px) pt-(--frame-panel-py)">
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Workspace State">
              {states
                .filter((state) => !(readOnly && state === "Setup Required"))
                .map((state) => {
                  const active = stateFilter === state;
                  return (
                    <button
                      key={state}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setStateFilter(state);
                        setPage(1);
                      }}
                      className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors ${active ? "border-border bg-muted text-foreground" : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
                    >
                      {state}
                      <span className="font-mono tabular-nums">{counts[state]}</span>
                    </button>
                  );
                })}
            </div>
            <div className="relative w-full sm:w-72">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                id="search-workspaces"
                aria-label="Search workspaces"
                placeholder="Search name or number"
                className="pl-8"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
          {status ? <p role="status" className="px-(--frame-panel-px) text-sm">{status}</p> : null}
          {fetchError ? (
            <div className="flex items-center gap-3 px-(--frame-panel-px) pb-(--frame-panel-py)">
              <p role="alert">Workspaces are unavailable.</p>
              <Button type="button" variant="outline" onClick={() => void loadWorkspaces()}>
                Retry
              </Button>
            </div>
          ) : null}
          {noResults ? (
            <div className="px-(--frame-panel-px) pb-(--frame-panel-py)">
              <EmptyState
                data-testid="workspace-empty-state"
                art={filtered ? <NoResultsArt /> : <NoWorkspacesArt />}
                title={filtered ? "No matching Workspaces" : readOnly ? "No Workspaces shared" : "No Workspaces yet"}
                description={
                  filtered
                    ? "Clear the search or change the Workspace State filter."
                    : readOnly
                      ? "No Workspaces are shared with you."
                      : "No Workspaces yet. Create a Workspace now; activating it later requires the connected Organization Twilio account."
                }
                action={
                  readOnly ? null : (
                    <Button type="button" onClick={() => openWizard(null)}>
                      Create Workspace
                    </Button>
                  )
                }
              />
            </div>
          ) : null}
          {!fetchError && (loading || result.workspaces.length > 0) ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[56rem]">
                  <thead>
                    <tr>
                      <th scope="col" className={headerCell}>Workspace</th>
                      <th scope="col" className={headerCell}>Routing</th>
                      <th scope="col" className={`${headerCell} text-right`}>Calls (30d)</th>
                      <th scope="col" className={`${headerCell} text-right`}>Good Leads (30d)</th>
                      <th scope="col" className={headerCell}>Lead rate</th>
                      <th scope="col" className={headerCell}>Last Call</th>
                      <th scope="col" className={headerCell}>Attention</th>
                      <th scope="col" className={headerCell}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  {loading ? (
                    <tbody>
                      {[0, 1, 2].map((index) => (
                        <tr key={index} className="border-t border-border">
                          <td colSpan={8} className={bodyCell}>
                            <Skeleton className="h-8 w-full" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  ) : (
                    <>
                      <LedgerGroup group="attention" rows={grouped.attention} defaultOpen>{renderRow}</LedgerGroup>
                      <LedgerGroup group="running" rows={grouped.running} defaultOpen>{renderRow}</LedgerGroup>
                      <LedgerGroup key={stateFilter} group="archived" rows={grouped.archived} defaultOpen={stateFilter === "Archived"}>{renderRow}</LedgerGroup>
                    </>
                  )}
                </table>
              </div>
              <div className="flex items-center justify-between border-t border-border px-(--frame-panel-px) py-3 text-xs text-muted-foreground">
                <span className="font-mono tabular-nums">{first}–{last} of {result.total}</span>
                <div className="flex items-center gap-1">
                  <Button type="button" variant="outline" size="xs" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>
                    Previous
                  </Button>
                  <Button type="button" variant="outline" size="xs" disabled={page >= pageCount || loading} onClick={() => setPage((current) => current + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </FramePanel>
      </Frame>
      {wizard ? (
        <WorkspaceSetupWizard
          key={wizard.key}
          open={wizard.open}
          onOpenChange={(open) => setWizard((current) => (current ? { ...current, open } : current))}
          workspace={wizard.workspace}
          initialTimezone={initialTimezone}
          cloudflareConnected={cloudflareConnected}
          onCreated={() => void loadWorkspaces(true)}
          onActivated={(active) => {
            setStatus(`${active.name} is Active.`);
            void loadWorkspaces(true);
          }}
        />
      ) : null}
    </div>
  );
}
