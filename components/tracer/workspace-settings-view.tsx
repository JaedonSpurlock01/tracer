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
 *  When a number left the Workspace without its Twilio voice settings
 *  restored (an Unreadable credential or a forced disconnect), the Number
 *  page says so until the number is attached again.
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
import { useId, useState } from "react";

import { Badge } from "@/components/reui/badge";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/tracer/empty-state";
import { ActionButton, SettingsSection, SwitchField, useAction } from "@/components/tracer/form-parts";
import { FactList, PageHeader } from "@/components/tracer/page-parts";
import { formatCallTime } from "@/components/tracer/call-format";
import { ForwardingRecipientsSettings } from "@/components/tracer/forms-settings";
import { previewImageSrc, SitePickerDialog, SitePreviewThumbnail, siteHealthBadges, type SitePickerMode, type SiteResponse } from "@/components/tracer/site-picker";
import { BusinessAndDealSettings, DomainRenewalSettings } from "@/components/tracer/site-deal-settings";
import SiteSearchSettings, { type SiteSearchSettingsData } from "@/components/tracer/site-search-settings";
import WorkspaceAccessSection from "@/components/tracer/workspace-access-section";
import { workspaceSettingsSections, type WorkspaceSettingsSection } from "@/components/tracer/workspace-settings-sections";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import { StatusMessage, useStatusMessage } from "@/components/tracer/status-message";
import type { BusinessRecord } from "@/data/business";
import type { DealRecord } from "@/data/deals";
import type { FormSubmissionList } from "@/data/form-submissions";
import type { OperatorRecord } from "@/data/operator-administration";
import type { AvailableNumber } from "@/data/workspace-routing";
import type { WorkspaceRecord } from "@/data/workspaces";

const stateBadges = { Active: "success-light", "Setup Required": "primary-light", Archived: "destructive-light" } as const;

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
  const [siteLinkMessage, setSiteLinkMessage] = useStatusMessage();
  const [confirmDetachSite, setConfirmDetachSite] = useState(false);
  const [name, setName] = useState(initialWorkspace.name);
  const [timezone, setTimezone] = useState(initialWorkspace.reportingTimezone);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDetach, setConfirmDetach] = useState(false);
  const [recordingEnabled, setRecordingEnabled] = useState(initialWorkspace.recordingEnabled);
  const [analysisEnabled, setAnalysisEnabled] = useState(initialWorkspace.analysisEnabled);
  const [spamGateEnabled, setSpamGateEnabled] = useState(initialWorkspace.spamGateEnabled);
  const [whisperEnabled, setWhisperEnabled] = useState(initialWorkspace.whisperEnabled);
  const [whisperMessage, setWhisperMessage] = useState(initialWorkspace.whisperMessage ?? "");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceNumbers, setReplaceNumbers] = useState<AvailableNumber[]>([]);
  const [replaceNumberId, setReplaceNumberId] = useState("");
  const [numbersError, setNumbersError] = useState("");
  const generalSave = useAction();
  const routingSave = useAction();
  const replace = useAction();
  const detach = useAction();
  const siteDetach = useAction();
  const lifecycle = useAction();
  const numberNote = useId();
  const archived = workspace.state === "Archived";
  const published = Boolean(workspace.publishedFlowVersion);
  const restoreFirst = archived ? "Restore this Workspace to edit its settings." : null;
  const activeOnly = workspace.state === "Active" ? null : "Available for an Active Workspace.";

  function saveGeneral() {
    return generalSave.run(async () => {
      const response = await mutationFetch(`/api/workspaces/${workspace.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, reportingTimezone: timezone }),
      }).catch(() => null);
      if (!response?.ok) return { error: "Workspace settings could not be saved." };
      const body = (await response.json()) as { workspace: WorkspaceRecord };
      setWorkspace(body.workspace);
      setName(body.workspace.name);
      setTimezone(body.workspace.reportingTimezone);
      return { message: "Workspace settings saved." };
    });
  }

  async function openReplace() {
    setReplaceOpen(true);
    setReplaceNumberId("");
    setNumbersError("");
    const response = await fetch("/api/workspaces/numbers").catch(() => null);
    if (!response?.ok) {
      setReplaceNumbers([]);
      setNumbersError("Twilio numbers could not be loaded.");
      return;
    }
    const body = (await response.json()) as { numbers: AvailableNumber[] };
    setReplaceNumbers(body.numbers);
  }

  function replaceNumber() {
    return replace.run(async () => {
      const response = await mutationFetch(`/api/workspaces/${workspace.id}/replace-number`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ twilioNumberId: replaceNumberId }),
      }).catch(() => null);
      if (!response?.ok) {
        return {
          error:
            response?.status === 409
              ? "That number is no longer available. Choose another number."
              : "Twilio could not complete the replacement. The current Tracking Number is unchanged.",
        };
      }
      const body = (await response.json()) as { workspace: WorkspaceRecord };
      setWorkspace(body.workspace);
      setReplaceOpen(false);
      return { message: "Tracking Number replaced." };
    });
  }

  function archive() {
    return lifecycle.run(async () => {
      const response = await mutationFetch(`/api/workspaces/${workspace.id}/archive`, { method: "POST" }).catch(() => null);
      if (!response?.ok) {
        return { error: response?.status === 502 ? "Twilio configuration could not be restored. The Workspace remains Active." : "Workspace could not be archived." };
      }
      const body = (await response.json()) as { workspace: WorkspaceRecord };
      setWorkspace(body.workspace);
      setConfirmArchive(false);
      return { message: "Workspace archived." };
    });
  }

  function saveRouting() {
    return routingSave.run(async () => {
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
        return { error: response?.status === 409 ? "Publish a Call Flow with a Recording Disclosure before enabling recording." : "Routing settings could not be saved." };
      }
      const body = (await response.json()) as { workspace: WorkspaceRecord };
      setWorkspace(body.workspace);
      return { message: "Routing settings saved." };
    });
  }

  function detachNumber() {
    return detach.run(async () => {
      const response = await mutationFetch(`/api/workspaces/${workspace.id}/detach-number`, { method: "POST" }).catch(() => null);
      if (!response?.ok) {
        return {
          error:
            response?.status === 502
              ? "Twilio configuration could not be restored. The Workspace remains Active on its current Tracking Number."
              : "The Tracking Number could not be detached.",
        };
      }
      const body = (await response.json()) as { workspace: WorkspaceRecord };
      setWorkspace(body.workspace);
      setConfirmDetach(false);
      return { message: "Tracking Number detached. Activate the Workspace on a number to resume routing." };
    });
  }

  function detachSite() {
    return siteDetach.run(async () => {
      const response = await mutationFetch(`/api/workspaces/${workspace.id}/site/detach`, { method: "POST" }).catch(() => null);
      if (!response?.ok) return { error: "The Site could not be detached." };
      setSite(null);
      setConfirmDetachSite(false);
      return { message: "Site detached." };
    });
  }

  function restore() {
    return lifecycle.run(async () => {
      const response = await mutationFetch(`/api/workspaces/${workspace.id}/restore`, { method: "POST" }).catch(() => null);
      if (!response?.ok) return { error: "Workspace could not be restored." };
      const body = (await response.json()) as { workspace: WorkspaceRecord };
      setWorkspace(body.workspace);
      return { message: "Workspace restored to Setup Required." };
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <PageHeader
        title={`${workspace.name} Settings`}
        description={<Badge variant={stateBadges[workspace.state]}>{workspace.state}</Badge>}
      />
      <div className="grid items-start gap-5 md:grid-cols-[12rem_1fr]">
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
        <div className="flex min-w-0 flex-col gap-5">
          {section === "general" ? (
            <SettingsSection
              id="general"
              title="General"
              description="Workspace identity and reporting timezone."
              footer={
                <ActionButton type="button" action={generalSave} unavailable={restoreFirst} onClick={() => void saveGeneral()}>
                  Save changes
                </ActionButton>
              }
            >
              <FactList facts={[{ label: "Workspace State", value: workspace.state }]} />
              <Field>
                <FieldLabel htmlFor="settings-workspace-name">Workspace name</FieldLabel>
                <Input
                  id="settings-workspace-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  disabled={archived}
                />
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
            </SettingsSection>
          ) : null}
          {section === "site" ? (
            <>
              <SettingsSection
                id="site"
                title="Site"
                description="The Cloudflare Site linked to this Workspace. Linking, replacing, and detaching never change Cloudflare."
                footer={
                  site ? (
                    <>
                      <Button type="button" variant="outline" onClick={() => setSitePicker("replace")}>
                        Replace Site
                      </Button>
                      <ActionButton type="button" variant="destructive" action={siteDetach} onClick={() => setConfirmDetachSite(true)}>
                        Detach Site
                      </ActionButton>
                      <StatusMessage status={siteLinkMessage} className="text-sm text-muted-foreground" />
                    </>
                  ) : null
                }
              >
                {site ? null : <StatusMessage status={siteDetach.status} className="text-sm text-muted-foreground" />}
                {site ? (
                  <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
                    <SitePreviewThumbnail src={site.latestPreview ? previewImageSrc(workspace.id, site.latestPreview.capturedAt) : null} alt={`Preview of ${site.primaryHostname}`} />
                    <div className="flex flex-col gap-3">
                      <FactList
                        facts={[
                          { label: "Primary hostname", value: site.primaryHostname, mono: true },
                          { label: "Site Link since", value: formatCallTime(site.linkedAt, workspace.reportingTimezone) },
                          { label: "Site Health", value: <Badge variant={siteHealthBadges[site.health][1]}>{siteHealthBadges[site.health][0]}</Badge> },
                        ]}
                      />
                      <Link className="text-sm underline" href={`/workspaces/${workspace.id}/site`} prefetch>
                        View Site
                      </Link>
                    </div>
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
              </SettingsSection>
              {site && initialKeywords && initialSite?.id === site.id ? (
                <SiteSearchSettings key={site.id} workspaceId={workspace.id} initial={initialKeywords} />
              ) : null}
              {site?.domain && initialSite?.id === site.id ? <DomainRenewalSettings key={`domain-${site.id}`} workspaceId={workspace.id} initial={site.domain} /> : null}
              {initialDeal !== undefined ? (
                <BusinessAndDealSettings workspaceId={workspace.id} initialBusiness={initialBusiness} initialDeal={initialDeal} />
              ) : null}
            </>
          ) : null}
          {section === "forms" ? (
            initialForms ? (
              <ForwardingRecipientsSettings workspaceId={workspace.id} initial={initialForms.forwardTo ?? []} hostname={initialForms.site?.primaryHostname ?? null} />
            ) : (
              <SettingsSection id="forms" title="Forwarding Recipients">
                <p role="alert" className="text-sm">The Forms settings are unavailable. Reload to try again.</p>
              </SettingsSection>
            )
          ) : null}
          {section === "number" ? (
            <SettingsSection
              id="number"
              title="Number"
              description="Active Tracking Number and Destination Number."
              footer={
                <>
                  <ActionButton
                    type="button"
                    variant="outline"
                    action={replace}
                    disabled={Boolean(activeOnly)}
                    aria-describedby={activeOnly ? numberNote : undefined}
                    onClick={() => void openReplace()}
                  >
                    Replace Number
                  </ActionButton>
                  <ActionButton
                    type="button"
                    variant="destructive"
                    action={detach}
                    disabled={Boolean(activeOnly)}
                    aria-describedby={activeOnly ? numberNote : undefined}
                    onClick={() => setConfirmDetach(true)}
                  >
                    Detach Number
                  </ActionButton>
                  {activeOnly ? (
                    <p id={numberNote} className="text-xs text-muted-foreground">
                      {activeOnly}
                    </p>
                  ) : null}
                </>
              }
            >
              <FactList
                className="sm:grid-cols-3"
                facts={[
                  { label: "Tracking Number", value: workspace.trackingNumber, empty: "No Tracking Number", mono: true },
                  {
                    label: "Number Assignment start",
                    value: workspace.numberAssignmentStartedAt ? formatCallTime(workspace.numberAssignmentStartedAt, workspace.reportingTimezone) : null,
                    empty: "Not assigned",
                  },
                  { label: "Destination Number", value: workspace.destinationNumber, empty: "No Destination Number", mono: true },
                ]}
              />
              {workspace.state === "Setup Required" ? (
                <Link className="text-sm underline" href={`/workspaces?resume=${workspace.id}`}>
                  Resume Setup
                </Link>
              ) : published ? (
                <Link className="text-sm underline" href={`/workspaces/${workspace.id}/flow`}>
                  Edit the Destination Number in the Call Flow
                </Link>
              ) : null}
              {workspace.voiceRestoreNeeded ? (
                <p role="alert" className="text-sm text-warning">
                  Tracer could not restore {workspace.voiceRestoreNeeded} in Twilio. Clear its voice URL in the Twilio console or attach it to a Workspace again.
                </p>
              ) : null}
            </SettingsSection>
          ) : null}
          {section === "recording" ? (
            <SettingsSection
              id="recording-and-ai"
              title="Recording and AI"
              description="What Tracer records and analyzes on this Workspace's Calls."
              footer={
                <ActionButton type="button" action={routingSave} unavailable={restoreFirst} onClick={() => void saveRouting()}>
                  Save Recording and AI
                </ActionButton>
              }
            >
              <SwitchField
                label="Recording enabled"
                description="Records each answered Call after the Recording Disclosure plays."
                checked={recordingEnabled}
                disabled={archived}
                onCheckedChange={(checked) => {
                  setRecordingEnabled(checked);
                  if (!checked) setAnalysisEnabled(false);
                }}
              />
              <SwitchField
                label="Analysis enabled"
                description="Transcribes Recordings with at least 15 seconds of speech and assesses each Lead. Needs recording."
                checked={analysisEnabled}
                disabled={archived || !recordingEnabled}
                onCheckedChange={setAnalysisEnabled}
              />
              <SwitchField
                label="Spam gate enabled"
                description="Asks callers to press a key before the Call is forwarded."
                checked={spamGateEnabled}
                disabled={archived || published}
                onCheckedChange={setSpamGateEnabled}
              />
              <SwitchField
                label="Whisper enabled"
                description="Plays a short message to whoever answers before the caller is connected."
                checked={whisperEnabled}
                disabled={archived || published}
                onCheckedChange={setWhisperEnabled}
              />
              {published && <p className="text-sm text-muted-foreground">Managed in the Call Flow</p>}
              {whisperEnabled ? (
                <Textarea
                  aria-label="Whisper message"
                  value={whisperMessage}
                  disabled={archived || published}
                  onChange={(event) => setWhisperMessage(event.target.value)}
                />
              ) : null}
            </SettingsSection>
          ) : null}
          {section === "access" ? <WorkspaceAccessSection workspace={workspace} initialUsers={initialAccessUsers} /> : null}
          {section === "danger" ? (
            <SettingsSection
              id="danger"
              title="Danger"
              description="Archiving restores the prior Twilio voice configuration and stops Tracer routing."
              footer={
                workspace.state === "Archived" ? (
                  <ActionButton type="button" action={lifecycle} onClick={() => void restore()}>
                    Restore
                  </ActionButton>
                ) : (
                  <ActionButton
                    type="button"
                    variant="destructive"
                    action={lifecycle}
                    unavailable={workspace.state === "Active" ? "Detach the Tracking Number before archiving an Active Workspace." : null}
                    onClick={() => setConfirmArchive(true)}
                  >
                    Archive Workspace
                  </ActionButton>
                )
              }
            />
          ) : null}
        </div>
      </div>
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
          {numbersError ? <p role="alert" className="text-sm text-destructive">{numbersError}</p> : null}
          <DialogFooter>
            <ActionButton type="button" action={replace} showConfirmation={false} disabled={!replaceNumberId} onClick={() => void replaceNumber()}>
              Confirm Replacement
            </ActionButton>
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
          setSiteLinkMessage(sitePicker === "replace" ? "Site replaced." : "Site linked.");
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
            <ActionButton type="button" variant="destructive" action={siteDetach} showConfirmation={false} onClick={() => void detachSite()}>
              Detach Site
            </ActionButton>
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
            <ActionButton type="button" variant="destructive" action={detach} showConfirmation={false} onClick={() => void detachNumber()}>
              Detach Number
            </ActionButton>
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
            <ActionButton type="button" action={lifecycle} showConfirmation={false} onClick={() => void archive()}>
              Archive Workspace
            </ActionButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
