/**
 * -------------------------------------------------------------------------
 * @file   workspaces-view.tsx
 * @brief  Renders the Operator Workspaces Data Grid and setup wizard.
 *
 * @description
 *  Loads Organization-scoped Workspaces and guides Operators through Basics,
 *  Site, Number, Routing, and Review before activating a Workspace. The Site
 *  step links a Site right after the Workspace record exists, can always be
 *  skipped, explains a disconnected Cloudflare account, and shows the current
 *  Site Link read-only with Change on Resume Setup. Each row shows
 *  the Workspace's Calls and Good Leads for the last 30 days, its last Call
 *  in its reporting timezone, and its integration health, which reports
 *  Needs attention when the Twilio webhook or the linked Site does.
 *
 * @remarks
 *  Number selection remains local until activation, while routing and flow
 *  validation use the Workspace HTTP boundaries.
 *
 * @see
 *  data/workspaces-handler.ts
 *  data/analytics.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTable, type ColumnDef, type PaginationState } from "@tanstack/react-table";

import { Badge } from "@/components/reui/badge";
import { DataGrid, dataGridFeatures, type DataGridFeatures } from "@/components/reui/data-grid/data-grid";
import { DataGridPagination } from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import { Frame, FramePanel } from "@/components/reui/frame";
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/reui/stepper";
import { EmptyState } from "@/components/tracer/empty-state";
import { NoResultsArt, NoWorkspacesArt } from "@/components/tracer/line-art";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import FlowSummary from "@/components/tracer/flow/flow-summary";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import { SitePickerList } from "@/components/tracer/site-picker";
import { formatCallDate, formatCallTime } from "@/components/tracer/call-format";
import type { WebhookHealth, WorkspaceListStats, WorkspaceListWithStats } from "@/data/analytics";
import { recordingDisclosureText, ttsVoices, type CallFlowGraph } from "@/data/call-flow";
import type { WorkspaceListResult, WorkspaceRecord } from "@/data/workspaces";
import type { WorkspaceState } from "@/data/workspace-policy";

const pageSize = 10;
const states: Array<"All" | WorkspaceState> = ["All", "Setup Required", "Active", "Archived"];
const steps = ["Basics", "Site", "Number", "Routing", "Review"];

type AvailableNumber = { id: string; phoneNumber: string; friendlyName: string; assignedWorkspace: { id: string; name: string } | null };
type RoutingForm = {
  destinationNumber: string;
  recordingEnabled: boolean;
  analysisEnabled: boolean;
  spamGateEnabled: boolean;
  whisperEnabled: boolean;
  whisperMessage: string | null;
  disclosureVoice: (typeof ttsVoices)[number];
};
type FlowResponse = {
  draft: { graph: CallFlowGraph } | null;
  validation: { valid: boolean; issues: Array<{ code: string; message: string }> } | null;
};

type LinkedSite = { id: string; primaryHostname: string; linkedAt?: string };
type SiteLinkState = { loaded: boolean; site: LinkedSite | null };

type WorkspaceRow = WorkspaceRecord & { stats?: WorkspaceListStats };

const healthBadges = {
  Healthy: ["Healthy", "success-light"],
  Warning: ["Needs attention", "warning-light"],
  "Not applicable": ["Not applicable", "outline"],
} as const satisfies Record<WebhookHealth["status"], readonly [string, string]>;

function stateVariant(state: WorkspaceState): "primary-light" | "success-light" | "destructive-light" {
  return state === "Active" ? "success-light" : state === "Archived" ? "destructive-light" : "primary-light";
}
function responseBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}
function timezoneValues(): string[] {
  return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
}
function routingFromWorkspace(workspace: WorkspaceRecord | null): RoutingForm {
  return {
    destinationNumber: workspace?.destinationNumber ?? "",
    recordingEnabled: workspace?.recordingEnabled ?? false,
    analysisEnabled: workspace?.analysisEnabled ?? false,
    spamGateEnabled: workspace?.spamGateEnabled ?? false,
    whisperEnabled: workspace?.whisperEnabled ?? false,
    whisperMessage: workspace?.whisperMessage ?? null,
    disclosureVoice: "Polly.Joanna",
  };
}

export interface WorkspacesViewQuery {
  search: string;
  state: "All" | WorkspaceState;
  page: number;
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
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: initialQuery.page - 1, pageSize });
  const revalidated = useRef(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceRecord | null>(null);
  const [step, setStep] = useState(1);
  const [actionError, setActionError] = useState("");
  const [status, setStatus] = useState("");
  const [resumeHandled, setResumeHandled] = useState(false);
  const [numbers, setNumbers] = useState<AvailableNumber[]>([]);
  const [numbersLoading, setNumbersLoading] = useState(false);
  const [numbersError, setNumbersError] = useState(false);
  const [selectedNumberId, setSelectedNumberId] = useState("");
  const [numberSearch, setNumberSearch] = useState("");
  const [siteLink, setSiteLink] = useState<SiteLinkState>({ loaded: false, site: null });
  const [changingSite, setChangingSite] = useState(false);
  const [routing, setRouting] = useState<RoutingForm>(routingFromWorkspace(null));
  const [flow, setFlow] = useState<FlowResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewIssues, setReviewIssues] = useState<Array<{ code: string; message: string }>>([]);

  const loadWorkspaces = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setFetchError(false);
    const params = new URLSearchParams({ search, state: stateFilter, page: String(pagination.pageIndex + 1), pageSize: String(pageSize) });
    try {
      const response = await fetch(`/api/workspaces?${params}`);
      if (!response.ok) throw new Error("Workspaces unavailable");
      const body = await responseBody(response);
      setResult({
        workspaces: Array.isArray(body.workspaces) ? (body.workspaces as WorkspaceRecord[]) : [],
        total: typeof body.total === "number" ? body.total : 0,
        page: typeof body.page === "number" ? body.page : 1,
        pageSize: typeof body.pageSize === "number" ? body.pageSize : pageSize,
        counts: (body.counts as WorkspaceListResult["counts"]) ?? { setupRequired: 0, active: 0, archived: 0 },
        stats: (body.stats as WorkspaceListWithStats["stats"]) ?? {},
      });
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [pagination.pageIndex, search, stateFilter]);

  const loadNumbers = useCallback(async () => {
    setNumbersLoading(true);
    setNumbersError(false);
    try {
      const response = await fetch("/api/workspaces/numbers");
      if (!response.ok) throw new Error("Numbers unavailable");
      const body = await responseBody(response);
      setNumbers(Array.isArray(body.numbers) ? (body.numbers as AvailableNumber[]) : []);
    } catch {
      setNumbersError(true);
      setNumbers([]);
    } finally {
      setNumbersLoading(false);
    }
  }, []);

  const openCreate = useCallback(() => {
    setWorkspace(null);
    setStep(1);
    setActionError("");
    setReviewError("");
    setReviewIssues([]);
    setRouting(routingFromWorkspace(null));
    setSelectedNumberId("");
    setNumberSearch("");
    setSiteLink({ loaded: false, site: null });
    setChangingSite(false);
    setDialogOpen(true);
  }, []);
  const flowManaged = Boolean(workspace?.publishedFlowVersion);
  const openResume = useCallback((value: WorkspaceRecord) => {
    setWorkspace(value);
    setStep(2);
    setActionError("");
    setReviewError("");
    setReviewIssues([]);
    setRouting(routingFromWorkspace(value));
    setSelectedNumberId("");
    setNumberSearch("");
    setSiteLink({ loaded: false, site: null });
    setChangingSite(false);
    setDialogOpen(true);
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
      if (pagination.pageIndex > 0) url.searchParams.set("page", String(pagination.pageIndex + 1));
      else url.searchParams.delete("page");
      window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    }
    const timer = window.setTimeout(() => void loadWorkspaces(quiet), 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspaces, pagination.pageIndex, search, stateFilter]);
  useEffect(() => {
    if (!dialogOpen || step !== 3) return;
    const timer = window.setTimeout(() => void loadNumbers(), 0);
    return () => window.clearTimeout(timer);
  }, [dialogOpen, loadNumbers, step]);
  useEffect(() => {
    if (!dialogOpen || step !== 2 || !workspace || siteLink.loaded || !cloudflareConnected) return;
    let cancelled = false;
    void fetch(`/api/workspaces/${workspace.id}/site`)
      .then(async (response) => (response.ok ? ((await responseBody(response)).site as LinkedSite | null | undefined) : null))
      .then((site) => {
        if (!cancelled) setSiteLink({ loaded: true, site: site ?? null });
      })
      .catch(() => {
        if (!cancelled) setSiteLink({ loaded: true, site: null });
      });
    return () => {
      cancelled = true;
    };
  }, [cloudflareConnected, dialogOpen, siteLink.loaded, step, workspace]);
  useEffect(() => {
    if (readOnly || !resumeId || resumeHandled || loading) return;
    const listed = result.workspaces.find((item) => item.id === resumeId);
    if (listed) {
      const timer = window.setTimeout(() => {
        openResume(listed);
        setResumeHandled(true);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    void fetch(`/api/workspaces/${resumeId}`)
      .then(async (response) => (response.ok ? ((await responseBody(response)).workspace as WorkspaceRecord) : null))
      .then((value) => {
        if (!cancelled && value) openResume(value);
        if (!cancelled) setResumeHandled(true);
      })
      .catch(() => {
        if (!cancelled) setResumeHandled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loading, openResume, readOnly, result.workspaces, resumeHandled, resumeId]);

  function resetPagination() {
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError("");
    const form = new FormData(event.currentTarget);
    const response = await mutationFetch("/api/workspaces", {
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
    const created = body.workspace as WorkspaceRecord;
    setWorkspace(created);
    setRouting(routingFromWorkspace(created));
    setSiteLink({ loaded: true, site: null });
    setStep(2);
    await loadWorkspaces(true);
  }

  async function nextFromRouting() {
    if (!workspace) return;
    setBusy(true);
    setActionError("");
    const response = await mutationFetch(`/api/workspaces/${workspace.id}/routing`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...routing, analysisEnabled: routing.recordingEnabled && routing.analysisEnabled }),
    }).catch(() => null);
    if (!response) {
      setActionError("Routing settings could not be saved.");
      setBusy(false);
      return;
    }
    const body = await responseBody(response);
    if (!response.ok || !body.workspace) {
      setActionError(response.status === 400 ? "Enter a valid Destination Number." : "Routing settings could not be saved.");
      setBusy(false);
      return;
    }
    setWorkspace(body.workspace as WorkspaceRecord);
    const flowResponse = await fetch(`/api/workspaces/${workspace.id}/flow`).catch(() => null);
    if (!flowResponse?.ok) {
      setActionError("Call Flow could not be loaded.");
      setBusy(false);
      return;
    }
    setFlow((await responseBody(flowResponse)) as FlowResponse);
    setStep(5);
    setBusy(false);
  }

  async function activate() {
    if (!workspace || !selectedNumberId) return;
    setBusy(true);
    setReviewError("");
    const response = await mutationFetch(`/api/workspaces/${workspace.id}/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ twilioNumberId: selectedNumberId }),
    }).catch(() => null);
    if (!response) {
      setReviewError("Workspace could not be activated.");
      setBusy(false);
      return;
    }
    const body = await responseBody(response);
    if (!response.ok) {
      if (response.status === 502) setReviewError("Twilio could not be updated. The Workspace remains Setup Required.");
      else if (response.status === 409 && body.error === "number_unavailable") setReviewError("This number is no longer available.");
      else if (response.status === 422)
        setReviewIssues(Array.isArray(body.issues) ? (body.issues as Array<{ code: string; message: string }>) : []);
      else setReviewError("Workspace could not be activated.");
      setBusy(false);
      return;
    }
    const active = body.workspace as WorkspaceRecord;
    setDialogOpen(false);
    await loadWorkspaces(true);
    setStatus(`${active.name} is Active.`);
    setBusy(false);
  }

  const rows = useMemo(() => result.workspaces.map((workspace): WorkspaceRow => ({ ...workspace, stats: result.stats[workspace.id] })), [result]);
  const columns = useMemo<ColumnDef<DataGridFeatures, WorkspaceRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Workspace",
        cell: ({ row }) => (
          <Link className="font-medium hover:underline" href={`/workspaces/${row.original.id}`} prefetch>
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
      { id: "trackingNumber", header: "Tracking Number", cell: ({ row }) => row.original.trackingNumber ?? "-" },
      { accessorKey: "destinationNumber", header: "Destination Number", cell: ({ row }) => row.original.destinationNumber ?? "-" },
      { id: "calls", header: "Calls (30d)", cell: ({ row }) => <span className="tabular-nums">{row.original.stats?.callsLast30Days ?? "-"}</span> },
      { id: "goodLeads", header: "Good Leads (30d)", cell: ({ row }) => <span className="tabular-nums">{row.original.stats?.goodLeadsLast30Days ?? "-"}</span> },
      {
        id: "lastCall",
        header: "Last Call",
        cell: ({ row }) => {
          const lastCallAt = row.original.stats?.lastCallAt;
          return <span className="font-mono tabular-nums">{lastCallAt ? formatCallTime(lastCallAt, row.original.reportingTimezone) : "-"}</span>;
        },
      },
      {
        id: "integrationHealth",
        header: "Integration health",
        cell: ({ row }) => {
          const health = row.original.stats?.integrationHealth;
          const siteHealth = row.original.stats?.siteHealth;
          if (!health) return "-";
          const siteAttention = siteHealth === "Warning" || siteHealth === "Down";
          const [label, variant] = siteAttention ? healthBadges.Warning : healthBadges[health.status];
          return (
            <span className="flex flex-col gap-0.5">
              <span><Badge variant={variant}>{label}</Badge></span>
              {siteAttention ? <span className="text-xs text-muted-foreground">Site {siteHealth}</span> : null}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            {row.original.state === "Setup Required" && !readOnly ? (
              <Button variant="ghost" size="sm" onClick={() => openResume(row.original)}>
                Resume Setup
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" render={<Link href={`/workspaces/${row.original.id}`} />}>
              Open
            </Button>
          </div>
        ),
      },
    ],
    [openResume, readOnly],
  );
  const table = useTable({
    features: dataGridFeatures,
    data: rows,
    columns,
    getRowId: (row) => row.id,
    state: { pagination },
    onPaginationChange: setPagination,
  });
  const noResults = !fetchError && !loading && result.workspaces.length === 0;
  const activeStep = workspace && step === 1 ? 2 : step;
  const selectedNumber = numbers.find((number) => number.id === selectedNumberId);
  const numberQuery = numberSearch.trim().toLowerCase();
  const visibleNumbers = numbers.filter(
    (number) => number.phoneNumber.toLowerCase().includes(numberQuery) || number.friendlyName.toLowerCase().includes(numberQuery),
  );
  const canActivate = Boolean(flow?.draft);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Workspaces</h1>
        <p className="text-sm text-muted-foreground">
          {readOnly ? null : `${result.counts.setupRequired} Setup Required, `}{result.counts.active} Active, {result.counts.archived} Archived
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
                  {states.map((state) => (
                    <SelectItem key={state} value={state}>
                      {state}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {readOnly ? null : (
              <Button type="button" onClick={openCreate}>
                Create Workspace
              </Button>
            )}
          </div>
          {status ? <p role="status">{status}</p> : null}
          {fetchError ? (
            <div className="flex items-center gap-3">
              <p role="alert">Workspaces are unavailable.</p>
              <Button type="button" variant="outline" onClick={() => void loadWorkspaces()}>
                Retry
              </Button>
            </div>
          ) : null}
          {noResults ? (
            <EmptyState
              data-testid="workspace-empty-state"
              art={search || stateFilter !== "All" ? <NoResultsArt /> : <NoWorkspacesArt />}
              title={search || stateFilter !== "All" ? "No matching Workspaces" : readOnly ? "No Workspaces shared" : "No Workspaces yet"}
              description={
                search || stateFilter !== "All"
                  ? "Clear the search or change the Workspace State filter."
                  : readOnly
                    ? "No Workspaces are shared with you."
                    : "No Workspaces yet. Create a Workspace now; activating it later requires the connected Organization Twilio account."
              }
              action={
                readOnly ? null : (
                  <Button type="button" onClick={openCreate}>
                    Create Workspace
                  </Button>
                )
              }
            />
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
            <DialogTitle>{workspace ? `Resume setup for ${workspace.name}` : "Create Workspace"}</DialogTitle>
            <DialogDescription>Complete the setup steps before activating this Workspace.</DialogDescription>
          </DialogHeader>
          <Stepper value={activeStep} onValueChange={() => undefined}>
            <StepperNav>
              {steps.map((label, index) => (
                <StepperItem key={label} step={index + 1} disabled>
                  <StepperTrigger>
                    <StepperIndicator>{index + 1}</StepperIndicator>
                    <StepperTitle>{label}</StepperTitle>
                  </StepperTrigger>
                  {index < steps.length - 1 ? <StepperSeparator /> : null}
                </StepperItem>
              ))}
            </StepperNav>
            {activeStep === 1 && (
              <div>
                <form className="mt-5 flex flex-col gap-4" onSubmit={(event) => void createWorkspace(event)}>
                  <Field data-invalid={Boolean(actionError)}>
                    <FieldLabel htmlFor="workspace-name">Workspace name</FieldLabel>
                    <Input id="workspace-name" name="name" required maxLength={80} />
                    <FieldError>{actionError}</FieldError>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="workspace-timezone">Reporting timezone</FieldLabel>
                    <Select name="reportingTimezone" defaultValue={initialTimezone}>
                      <SelectTrigger id="workspace-timezone" aria-label="Reporting timezone">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {timezoneValues().map((timezone) => (
                          <SelectItem key={timezone} value={timezone}>
                            {timezone}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>Used for Workspace reporting dates and times.</FieldDescription>
                  </Field>
                  <DialogFooter>
                    <Button type="submit">Create Workspace</Button>
                  </DialogFooter>
                </form>
              </div>
            )}
            {activeStep === 2 && workspace && (
              <div className="mt-5 flex flex-col gap-4">
                {!cloudflareConnected ? (
                  <>
                    <p className="text-sm">
                      Connect the Organization Cloudflare account in Integrations to link a Site. A Workspace needs no Site to activate.{" "}
                      <Link href="/integrations" className="underline">
                        Integrations
                      </Link>
                    </p>
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setStep(3)}>
                        Skip
                      </Button>
                    </DialogFooter>
                  </>
                ) : !siteLink.loaded ? (
                  <p>Loading Site...</p>
                ) : siteLink.site && !changingSite ? (
                  <>
                    <dl className="grid gap-2 text-sm">
                      <div>
                        <dt className="font-medium">Linked Site</dt>
                        <dd className="font-mono">{siteLink.site.primaryHostname}</dd>
                      </div>
                      {siteLink.site.linkedAt ? (
                        <div>
                          <dt className="font-medium">Site Link since</dt>
                          <dd>{formatCallDate(siteLink.site.linkedAt, workspace.reportingTimezone)}</dd>
                        </div>
                      ) : null}
                    </dl>
                    <div className="flex justify-between">
                      <Button type="button" variant="outline" onClick={() => setChangingSite(true)}>
                        Change
                      </Button>
                      <Button type="button" onClick={() => setStep(3)}>
                        Next
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">Link one of the connected account&apos;s Sites to this Workspace, or skip for now.</p>
                    <SitePickerList
                      workspaceId={workspace.id}
                      mode={siteLink.site ? "replace" : "link"}
                      timeZone={workspace.reportingTimezone}
                      onLinked={(site) => {
                        setSiteLink({ loaded: true, site });
                        setChangingSite(false);
                        setStep(3);
                      }}
                      onSkip={() => setStep(3)}
                    />
                  </>
                )}
              </div>
            )}
            {activeStep === 3 && (
              <div className="mt-5 flex flex-col gap-4">
                <p>Tracer will manage the selected number&apos;s voice webhook and keep its current configuration for restoration.</p>
                {numbersError ? (
                  <p role="alert">
                    Connect the Organization Twilio account in Integrations first <Link href="/integrations">Integrations</Link>
                  </p>
                ) : null}
                {numbersLoading ? <p>Loading numbers...</p> : null}
                {numbers.length > 0 ? (
                  <Input
                    type="search"
                    aria-label="Search numbers"
                    placeholder="Search numbers"
                    value={numberSearch}
                    onChange={(event) => setNumberSearch(event.target.value)}
                  />
                ) : null}
                {numbers.length > 0 && visibleNumbers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No numbers match your search.</p>
                ) : null}
                <ScrollArea className="[&>[data-slot=scroll-area-viewport]]:max-h-76">
                  <div className="grid gap-2 pe-3">
                    {visibleNumbers.map((number) => (
                      <label key={number.id} className="flex items-start gap-3 rounded-md border p-3">
                        <input
                          type="radio"
                          aria-label={number.phoneNumber}
                          checked={selectedNumberId === number.id}
                          disabled={Boolean(number.assignedWorkspace)}
                          onChange={() => setSelectedNumberId(number.id)}
                        />
                        <span>
                          <span className="block font-medium">{number.phoneNumber}</span>
                          {number.friendlyName ? <span className="block text-sm text-muted-foreground">{number.friendlyName}</span> : null}
                          {number.assignedWorkspace ? (
                            <span className="block text-sm text-muted-foreground">Assigned to {number.assignedWorkspace.name}</span>
                          ) : null}
                        </span>
                      </label>
                    ))}
                  </div>
                </ScrollArea>
                <div className="flex justify-between">
                  <Button type="button" variant="outline" onClick={() => void loadNumbers()}>
                    Refresh
                  </Button>
                  <Button type="button" onClick={() => setStep(4)} disabled={!selectedNumberId || numbersLoading || numbersError}>
                    Next
                  </Button>
                </div>
              </div>
            )}
            {activeStep === 4 && (
              <div className="mt-5 flex flex-col gap-4">
                <Field data-invalid={Boolean(actionError)}>
                  <FieldLabel htmlFor="destination-number">Destination Number</FieldLabel>
                  <Input
                    id="destination-number"
                    value={routing.destinationNumber}
                    onChange={(event) => setRouting((current) => ({ ...current, destinationNumber: event.target.value }))}
                  />
                  {actionError ? <FieldError>{actionError}</FieldError> : null}
                </Field>
                <label className="flex items-center justify-between">
                  <span>Recording enabled</span>
                  <Switch
                    checked={routing.recordingEnabled}
                    onCheckedChange={(checked) =>
                      setRouting((current) => ({
                        ...current,
                        recordingEnabled: checked,
                        analysisEnabled: checked ? current.analysisEnabled : false,
                      }))
                    }
                  />
                </label>
                {routing.recordingEnabled ? <p className="rounded-md border p-3 text-sm">{recordingDisclosureText}</p> : null}
                <label className="flex items-center justify-between">
                  <span>Analysis enabled</span>
                  <Switch
                    checked={routing.analysisEnabled}
                    disabled={!routing.recordingEnabled}
                    onCheckedChange={(checked) => setRouting((current) => ({ ...current, analysisEnabled: checked }))}
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span>Spam gate enabled</span>
                  <Switch
                    checked={routing.spamGateEnabled}
                    disabled={flowManaged}
                    onCheckedChange={(checked) => setRouting((current) => ({ ...current, spamGateEnabled: checked }))}
                  />
                </label>
                <label className="flex items-center justify-between">
                  <span>Whisper enabled</span>
                  <Switch
                    checked={routing.whisperEnabled}
                    disabled={flowManaged}
                    onCheckedChange={(checked) => setRouting((current) => ({ ...current, whisperEnabled: checked }))}
                  />
                </label>
                {flowManaged && workspace ? (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-muted-foreground">Spam gate and whisper are managed in the published Call Flow.</p>
                    <Button variant="outline" size="sm" render={<Link href={`/workspaces/${workspace.id}/flow`} />}>
                      Edit Flow
                    </Button>
                  </div>
                ) : null}
                {routing.whisperEnabled ? (
                  <Field>
                    <FieldLabel htmlFor="whisper-message">Whisper message</FieldLabel>
                    <Textarea
                      id="whisper-message"
                      disabled={flowManaged}
                      value={routing.whisperMessage ?? ""}
                      onChange={(event) => setRouting((current) => ({ ...current, whisperMessage: event.target.value }))}
                    />
                  </Field>
                ) : null}
                <DialogFooter>
                  <Button type="button" onClick={() => void nextFromRouting()} disabled={busy}>
                    Next
                  </Button>
                </DialogFooter>
              </div>
            )}
            {activeStep === 5 && (
              <div className="mt-5 flex flex-col gap-4">
                <dl className="grid gap-2 text-sm">
                  <div>
                    <dt className="font-medium">Site</dt>
                    <dd className="font-mono">{siteLink.site?.primaryHostname ?? "None"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Number</dt>
                    <dd>
                      {selectedNumber ? (
                        <>
                          <span className="block">{selectedNumber.phoneNumber}</span>
                          {selectedNumber.friendlyName ? (
                            <span className="block text-sm text-muted-foreground">{selectedNumber.friendlyName}</span>
                          ) : null}
                        </>
                      ) : (
                        "-"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">Destination Number</dt>
                    <dd>{routing.destinationNumber || "-"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Recording</dt>
                    <dd>{routing.recordingEnabled ? "Enabled" : "Disabled"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Analysis</dt>
                    <dd>{routing.analysisEnabled ? "Enabled" : "Disabled"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Spam gate</dt>
                    <dd>{routing.spamGateEnabled ? "Enabled" : "Disabled"}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Whisper</dt>
                    <dd>{routing.whisperEnabled ? routing.whisperMessage || "Enabled" : "Disabled"}</dd>
                  </div>
                </dl>
                <div>
                  <h3 className="font-medium">Call Flow</h3>
                  {flow?.draft ? (
                    <FlowSummary graph={flow.draft.graph} />
                  ) : (
                    <p className="text-sm text-muted-foreground">No generated Call Flow.</p>
                  )}
                </div>
                {flow?.validation && !flow.validation.valid ? (
                  <ul role="alert">
                    {flow.validation.issues.map((issue) => (
                      <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
                    ))}
                  </ul>
                ) : null}
                {reviewError ? (
                  <div role="alert">
                    {reviewError}
                    <Button type="button" variant="outline" onClick={() => setStep(3)}>
                      Choose another number
                    </Button>
                  </div>
                ) : null}
                {reviewIssues.length > 0 ? (
                  <ul role="alert">
                    {reviewIssues.map((issue) => (
                      <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
                    ))}
                  </ul>
                ) : null}
                <DialogFooter>
                  <Button type="button" onClick={() => void activate()} disabled={busy}>
                    Create and Activate
                  </Button>
                </DialogFooter>
              </div>
            )}
          </Stepper>
        </DialogContent>
      </Dialog>
    </div>
  );
}
