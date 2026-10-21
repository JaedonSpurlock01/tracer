/**
 * -------------------------------------------------------------------------
 * @file   workspace-setup-wizard.tsx
 * @brief  Guides an Operator through Workspace setup and activation.
 *
 * @description
 *  A focused Dialog with the Basics, Site, Number, Routing, and Review
 *  steps. Creating opens on Basics; resuming a Setup Required Workspace
 *  opens on Site. The Site step links a Site right after the Workspace
 *  record exists, can always be skipped, explains a disconnected Cloudflare
 *  account, and shows the current Site Link read-only with Change on
 *  resume. Review activates the Workspace and reports the outcome through
 *  onActivated; the list that hosts the wizard owns refreshing itself.
 *
 * @remarks
 *  The wizard owns every step's state and fetch. Mount it with a fresh key
 *  per opening so a new creation or resume starts clean. Number selection
 *  remains local until activation, while routing and flow validation use
 *  the Workspace HTTP boundaries.
 *
 * @see
 *  components/tracer/workspaces-view.tsx
 *  data/workspaces-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/reui/stepper";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import FlowSummary from "@/components/tracer/flow/flow-summary";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import { SitePickerList } from "@/components/tracer/site-picker";
import { formatCallDate } from "@/components/tracer/call-format";
import { recordingDisclosureText, ttsVoices, type CallFlowGraph } from "@/data/call-flow";
import type { WorkspaceRecord } from "@/data/workspaces";

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

export interface WorkspaceSetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The Setup Required Workspace to resume, or null to create one. */
  workspace: WorkspaceRecord | null;
  initialTimezone: string;
  cloudflareConnected: boolean;
  /** The Workspace record now exists; the host list should refresh. */
  onCreated: (workspace: WorkspaceRecord) => void;
  /** Activation succeeded and the wizard has closed. */
  onActivated: (workspace: WorkspaceRecord) => void;
}

export default function WorkspaceSetupWizard({ open, onOpenChange, workspace: initialWorkspace, initialTimezone, cloudflareConnected, onCreated, onActivated }: WorkspaceSetupWizardProps) {
  const [workspace, setWorkspace] = useState<WorkspaceRecord | null>(initialWorkspace);
  const [step, setStep] = useState(initialWorkspace ? 2 : 1);
  const [actionError, setActionError] = useState("");
  const [numbers, setNumbers] = useState<AvailableNumber[]>([]);
  const [numbersLoading, setNumbersLoading] = useState(false);
  const [numbersError, setNumbersError] = useState(false);
  const [selectedNumberId, setSelectedNumberId] = useState("");
  const [numberSearch, setNumberSearch] = useState("");
  const [siteLink, setSiteLink] = useState<SiteLinkState>({ loaded: false, site: null });
  const [changingSite, setChangingSite] = useState(false);
  const [routing, setRouting] = useState<RoutingForm>(routingFromWorkspace(initialWorkspace));
  const [flow, setFlow] = useState<FlowResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewIssues, setReviewIssues] = useState<Array<{ code: string; message: string }>>([]);
  const flowManaged = Boolean(workspace?.publishedFlowVersion);

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

  useEffect(() => {
    if (!open || step !== 3) return;
    const timer = window.setTimeout(() => void loadNumbers(), 0);
    return () => window.clearTimeout(timer);
  }, [open, loadNumbers, step]);
  useEffect(() => {
    if (!open || step !== 2 || !workspace || siteLink.loaded || !cloudflareConnected) return;
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
  }, [cloudflareConnected, open, siteLink.loaded, step, workspace]);

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
    onCreated(created);
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
    setBusy(false);
    onOpenChange(false);
    onActivated(body.workspace as WorkspaceRecord);
  }

  const selectedNumber = numbers.find((number) => number.id === selectedNumberId);
  const numberQuery = numberSearch.trim().toLowerCase();
  const visibleNumbers = numbers.filter(
    (number) => number.phoneNumber.toLowerCase().includes(numberQuery) || number.friendlyName.toLowerCase().includes(numberQuery),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initialWorkspace ? `Resume setup for ${initialWorkspace.name}` : "Create Workspace"}</DialogTitle>
          <DialogDescription>Complete the setup steps before activating this Workspace.</DialogDescription>
        </DialogHeader>
        <Stepper value={step} onValueChange={() => undefined}>
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
          {step === 1 && (
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
          {step === 2 && workspace && (
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
          {step === 3 && (
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
          {step === 4 && (
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
          {step === 5 && (
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
  );
}
