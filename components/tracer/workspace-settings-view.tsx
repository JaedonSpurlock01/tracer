/**
 * -------------------------------------------------------------------------
 * @file   workspace-settings-view.tsx
 * @brief  Renders Workspace vertical-rail settings.
 *
 * @description
 *  Provides General, Number, Recording and AI, Access, and lifecycle
 *  settings. An Archived Workspace keeps only Access and Restore editable.
 *
 * @remarks
 *  Archive and restore are explicit state transitions and never call Twilio.
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
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import WorkspaceAccessSection from "@/components/tracer/workspace-access-section";
import type { WorkspaceRecord } from "@/data/workspaces";

function timezones(): string[] {
  return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
}

export default function WorkspaceSettingsView({ initialWorkspace }: { initialWorkspace: WorkspaceRecord }) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [name, setName] = useState(initialWorkspace.name);
  const [timezone, setTimezone] = useState(initialWorkspace.reportingTimezone);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [routingError, setRoutingError] = useState("");
  const [recordingEnabled, setRecordingEnabled] = useState(initialWorkspace.recordingEnabled);
  const [analysisEnabled, setAnalysisEnabled] = useState(initialWorkspace.analysisEnabled);
  const [spamGateEnabled, setSpamGateEnabled] = useState(initialWorkspace.spamGateEnabled);
  const [whisperEnabled, setWhisperEnabled] = useState(initialWorkspace.whisperEnabled);
  const [whisperMessage, setWhisperMessage] = useState(initialWorkspace.whisperMessage ?? "");
  const archived = workspace.state === "Archived";
  const published = Boolean(workspace.publishedFlowVersion);

  async function saveGeneral() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/workspaces/${workspace.id}`, {
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

  async function archive() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/workspaces/${workspace.id}/archive`, { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      setError(
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
    const response = await fetch(`/api/workspaces/${workspace.id}/routing`, {
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

  async function restore() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/workspaces/${workspace.id}/restore`, { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      setError("Workspace could not be restored.");
    } else {
      const body = (await response.json()) as { workspace: WorkspaceRecord };
      setWorkspace(body.workspace);
      setMessage("Workspace restored to Setup Required.");
    }
    setBusy(false);
  }

  const sections = ["General", "Number", "Recording and AI", "Access", "Danger"];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{workspace.name} Settings</h1>
        <div className="mt-2">
          <Badge
            variant={
              workspace.state === "Archived" ? "destructive-light" : workspace.state === "Active" ? "success-light" : "primary-light"
            }
          >
            {workspace.state}
          </Badge>
        </div>
      </div>
      <Frame>
        <FramePanel className="grid gap-6 md:grid-cols-[12rem_1fr]">
          <nav aria-label="Workspace settings sections" className="flex gap-1 overflow-x-auto md:flex-col">
            {sections.map((section) => {
              const available = section === "Access" || !archived;
              return available ? (
                <Button
                  key={section}
                  variant="ghost"
                  render={<a href={`#${section.toLowerCase()}`} />}
                  className="justify-start whitespace-nowrap"
                >
                  {section}
                </Button>
              ) : (
                <Button key={section} variant="ghost" disabled className="justify-start whitespace-nowrap">
                  {section}
                  <span className="ml-auto text-xs text-muted-foreground">Arrives with a later milestone</span>
                </Button>
              );
            })}
          </nav>
          <div className="flex flex-col gap-8">
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
                <div className="flex items-center gap-3">
                  <Button type="button" onClick={() => void saveGeneral()} disabled={busy || archived}>
                    Save changes
                  </Button>
                  {message ? <p role="status">{message}</p> : null}
                </div>
              </div>
            </section>
            <section id="number" className="border-t pt-6">
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
                <Button type="button" variant="outline" disabled>
                  Replace Number
                </Button>
                <p className="text-xs text-muted-foreground">Available after the first Call is recorded</p>
              </div>
            </section>
            <section id="recording-and-ai" className="border-t pt-6">
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
                <Button type="button" onClick={() => void saveRouting()} disabled={busy || archived}>
                  Save Recording and AI
                </Button>
              </div>
            </section>
            <WorkspaceAccessSection workspace={workspace} />
            <section id="danger" className="border-t pt-6">
              <h2 className="font-semibold">Danger</h2>
              <p className="mb-4 text-sm text-muted-foreground">
                Archiving restores the prior Twilio voice configuration and stops Tracer routing.
              </p>
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
          </div>
        </FramePanel>
      </Frame>
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
