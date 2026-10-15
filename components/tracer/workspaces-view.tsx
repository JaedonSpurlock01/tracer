/**
 * -------------------------------------------------------------------------
 * @file   workspaces-view.tsx
 * @brief  Renders the Operator Workspaces Data Grid and setup dialog.
 *
 * @description
 *  Loads Organization-scoped Workspace pages from the server and provides the
 *  initial Basics step for creating or resuming Workspace setup.
 *
 * @remarks
 *  Number, Routing, and Review remain disabled until Call Flow publication is
 *  delivered by a later milestone.
 *
 * @see
 *  data/workspaces-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useTable, type ColumnDef, type PaginationState } from "@tanstack/react-table";

import { Badge } from "@/components/reui/badge";
import { DataGrid, dataGridFeatures, type DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { Frame, FramePanel } from "@/components/reui/frame";
import { Stepper, StepperContent, StepperIndicator, StepperItem, StepperNav, StepperPanel, StepperSeparator, StepperTitle, StepperTrigger } from "@/components/reui/stepper";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { WorkspaceListResult, WorkspaceRecord } from "@/data/workspaces";
import type { WorkspaceState } from "@/data/workspace-policy";

const pageSize = 10;
const states: Array<"All" | WorkspaceState> = ["All", "Setup Required", "Active", "Archived"];
const steps = ["Basics", "Number", "Routing", "Review"];

function stateVariant(state: WorkspaceState): "primary-light" | "success-light" | "destructive-light" {
  if (state === "Active") return "success-light";
  if (state === "Archived") return "destructive-light";
  return "primary-light";
}

function responseBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

function timezoneValues(): string[] {
  return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
}

interface WorkspacesViewProps {
  initialTimezone: string;
}

export default function WorkspacesView({ initialTimezone }: WorkspacesViewProps) {
  const searchParams = useSearchParams();
  const resumeId = searchParams.get("resume");
  const [result, setResult] = useState<WorkspaceListResult>({
    workspaces: [],
    total: 0,
    page: 1,
    pageSize,
    counts: { setupRequired: 0, active: 0, archived: 0 },
  });
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<"All" | WorkspaceState>("All");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editWorkspace, setEditWorkspace] = useState<WorkspaceRecord | null>(null);
  const [step, setStep] = useState(1);
  const [actionError, setActionError] = useState("");
  const [status, setStatus] = useState("");
  const [resumeHandled, setResumeHandled] = useState(false);

  const openCreate = useCallback(() => {
    setEditWorkspace(null);
    setStep(1);
    setActionError("");
    setDialogOpen(true);
  }, []);

  const openResume = useCallback((workspace: WorkspaceRecord) => {
    setEditWorkspace(workspace);
    setStep(2);
    setActionError("");
    setDialogOpen(true);
  }, []);

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    setFetchError(false);
    const params = new URLSearchParams({
      search,
      state: stateFilter,
      page: String(pagination.pageIndex + 1),
      pageSize: String(pageSize),
    });
    try {
      const response = await fetch(`/api/workspaces?${params}`);
      if (!response.ok) throw new Error("Workspaces unavailable");
      const body = await responseBody(response);
      setResult({
        workspaces: Array.isArray(body.workspaces) ? body.workspaces as WorkspaceRecord[] : [],
        total: typeof body.total === "number" ? body.total : 0,
        page: typeof body.page === "number" ? body.page : pagination.pageIndex + 1,
        pageSize: typeof body.pageSize === "number" ? body.pageSize : pageSize,
        counts: (body.counts as WorkspaceListResult["counts"]) ?? {
          setupRequired: 0,
          active: 0,
          archived: 0,
        },
      });
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [pagination.pageIndex, search, stateFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkspaces(), 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspaces]);

  useEffect(() => {
    if (!resumeId || resumeHandled || loading) return;
    const listed = result.workspaces.find((workspace) => workspace.id === resumeId);
    if (listed) {
      const timer = window.setTimeout(() => {
        openResume(listed);
        setResumeHandled(true);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    void fetch(`/api/workspaces/${resumeId}`)
      .then(async (response) => {
        if (!response.ok) return null;
        const body = await responseBody(response);
        return body.workspace as WorkspaceRecord | undefined;
      })
      .then((workspace) => {
        if (!cancelled && workspace) openResume(workspace);
        if (!cancelled) setResumeHandled(true);
      })
      .catch(() => {
        if (!cancelled) setResumeHandled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loading, openResume, result.workspaces, resumeHandled, resumeId]);

  function resetPagination() {
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setActionError("");
    const response = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: String(form.get("name") ?? ""),
        reportingTimezone: String(form.get("reportingTimezone") ?? initialTimezone),
      }),
    }).catch(() => null);
    if (!response) {
      setActionError("Workspace could not be created.");
      return;
    }
    const body = await responseBody(response);
    if (response.status === 409 && body.error === "name_taken") {
      setActionError("A Workspace with this name already exists.");
      return;
    }
    if (!response.ok) {
      setActionError("Enter a valid Workspace name and reporting timezone.");
      return;
    }
    setDialogOpen(false);
    await loadWorkspaces();
    setStatus("Workspace created in Setup Required state.");
  }

  const columns = useMemo<ColumnDef<DataGridFeatures, WorkspaceRecord>[]>(() => [
    {
      accessorKey: "name",
      header: "Workspace",
      cell: ({ row }) => (
        <Link className="font-medium hover:underline" href={`/workspaces/${row.original.id}`}>
          <span>{row.original.name}</span>
          <span className="block text-xs text-muted-foreground">{row.original.reportingTimezone}</span>
        </Link>
      ),
      meta: { skeleton: <Skeleton className="h-8 w-44" /> },
    },
    {
      accessorKey: "state",
      header: "Workspace State",
      cell: ({ row }) => <Badge variant={stateVariant(row.original.state)}>{row.original.state}</Badge>,
    },
    { id: "trackingNumber", header: "Tracking Number", cell: () => "-" },
    {
      accessorKey: "destinationNumber",
      header: "Destination Number",
      cell: ({ row }) => row.original.destinationNumber ?? "-",
    },
    { id: "calls", header: "Calls (30d)", cell: () => "-" },
    { id: "goodLeads", header: "Good Leads (30d)", cell: () => "-" },
    { id: "lastCall", header: "Last Call", cell: () => "-" },
    { id: "integrationHealth", header: "Integration health", cell: () => "Not configured" },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          {row.original.state === "Setup Required" ? (
            <Button variant="ghost" size="sm" onClick={() => openResume(row.original)}>
              Resume Setup
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            render={<Link href={`/workspaces/${row.original.id}`} />}
          >
            Open
          </Button>
        </div>
      ),
    },
  ], [openResume]);

  const table = useTable({
    features: dataGridFeatures,
    data: result.workspaces,
    columns,
    getRowId: (row) => row.id,
    state: { pagination },
    onPaginationChange: setPagination,
  });
  const noResults = !fetchError && !loading && result.workspaces.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Workspaces</h1>
        <p className="text-sm text-muted-foreground">
          {result.counts.setupRequired} Setup Required, {result.counts.active} Active, {result.counts.archived} Archived
        </p>
      </div>
      <Frame>
        <FramePanel className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field className="min-w-56 flex-1">
              <FieldLabel htmlFor="search-workspaces">Search</FieldLabel>
              <Input
                id="search-workspaces"
                aria-label="Search workspaces"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  resetPagination();
                }}
              />
            </Field>
            <Field className="w-48">
              <FieldLabel htmlFor="workspace-state">Workspace State</FieldLabel>
              <Select
                value={stateFilter}
                onValueChange={(value) => {
                  setStateFilter((value ?? "All") as "All" | WorkspaceState);
                  resetPagination();
                }}
              >
                <SelectTrigger id="workspace-state" aria-label="Workspace State">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {states.map((state) => <SelectItem key={state} value={state}>{state}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field className="w-48">
              <FieldLabel htmlFor="integration-health">Integration health</FieldLabel>
              <Select disabled value="All">
                <SelectTrigger id="integration-health" aria-label="Integration health">
                  <SelectValue placeholder="Not configured" />
                </SelectTrigger>
                <SelectContent><SelectItem value="All">All</SelectItem></SelectContent>
              </Select>
            </Field>
            <Button type="button" onClick={openCreate}>Create Workspace</Button>
          </div>
          {status ? <p role="status">{status}</p> : null}
          {fetchError ? (
            <div className="flex items-center gap-3">
              <p role="alert">Workspaces are unavailable.</p>
              <Button type="button" variant="outline" onClick={() => void loadWorkspaces()}>Retry</Button>
            </div>
          ) : null}
          {noResults ? (
            <div className="flex flex-col gap-3" data-testid="workspace-empty-state">
              <p>
                {search || stateFilter !== "All"
                  ? "No matching Workspaces."
                  : "No Workspaces yet. Create a Workspace now; activating it later requires the connected Organization Twilio account."}
              </p>
              <div className="flex gap-2">
                <Button type="button" onClick={openCreate}>Create Workspace</Button>
                {search || stateFilter !== "All" ? (
                  <Button type="button" variant="outline" onClick={() => { setSearch(""); setStateFilter("All"); }}>
                    Clear Filters
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {!fetchError && (loading || result.workspaces.length > 0) ? (
            <DataGrid table={table} recordCount={result.total} isLoading={loading}>
              <DataGridScrollArea orientation="horizontal">
                <DataGridTable />
              </DataGridScrollArea>
              <DataGridPagination sizes={[pageSize]} />
            </DataGrid>
          ) : null}
        </FramePanel>
      </Frame>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editWorkspace ? `Resume setup for ${editWorkspace.name}` : "Create Workspace"}</DialogTitle>
            <DialogDescription>
              {editWorkspace
                ? "Number setup is not available yet. This Workspace remains Setup Required."
                : "Create a Workspace without activating Twilio routing."}
            </DialogDescription>
          </DialogHeader>
          <Stepper
            value={step}
            onValueChange={(value) => {
              if (!editWorkspace && value === 1) setStep(value);
            }}
          >
            <StepperNav>
              {steps.map((label, index) => (
                <StepperItem key={label} step={index + 1} disabled={editWorkspace ? index !== 1 : index !== 0}>
                  <StepperTrigger>
                    <StepperIndicator>{index + 1}</StepperIndicator>
                    <StepperTitle>{label}</StepperTitle>
                  </StepperTrigger>
                  {index < steps.length - 1 ? <StepperSeparator /> : null}
                </StepperItem>
              ))}
            </StepperNav>
            <StepperPanel>
              <StepperContent value={1}>
                <form className="mt-5 flex flex-col gap-4" onSubmit={(event) => void createWorkspace(event)}>
                  <Field data-invalid={Boolean(actionError)}>
                    <FieldLabel htmlFor="workspace-name">Workspace name</FieldLabel>
                    <Input id="workspace-name" name="name" defaultValue={editWorkspace?.name ?? ""} required maxLength={80} disabled={Boolean(editWorkspace)} />
                    {actionError ? <FieldError>{actionError}</FieldError> : null}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="workspace-timezone">Reporting timezone</FieldLabel>
                    <Select name="reportingTimezone" defaultValue={editWorkspace?.reportingTimezone ?? initialTimezone} disabled={Boolean(editWorkspace)}>
                      <SelectTrigger id="workspace-timezone" aria-label="Reporting timezone"><SelectValue /></SelectTrigger>
                      <SelectContent>{timezoneValues().map((timezone) => <SelectItem key={timezone} value={timezone}>{timezone}</SelectItem>)}</SelectContent>
                    </Select>
                    <FieldDescription>Used for Workspace reporting dates and times.</FieldDescription>
                  </Field>
                  <DialogFooter><Button type="submit" disabled={Boolean(editWorkspace)}>Create Workspace</Button></DialogFooter>
                </form>
              </StepperContent>
              {[2, 3, 4].map((value) => (
                <StepperContent key={value} value={value}>
                  <div className="mt-5 rounded-md border border-dashed p-5">
                    <p className="font-medium">{steps[value - 1]} setup is disabled</p>
                    <p className="text-sm text-muted-foreground">Arrives with Call Flow publication</p>
                  </div>
                </StepperContent>
              ))}
            </StepperPanel>
          </Stepper>
        </DialogContent>
      </Dialog>
    </div>
  );
}
