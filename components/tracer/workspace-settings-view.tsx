/**
 * -------------------------------------------------------------------------
 * @file   workspace-settings-view.tsx
 * @brief  Renders one Workspace settings section behind a vertical rail.
 *
 * @description
 *  Provides General, Site, Forms, Number, Recording and AI, Access, and
 *  Danger settings, each on its own page linked from the rail. The Site page shows
 *  the linked Site with its preview thumbnail, hostname, and Site Link
 *  start, replaces it through the Site picker, or detaches it after
 *  confirmation without changing Cloudflare, edits the Site's Service
 *  Area, Keywords, and Domain renewal, edits the Workspace's Business
 *  beside a map of its city, and adds, edits, or ends the Workspace's
 *  Deal. The Forms page edits the Forwarding Recipients. The
 *  Number page replaces or detaches the Tracking Number. An Archived Workspace keeps only Access and
 *  Restore editable.
 *
 * @remarks
 *  Each section is a separate route so it can be linked and bookmarked.
 *  Detach Number returns the Workspace to Setup Required because an Active
 *  Workspace always has exactly one active Number Assignment.
 *
 * @see
 *  data/workspaces-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/reui/badge";
import { Frame, FramePanel } from "@/components/reui/frame";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/tracer/empty-state";
import { formatCallTime } from "@/components/tracer/call-format";
import { ForwardingRecipientsSettings } from "@/components/tracer/forms-settings";
import { previewImageSrc, SitePickerDialog, SitePreviewThumbnail, siteHealthBadges, type SitePickerMode, type SiteResponse } from "@/components/tracer/site-picker";
import { BusinessAndDealSettings, DomainRenewalSettings } from "@/components/tracer/site-deal-settings";
import SiteSearchSettings, { type SiteSearchSettingsData } from "@/components/tracer/site-search-settings";
import WorkspaceAccessSection from "@/components/tracer/workspace-access-section";
import { workspaceSettingsSections, type WorkspaceSettingsSection } from "@/components/tracer/workspace-settings-sections";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import type { BusinessRecord } from "@/data/business";
import type { DealRecord } from "@/data/deals";
import type { FormSubmissionList } from "@/data/form-submissions";
import type { OperatorRecord } from "@/data/operator-administration";
import type { AvailableNumber } from "@/data/workspace-routing";
import type { WorkspaceRecord } from "@/data/workspaces";

function timezones(): string[] {
  return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
}

export default function WorkspaceSettingsView({
  initialWorkspace,
  section,
  initialAccessUsers,
  initialSite = null,
  initialKeywords = null,
  initialDeal,
  initialBusiness = null,
  initialForms = null,
}: {
  initialWorkspace: WorkspaceRecord;
  section: WorkspaceSettingsSection;
  initialAccessUsers?: OperatorRecord[];
  initialSite?: SiteResponse | null;
  initialKeywords?: SiteSearchSettingsData | null;
  initialDeal?: DealRecord | null;
  initialBusiness?: BusinessRecord | null;
  initialForms?: FormSubmissionList | null;
}) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [site, setSite] = useState<SiteResponse | null>(initialSite);
  const [sitePicker, setSitePicker] = useState<SitePickerMode | null>(null);
  const [confirmDetachSite, setConfirmDetachSite] = useState(false);
  const [siteError, setSiteError] = useState("");
  const [name, setName] = useState(initialWorkspace.name);
  const [timezone, setTimezone] = useState(initialWorkspace.reportingTimezone);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dangerError, setDangerError] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDetach, setConfirmDetach] = useState(false);
  const [detachError, setDetachError] = useState("");
  const [busy, setBusy] = useState(false);
  const [routingError, setRoutingError] = useState("");
  const [recordingEnabled, setRecordingEnabled] = useState(initialWorkspace.recordingEnabled);
  const [analysisEnabled, setAnalysisEnabled] = useState(initialWorkspace.analysisEnabled);
  const [spamGateEnabled, setSpamGateEnabled] = useState(initialWorkspace.spamGateEnabled);
  const [whisperEnabled, setWhisperEnabled] = useState(initialWorkspace.whisperEnabled);
  const [whisperMessage, setWhisperMessage] = useState(initialWorkspace.whisperMessage ?? "");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceNumbers, setReplaceNumbers] = useState<AvailableNumber[]>([]);
  const [replaceNumberId, setReplaceNumberId] = useState("");
  const [replaceError, setReplaceError] = useState("");
  const archived = workspace.state === "Archived";
  const published = Boolean(workspace.publishedFlowVersion);

  async function saveGeneral() {
    setBusy(true);
    setError("");
    const response = await mutationFetch(`/api/workspaces/${workspace.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, reportingTimezone: timezone }),
    }).catch(() => null);
    if (!response?.ok) {
      setError("Workspace settings could not be saved.");
    } else {
      const body = (await response.json()) as { workspace: WorkspaceRecord };
      setWorkspace(body.workspace);
      setName(body.workspace.name);
      setTimezone(body.workspace.reportingTimezone);
      setMessage("Workspace settings saved.");
    }
    setBusy(false);
  }

  async function openReplace() {
    setReplaceOpen(true);
    setReplaceNumberId("");
    setReplaceError("");
    const response = await fetch("/api/workspaces/numbers").catch(() => null);
    if (!response?.ok) {
      setReplaceNumbers([]);
      setReplaceError("Twilio numbers could not be loaded.");
      return;
    }
    const body = (await response.json()) as { numbers: AvailableNumber[] };
    setReplaceNumbers(body.numbers);
  }

  async function replaceNumber() {
    setBusy(true);
    setReplaceError("");
    const response = await mutationFetch(`/api/workspaces/${workspace.id}/replace-number`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ twilioNumberId: replaceNumberId }),
    }).catch(() => null);
    if (!response?.ok) {
      setReplaceError(
        response?.status === 409
          ? "That number is no longer available. Choose another number."
          : "Twilio could not complete the replacement. The current Tracking Number is unchanged.",
      );
    } else {
      const body = (await response.json()) as { workspace: WorkspaceRecord };
      setWorkspace(body.workspace);
      setReplaceOpen(false);
      setMessage("Tracking Number replaced.");
    }
    setBusy(false);
  }

  async function archive() {
    setBusy(true);
    setDangerError("");
    const response = await mutationFetch(`/api/workspaces/${workspace.id}/archive`, { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      setDangerError(
        response?.status === 502
          ? "Twilio configuration could not be restored. The Workspace remains Active."
          : "Workspace could not be archived.",
      );
    } else {
      const body = (await response.json()) as { workspace: WorkspaceRecord };
      setWorkspace(body.workspace);
      setConfirmArchive(false);
      setMessage("Workspace archived.");
    }
    setBusy(false);
  }

  async function saveRouting() {
    setBusy(true);
    setRoutingError("");
    const response = await mutationFetch(`/api/workspaces/${workspace.id}/routing`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        destinationNumber: workspace.destinationNumber ?? "",
        recordingEnabled,
        analysisEnabled: recordingEnabled && analysisEnabled,
        spamGateEnabled,
        whisperEnabled,
        whisperMessage,
      }),
    }).catch(() => null);
    if (!response?.ok) {
      setRoutingError(
        response?.status === 409
          ? "Publish a Call Flow with a Recording Disclosure before enabling recording."
          : "Routing settings could not be saved.",
      );
    } else {
      const body = (await response.json()) as { workspace: WorkspaceRecord };
      setWorkspace(body.workspace);
      setMessage("Routing settings saved.");
    }
    setBusy(false);
  }

  async function detachNumber() {
    setBusy(true);
    setDetachError("");
    const response = await mutationFetch(`/api/workspaces/${workspace.id}/detach-number`, { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      setDetachError(
        response?.status === 502
          ? "Twilio configuration could not be restored. The Workspace remains Active on its current Tracking Number."
          : "The Tracking Number could not be detached.",
      );
    } else {
      const body = (await response.json()) as { workspace: WorkspaceRecord };
      setWorkspace(body.workspace);
      setMessage("Tracking Number detached. Activate the Workspace on a number to resume routing.");
    }
    setConfirmDetach(false);
    setBusy(false);
  }

  async function detachSite() {
    setBusy(true);
    setSiteError("");
    const response = await mutationFetch(`/api/workspaces/${workspace.id}/site/detach`, { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      setSiteError("The Site could not be detached.");
    } else {
      setSite(null);
      setMessage("Site detached.");
    }
    setConfirmDetachSite(false);
    setBusy(false);
  }

  async function restore() {
    setBusy(true);
    setDangerError("");
    const response = await mutationFetch(`/api/workspaces/${workspace.id}/restore`, { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      setDangerError("Workspace could not be restored.");
    } else {
      const body = (await response.json()) as { workspace: WorkspaceRecord };
      setWorkspace(body.workspace);
      setMessage("Workspace restored to Setup Required.");
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{workspace.name} Settings</h1>
        <div className="mt-2 flex items-center gap-3">
          <Badge
            variant={
              workspace.state === "Archived" ? "destructive-light" : workspace.state === "Active" ? "success-light" : "primary-light"
            }
          >
            {workspace.state}
          </Badge>
          {message ? <p role="status" className="text-sm">{message}</p> : null}
        </div>
      </div>
      <Frame>
        <FramePanel className="grid gap-6 md:grid-cols-[12rem_1fr]">
          <nav aria-label="Workspace settings sections" className="flex gap-1 overflow-x-auto md:flex-col">
            {workspaceSettingsSections.map((item) => (
              <Link
                key={item.slug}
                href={`/workspaces/${workspace.id}/settings/${item.slug}`}
                prefetch
                aria-current={item.slug === section ? "page" : undefined}
                className={buttonVariants({ variant: item.slug === section ? "secondary" : "ghost", className: "justify-start whitespace-nowrap" })}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex flex-col gap-8">
            {section === "general" ? (
              <section id="general">
                <h2 className="font-semibold">General</h2>
                <p className="mb-4 text-sm text-muted-foreground">Workspace identity and reporting timezone.</p>
                <div className="grid gap-4">
                  <Field data-invalid={Boolean(error)}>
                    <FieldLabel htmlFor="settings-workspace-name">Workspace name</FieldLabel>
                    <Input
                      id="settings-workspace-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      maxLength={80}
                      disabled={archived}
                    />
                    {error ? <FieldError>{error}</FieldError> : null}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="settings-workspace-timezone">Reporting timezone</FieldLabel>
                    <Select value={timezone} onValueChange={(value) => setTimezone(value ?? timezone)} disabled={archived}>
                      <SelectTrigger id="settings-workspace-timezone" aria-label="Reporting timezone">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {timezones().map((value) => (
                          <SelectItem key={value} value={value}>
                            {value}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  {archived ? <p className="text-sm text-muted-foreground">Restore this Workspace to edit its settings.</p> : null}
                  <div>
                    <Button type="button" onClick={() => void saveGeneral()} disabled={busy || archived}>
                      Save changes
                    </Button>
                  </div>
                </div>
              </section>
            ) : null}
            {section === "site" ? (
              <section id="site">
                <h2 className="font-semibold">Site</h2>
                <p className="mb-4 text-sm text-muted-foreground">The Cloudflare Site linked to this Workspace. Linking, replacing, and detaching never change Cloudflare.</p>
                {siteError ? <p role="alert" className="mb-3 text-sm">{siteError}</p> : null}
                {site ? (
                  <div className="grid gap-4">
                    <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
                      <SitePreviewThumbnail src={site.latestPreview ? previewImageSrc(workspace.id, site.latestPreview.capturedAt) : null} alt={`Preview of ${site.primaryHostname}`} />
                      <div className="grid content-start gap-3 text-sm">
                        <p>
                          <span className="font-medium">Primary hostname: </span>
                          <span className="font-mono">{site.primaryHostname}</span>
                        </p>
                        <p>
                          <span className="font-medium">Site Link since: </span>
                          {formatCallTime(site.linkedAt, workspace.reportingTimezone)}
                        </p>
                        <p className="flex items-center gap-2">
                          <span className="font-medium">Site Health: </span>
                          <Badge variant={siteHealthBadges[site.health][1]}>{siteHealthBadges[site.health][0]}</Badge>
                        </p>
                        <Link className="underline" href={`/workspaces/${workspace.id}/site`} prefetch>
                          View Site
                        </Link>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" disabled={busy} onClick={() => setSitePicker("replace")}>
                        Replace Site
                      </Button>
                      <Button type="button" variant="destructive" disabled={busy} onClick={() => setConfirmDetachSite(true)}>
                        Detach Site
                      </Button>
                    </div>
                    {initialKeywords && initialSite?.id === site.id ? (
                      <SiteSearchSettings key={site.id} workspaceId={workspace.id} initial={initialKeywords} onMessage={setMessage} />
                    ) : null}
                    {site.domain && initialSite?.id === site.id ? <DomainRenewalSettings key={`domain-${site.id}`} workspaceId={workspace.id} initial={site.domain} onMessage={setMessage} /> : null}
                  </div>
                ) : (
                  <EmptyState
                    title="No Site is linked to this Workspace"
                    description="Link one of the connected Cloudflare account's Sites to see its preview, traffic, performance, and health in this Workspace."
                    action={
                      <Button type="button" onClick={() => setSitePicker("link")}>
                        Link Site
                      </Button>
                    }
                  />
                )}
                {initialDeal !== undefined ? (
                  <div className="mt-8">
                    <BusinessAndDealSettings workspaceId={workspace.id} initialBusiness={initialBusiness} initialDeal={initialDeal} onMessage={setMessage} />
                  </div>
                ) : null}
              </section>
            ) : null}
            {section === "forms" ? (
              <section id="forms" className="flex flex-col gap-8">
                <div>
                  <h2 className="font-semibold">Forms</h2>
                  <p className="text-sm text-muted-foreground">Where the linked Site&apos;s Form Submissions are forwarded. The Forms key every Site posts with is managed on Integrations.</p>
                </div>
                {initialForms ? (
                  <ForwardingRecipientsSettings workspaceId={workspace.id} initial={initialForms.forwardTo ?? []} hostname={initialForms.site?.primaryHostname ?? null} onMessage={setMessage} />
                ) : (
                  <p role="alert" className="text-sm">The Forms settings are unavailable. Reload to try again.</p>
                )}
              </section>
            ) : null}
            {section === "number" ? (
              <section id="number">
                <h2 className="font-semibold">Number</h2>
                <p className="mb-4 text-sm text-muted-foreground">Active Tracking Number and Destination Number.</p>
                <div className="grid gap-3 text-sm">
                  <p>
                    <span className="font-medium">Tracking Number: </span>
                    {workspace.trackingNumber ?? "No Tracking Number"}
                  </p>
                  <p>
                    <span className="font-medium">Number Assignment start: </span>
                    {workspace.numberAssignmentStartedAt ?? "-"}
                  </p>
                  <p>
                    <span className="font-medium">Destination Number: </span>
                    {workspace.destinationNumber ?? "-"}
                  </p>
                  {workspace.state === "Setup Required" ? (
                    <Link className="underline" href={`/workspaces?resume=${workspace.id}`}>
                      Resume Setup
                    </Link>
                  ) : published ? (
                    <Link className="underline" href={`/workspaces/${workspace.id}/flow`}>
                      Edit the Destination Number in the Call Flow
                    </Link>
                  ) : null}
                  {detachError ? <p role="alert">{detachError}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" disabled={workspace.state !== "Active" || busy} onClick={() => void openReplace()}>
                      Replace Number
                    </Button>
                    <Button type="button" variant="destructive" disabled={workspace.state !== "Active" || busy} onClick={() => setConfirmDetach(true)}>
                      Detach Number
                    </Button>
                  </div>
                  {workspace.state === "Active" ? null : <p className="text-xs text-muted-foreground">Available for an Active Workspace</p>}
                </div>
              </section>
            ) : null}
            {section === "recording" ? (
              <section id="recording-and-ai">
                <h2 className="font-semibold">Recording and AI</h2>
                <div className="grid gap-4">
                  {routingError ? <p role="alert">{routingError}</p> : null}
                  <label className="flex items-center justify-between">
                    <span>Recording enabled</span>
                    <Switch
                      checked={recordingEnabled}
                      disabled={archived}
                      onCheckedChange={(checked) => {
                        setRecordingEnabled(checked);
                        if (!checked) setAnalysisEnabled(false);
                      }}
                    />
                  </label>
                  <label className="flex items-center justify-between">
                    <span>Analysis enabled</span>
                    <Switch checked={analysisEnabled} disabled={archived || !recordingEnabled} onCheckedChange={setAnalysisEnabled} />
                  </label>
                  <label className="flex items-center justify-between">
                    <span>Spam gate enabled</span>
                    <Switch checked={spamGateEnabled} disabled={archived || published} onCheckedChange={setSpamGateEnabled} />
                  </label>
                  <label className="flex items-center justify-between">
                    <span>Whisper enabled</span>
                    <Switch checked={whisperEnabled} disabled={archived || published} onCheckedChange={setWhisperEnabled} />
                  </label>
                  {published && <p className="text-sm text-muted-foreground">Managed in the Call Flow</p>}
                  {whisperEnabled ? (
                    <Textarea
                      aria-label="Whisper message"
                      value={whisperMessage}
                      disabled={archived || published}
                      onChange={(event) => setWhisperMessage(event.target.value)}
                    />
                  ) : null}
                  <div>
                    <Button type="button" onClick={() => void saveRouting()} disabled={busy || archived}>
                      Save Recording and AI
                    </Button>
                  </div>
                </div>
              </section>
            ) : null}
            {section === "access" ? <WorkspaceAccessSection workspace={workspace} initialUsers={initialAccessUsers} /> : null}
            {section === "danger" ? (
              <section id="danger">
                <h2 className="font-semibold">Danger</h2>
                <p className="mb-4 text-sm text-muted-foreground">
                  Archiving restores the prior Twilio voice configuration and stops Tracer routing.
                </p>
                {dangerError ? <p role="alert" className="mb-3 text-sm">{dangerError}</p> : null}
                {workspace.state === "Archived" ? (
                  <Button type="button" onClick={() => void restore()} disabled={busy}>
                    Restore
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setConfirmArchive(true)}
                    disabled={busy || workspace.state === "Active"}
                  >
                    Archive Workspace
                  </Button>
                )}
              </section>
            ) : null}
          </div>
        </FramePanel>
      </Frame>
      <Dialog open={replaceOpen} onOpenChange={setReplaceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace Tracking Number</DialogTitle>
            <DialogDescription>
              Tracer moves the voice webhook to the selected number and restores the current number&apos;s previous Twilio configuration. Call history keeps the number each Call dialed.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {replaceNumbers.map((number) => (
              <label key={number.id} className="flex items-start gap-3 rounded-md border p-3">
                <input
                  type="radio"
                  aria-label={number.phoneNumber}
                  checked={replaceNumberId === number.id}
                  disabled={Boolean(number.assignedWorkspace)}
                  onChange={() => setReplaceNumberId(number.id)}
                />
                <span>
                  <span className="block font-medium">{number.phoneNumber}</span>
                  {number.friendlyName ? <span className="block text-sm text-muted-foreground">{number.friendlyName}</span> : null}
                  {number.assignedWorkspace ? <span className="block text-sm text-muted-foreground">Assigned to {number.assignedWorkspace.name}</span> : null}
                </span>
              </label>
            ))}
          </div>
          {replaceError ? <p role="alert">{replaceError}</p> : null}
          <DialogFooter>
            <Button type="button" disabled={!replaceNumberId || busy} onClick={() => void replaceNumber()}>
              Confirm Replacement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SitePickerDialog
        open={sitePicker !== null}
        onOpenChange={(open) => setSitePicker(open ? (sitePicker ?? "link") : null)}
        workspaceId={workspace.id}
        mode={sitePicker ?? "link"}
        timeZone={workspace.reportingTimezone}
        onLinked={(linked) => {
          setSite(linked);
          setMessage(sitePicker === "replace" ? "Site replaced." : "Site linked.");
        }}
      />

      <AlertDialog open={confirmDetachSite} onOpenChange={setConfirmDetachSite}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Detach {site?.primaryHostname}?</AlertDialogTitle>
            <AlertDialogDescription>
              The Site Link ends and this Workspace stops showing the Site. Cloudflare is not changed, the Site stays on the connected account, and it can be linked again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy} onClick={() => void detachSite()}>
              Detach Site
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDetach} onOpenChange={setConfirmDetach}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Detach {workspace.trackingNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              Tracer stops routing Calls on this number, restores its previous Twilio voice configuration, and returns the Workspace to
              Setup Required. The number stays in your Twilio account and Call history is kept. Client Viewers cannot open the Workspace
              until it is activated on a number again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy} onClick={() => void detachNumber()}>
              Detach Number
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {workspace.name}?</AlertDialogTitle>
            <AlertDialogDescription>This Workspace will move to Archived. Twilio configuration will not be changed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void archive()}>Archive Workspace</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
