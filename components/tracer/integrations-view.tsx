/**
 * -------------------------------------------------------------------------
 * @file   integrations-view.tsx
 * @brief  Renders the Operator Integrations provider health surface.
 *
 * @description
 *  Lays the page out as a provider navigation beside one provider's detail,
 *  chosen by the `provider` search parameter so a provider is linkable.
 *  Switching providers happens on the client from the data the page
 *  already holds, and only rewrites the address, so a tab change never
 *  waits on the server.
 *  A connection whose credential the deployment cannot open shows Needs
 *  re-entry: its detail offers only Re-enter credential (the rotate form,
 *  which never reads the old secret) and Disconnect, and the attention
 *  lane names the cause. A blocked Twilio disconnect offers Disconnect
 *  anyway behind an acknowledgement, which ends the Active Workspaces'
 *  Number Assignments without restoring Twilio.
 *  A Needs attention lane above them lists unconnected Organization
 *  credentials, a missing Twilio Auth Token, and degraded providers with
 *  the action that resolves each. The detail shows the provider's facts,
 *  its actions, and its own panels: Twilio numbers, Cloudflare Sites with
 *  their link state, Recording transfer failures for R2 and Trigger.dev,
 *  and the oldest purged or expired Recordings whose media cleanup is
 *  unfinished, each linking to its Call Detail. Twilio, Cloudflare, and
 *  DataForSEO credentials are connected, tested, rotated, and disconnected
 *  through dialogs; Hyperdrive and Email Service expose safe test actions.
 *
 * @remarks
 *  Provider actions remain behind the authenticated HTTP boundary. The first
 *  data arrives from the server, so the page never shows a loading Skeleton;
 *  it refreshes in place after mount and after each action, and a failed
 *  refresh keeps the current data with a Retry. Each action keeps its own
 *  pending state, so one running test never disables the others. A failure
 *  is named beside the button that caused it, inside the dialog when the
 *  action is in one, and the dialog stays open with the entered values.
 *  Each dialog's form lives in its own component, so closing the dialog
 *  clears its values and failure. Confirmations sit beside the action, or
 *  at the end of the provider's actions when the dialog that caused them
 *  has closed.
 *
 * @see
 *  data/integrations-handler.ts
 *  data/provider-health.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/reui/badge";
import { Frame, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ActionButton, useAction, type ActionResult } from "@/components/tracer/form-parts";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import { ProviderLogo } from "@/components/tracer/provider-logo";
import { StatusMessage, useStatusMessage } from "@/components/tracer/status-message";
import { callDetailHref } from "@/data/call-source";
import type { CloudflareConnectionRecord, CloudflareSiteListEntry } from "@/data/cloudflare-connection";
import type { DataForSeoConnectionRecord } from "@/data/dataforseo-connection";
import type { TwilioConnectionRecord, TwilioNumberRecord } from "@/data/integrations";
import type { SiteHealth } from "@/data/site-health";
import type { MediaLifecycleHealth, OpenAIAnalysisHealth, ProviderHealth, ProviderId, ProviderState, RecordingTransferFailure } from "@/data/provider-health";

type IntegrationResponse = {
  providers: ProviderHealth[];
  twilio: TwilioConnectionRecord | null;
  numbers?: TwilioNumberRecord[];
  cloudflare: CloudflareConnectionRecord | null;
  sites?: CloudflareSiteListEntry[];
  dataforseo?: DataForSeoConnectionRecord | null;
};

const cloudflareTokenPermissions = ["Workers Scripts Read", "Workers Custom Domains Read", "Account Analytics Read", "Browser Rendering Edit"];
const visitsFormatter = new Intl.NumberFormat("en-US");

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

function formatDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : "Never";
}

function stateVariant(state: ProviderState): "success-light" | "primary-light" | "warning-light" | "outline" {
  if (state === "connected") return "success-light";
  if (state === "configured") return "primary-light";
  if (state === "degraded" || state === "needs_reentry") return "warning-light";
  return "outline";
}

function stateLabel(state: ProviderState): string {
  if (state === "not_configured") return "Not configured";
  if (state === "needs_reentry") return "Needs re-entry";
  return state[0].toUpperCase() + state.slice(1);
}

function responseBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

function providerError(status: number, detail: unknown, fallback: string): string {
  if (status === 400) return "Enter a valid Account SID, API Key SID, and secret.";
  if (status === 422) return `Twilio rejected the credential.${typeof detail === "string" ? ` ${detail}` : ""}`;
  if (status === 502) return "Twilio is unavailable. Try again.";
  if (status === 503) return "The TWILIO_CREDENTIAL_MASTER_KEY deployment secret is missing.";
  return fallback;
}

function cloudflareError(status: number, detail: unknown, fallback: string): string {
  if (status === 400) return "Enter a valid Account ID and API token.";
  if (status === 422) return `Cloudflare rejected the token.${typeof detail === "string" ? ` ${detail}` : ""}`;
  if (status === 502) return "Cloudflare is unavailable. Try again.";
  if (status === 503) return "The TWILIO_CREDENTIAL_MASTER_KEY deployment secret is missing.";
  return fallback;
}

function dataforseoError(status: number, detail: unknown, fallback: string): string {
  if (status === 400) return "Enter the DataForSEO API login and password.";
  if (status === 422) return `DataForSEO rejected the credential.${typeof detail === "string" ? ` ${detail}` : ""}`;
  if (status === 502) return "DataForSEO is unavailable. Try again.";
  if (status === 503) return "The TWILIO_CREDENTIAL_MASTER_KEY deployment secret is missing.";
  return fallback;
}

export function siteHealthVariant(health: SiteHealth): "success-light" | "warning-light" | "destructive-light" | "outline" {
  if (health === "Healthy") return "success-light";
  if (health === "Warning") return "warning-light";
  if (health === "Down") return "destructive-light";
  return "outline";
}

function StatusDot({ state }: { state: ProviderState }) {
  const color = state === "connected" ? "bg-success" : state === "configured" ? "bg-primary/70" : state === "degraded" || state === "needs_reentry" ? "bg-warning" : "bg-muted-foreground/40";
  return <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${color}`} />;
}

type Fact = [term: string, value: ReactNode];

function FactList({ facts }: { facts: Fact[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {facts.map(([term, value]) => (
        <div key={term} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{term}</dt>
          <dd className="truncate tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function analysisFacts(identifier: string | null, analysis: OpenAIAnalysisHealth): Fact[] {
  return [
    ["Identifier", identifier ?? "Not available"],
    ["Transcription model", analysis.transcriptionModel],
    ["Lead analysis model", analysis.leadAssessmentModel],
    ["Last successful Transcript", formatDate(analysis.lastTranscriptAt)],
    ["Last successful Lead Assessment", formatDate(analysis.lastLeadAssessmentAt)],
    ["Recent processing failures", String(analysis.failedCount)],
    ["Last failure", formatDate(analysis.lastFailureAt)],
  ];
}

function serviceFacts(provider: ProviderHealth): Fact[] {
  if (provider.analysis) return analysisFacts(provider.identifier, provider.analysis);
  const facts: Fact[] = [
    ["Identifier", provider.identifier ?? "Not available"],
    [provider.recentFailures ? "Last successful Recording transfer" : "Last successful check", formatDate(provider.lastSuccessAt)],
    ["Last failure", formatDate(provider.lastFailureAt)],
  ];
  if (provider.lastFailureDetail) facts.push(["Failure detail", provider.lastFailureDetail]);
  if (provider.mediaLifecycle) facts.push(["Unfinished media cleanup", String(provider.mediaLifecycle.stuckCount)]);
  return facts;
}

function connectedBy(record: { connectedBy: { name: string } | null; connectedAt: string; lastVerifiedAt: string | null }): Fact[] {
  return [["Connected by", record.connectedBy?.name ?? "Unknown"], ["Connected at", formatDate(record.connectedAt)], ["Last verified", formatDate(record.lastVerifiedAt)]];
}

function twilioFacts(connection: TwilioConnectionRecord): Fact[] {
  return [
    ["Account SID", <span key="sid" className="font-mono">{connection.accountSid}</span>],
    ["API Key SID", <span key="key" className="font-mono">{connection.apiKeySid}</span>],
    ["Account name", connection.accountFriendlyName ?? "Not available"],
    ...connectedBy(connection),
    ["Webhook Auth Token", <Badge key="token" variant={connection.authTokenConfigured ? "success-light" : "warning-light"}>{connection.authTokenConfigured ? "Configured" : "Not configured"}</Badge>],
    ["Last failure", formatDate(connection.lastFailureAt)],
  ];
}

function cloudflareFacts(connection: CloudflareConnectionRecord): Fact[] {
  return [
    ["Account ID", <span key="id" className="font-mono">{connection.accountId}</span>],
    ...connectedBy(connection),
    ["Last sync", formatDate(connection.lastSyncedAt)],
    ["Sites", String(connection.siteCount)],
    ["Last failure", formatDate(connection.lastFailureAt)],
  ];
}

function dataforseoFacts(connection: DataForSeoConnectionRecord): Fact[] {
  return [
    ["API login", <span key="login" className="font-mono">{connection.login}</span>],
    ...connectedBy(connection),
    ["Last check", formatDate(connection.lastCheckedAt)],
    ["Lookups this month", visitsFormatter.format(connection.lookupsThisMonth)],
    ["Keywords tracked", visitsFormatter.format(connection.keywordCount)],
    ["Last failure", formatDate(connection.lastFailureAt)],
  ];
}

interface ConnectionRecords {
  twilio: TwilioConnectionRecord | null;
  cloudflare: CloudflareConnectionRecord | null;
  dataforseo: DataForSeoConnectionRecord | null;
  sites: CloudflareSiteListEntry[];
}

/** One line under a provider name in the navigation and the detail header. */
function summaryLine(provider: ProviderHealth, records: ConnectionRecords): string {
  switch (provider.id) {
    case "twilio":
      return records.twilio ? `${records.twilio.accountFriendlyName ?? records.twilio.accountSid} · ${records.twilio.numberCount} numbers` : "Not connected";
    case "cloudflare":
      return records.cloudflare ? `${records.cloudflare.siteCount} Sites · ${records.sites.filter((site) => site.linkedWorkspace).length} linked` : "Not connected";
    case "dataforseo":
      return records.dataforseo ? `${visitsFormatter.format(records.dataforseo.keywordCount)} Keywords · ${visitsFormatter.format(records.dataforseo.lookupsThisMonth)} lookups this month` : "Not connected";
    case "openai":
      return provider.analysis ? `${provider.analysis.transcriptionModel} · ${provider.analysis.leadAssessmentModel}` : "Transcripts and Lead Assessments";
    case "triggerdev":
      return provider.mediaLifecycle?.stuckCount ? `${provider.mediaLifecycle.stuckCount} Recordings awaiting cleanup` : "Background runs and media cleanup";
    case "r2":
      return provider.identifier ? `Bucket ${provider.identifier}` : "Recording storage";
    case "email":
      return provider.identifier ? `From ${provider.identifier}` : "Transactional email";
    case "hyperdrive":
      return "Database connection pool";
  }
}

function NavGroup({ label, providers, current, records, onSelect }: { label: string; providers: ProviderHealth[]; current: ProviderId; records: ConnectionRecords; onSelect: (id: ProviderId) => void }) {
  return (
    <div className="flex shrink-0 flex-col gap-1">
      <p className="px-2 text-xs font-medium text-muted-foreground">{label}</p>
      <ul className="flex gap-1 md:flex-col">
        {providers.map((provider) => {
          const active = provider.id === current;
          return (
            <li key={provider.id}>
              <a
                href={`/integrations?provider=${provider.id}`}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  event.preventDefault();
                  onSelect(provider.id);
                }}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 whitespace-nowrap rounded-md px-2 py-1.5 text-sm transition-colors ${active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"}`}
              >
                <ProviderLogo id={provider.id} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{provider.name}</span>
                  <span className="hidden truncate text-xs text-muted-foreground md:block">{summaryLine(provider, records)}</span>
                </span>
                <StatusDot state={provider.state} />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NumbersTable({ numbers }: { numbers: TwilioNumberRecord[] }) {
  if (!numbers.length) return <p className="px-3 py-3 text-sm text-muted-foreground">No numbers synced yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table aria-label="Twilio numbers" className="w-full text-sm">
        <caption className="sr-only">Twilio numbers</caption>
        <thead><tr className="border-b text-left"><th className="px-3 py-2 text-xs font-medium text-muted-foreground">Phone Number</th><th className="px-3 py-2 text-xs font-medium text-muted-foreground">Friendly Name</th><th className="px-3 py-2 text-xs font-medium text-muted-foreground">Voice</th><th className="px-3 py-2 text-xs font-medium text-muted-foreground">Status</th></tr></thead>
        <tbody>{numbers.map((number) => <tr key={number.id} className="border-b last:border-0"><td className="px-3 py-2 font-mono">{number.phoneNumber}</td><td className="px-3 py-2">{number.friendlyName}</td><td className="px-3 py-2">{number.voiceCapable ? "Yes" : "No"}</td><td className="px-3 py-2"><Badge variant={number.releasedAt ? "outline" : "success-light"}>{number.releasedAt ? "Released" : "Active"}</Badge></td></tr>)}</tbody>
      </table>
    </div>
  );
}

function SitesTable({ sites }: { sites: CloudflareSiteListEntry[] }) {
  if (!sites.length) return <p className="px-3 py-3 text-sm text-muted-foreground">No Sites with a custom domain were found on the account.</p>;
  return (
    <div className="overflow-x-auto">
      <table aria-label="Sites" className="w-full text-sm">
        <caption className="sr-only">Sites</caption>
        <thead><tr className="border-b text-left"><th className="px-3 py-2 text-xs font-medium text-muted-foreground">Site</th><th className="px-3 py-2 text-xs font-medium text-muted-foreground">Health</th><th className="px-3 py-2 text-xs font-medium text-muted-foreground">Last deployment</th><th className="px-3 py-2 text-xs font-medium text-muted-foreground">Visits (30 days)</th><th className="px-3 py-2 text-xs font-medium text-muted-foreground">Workspace</th></tr></thead>
        <tbody>{sites.map((site) => <tr key={site.id} className="border-b last:border-0">
          <td className="px-3 py-2 font-mono">{site.primaryHostname}</td>
          <td className="px-3 py-2"><Badge variant={siteHealthVariant(site.health)}>{site.health}</Badge></td>
          <td className="px-3 py-2 tabular-nums">{formatDate(site.lastDeployedAt)}</td>
          <td className="px-3 py-2 tabular-nums">{visitsFormatter.format(site.visits30d)}</td>
          <td className="px-3 py-2">{site.linkedWorkspace ? <Link href={`/workspaces/${site.linkedWorkspace.id}`} prefetch={false} className="hover:underline">Linked to {site.linkedWorkspace.name}</Link> : <span className="text-muted-foreground">Not linked</span>}</td>
        </tr>)}</tbody>
      </table>
    </div>
  );
}

function RecordingTransferFailures({ failures }: { failures: RecordingTransferFailure[] }) {
  if (!failures.length) return <p className="px-3 py-3 text-sm text-muted-foreground">No Recording transfer failures.</p>;
  return (
    <div className="overflow-x-auto">
      <table aria-label="Recent transfer failures" className="w-full text-sm">
        <caption className="sr-only">Recent transfer failures</caption>
        <thead><tr className="border-b text-left"><th className="px-3 py-2 text-xs font-medium text-muted-foreground">Stage</th><th className="px-3 py-2 text-xs font-medium text-muted-foreground">Reason</th><th className="px-3 py-2 text-xs font-medium text-muted-foreground">Failed at</th></tr></thead>
        <tbody>{failures.map((failure, index) => <tr key={index} className="border-b last:border-0"><td className="px-3 py-2">{failure.stage[0].toUpperCase() + failure.stage.slice(1)}</td><td className="px-3 py-2">{failure.reason}</td><td className="px-3 py-2 tabular-nums">{formatDate(failure.at)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function MediaLifecycle({ health }: { health: MediaLifecycleHealth }) {
  if (!health.oldestStuck.length) return <p className="px-3 py-3 text-sm text-muted-foreground">No unfinished media cleanup.</p>;
  return (
    <div className="overflow-x-auto">
      <table aria-label="Unfinished media cleanup" className="w-full text-sm">
        <caption className="sr-only">Unfinished media cleanup</caption>
        <thead><tr className="border-b text-left"><th className="px-3 py-2 text-xs font-medium text-muted-foreground">Call</th><th className="px-3 py-2 text-xs font-medium text-muted-foreground">Workspace</th><th className="px-3 py-2 text-xs font-medium text-muted-foreground">Media</th><th className="px-3 py-2 text-xs font-medium text-muted-foreground">Since</th><th className="px-3 py-2 text-xs font-medium text-muted-foreground">Detail</th></tr></thead>
        <tbody>{health.oldestStuck.map((entry) => <tr key={entry.callId} className="border-b last:border-0"><td className="px-3 py-2"><Link href={callDetailHref({ id: entry.callId, workspaceId: entry.workspaceId }, null)} prefetch={false} className="font-medium hover:underline">View Call</Link></td><td className="px-3 py-2">{entry.workspaceName}</td><td className="px-3 py-2">{entry.media}</td><td className="px-3 py-2 tabular-nums">{formatDate(entry.since)}</td><td className="px-3 py-2">{entry.twilioNotConnected ? "Twilio is not connected" : "Retried by the daily sweep"}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

type CredentialField = { id: string; name: string; label: string; secret?: boolean; mono?: boolean; description?: ReactNode };

function CredentialForm({ fields, submitLabel, onSubmit }: { fields: CredentialField[]; submitLabel: string; onSubmit: (values: Record<string, string>) => Promise<ActionResult> }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const submit = useAction();
  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void submit.run(() => onSubmit(values)); }}>
      {fields.map((field) => (
        <Field key={field.name}>
          <FieldLabel htmlFor={field.id}>{field.label}</FieldLabel>
          <Input id={field.id} type={field.secret ? "password" : "text"} autoComplete="off" className={field.mono ? "font-mono" : undefined} value={values[field.name] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))} required />
          {field.description}
        </Field>
      ))}
      <DialogFooter><ActionButton type="submit" action={submit}>{submitLabel}</ActionButton></DialogFooter>
    </form>
  );
}

function ConfirmFooter({ label, onConfirm }: { label: string; onConfirm: () => Promise<ActionResult> }) {
  const confirm = useAction();
  return (
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <ActionButton type="button" variant="destructive" action={confirm} onClick={() => void confirm.run(onConfirm)}>{label}</ActionButton>
    </AlertDialogFooter>
  );
}

type TwilioDisconnectResult = { error?: string; blocked?: number } | void;

function TwilioDisconnectConfirm({ disconnect }: { disconnect: (force: boolean) => Promise<TwilioDisconnectResult> }) {
  const confirm = useAction();
  const [blocked, setBlocked] = useState<number | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  function run(force: boolean) {
    return confirm.run(async () => {
      const result = await disconnect(force);
      if (result?.blocked === undefined) return result;
      setBlocked(result.blocked);
    });
  }

  return (
    <>
      {blocked !== null ? (
        <>
          <p role="alert" className="text-sm text-destructive">Disconnect is blocked while {blocked} Active Workspaces depend on Twilio.</p>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={acknowledged} onCheckedChange={(checked) => setAcknowledged(checked === true)} />
            <span>End {blocked} Number Assignments and return their Workspaces to Setup Required. Their Twilio voice settings will not be restored; each Workspace will say which number to clear in Twilio.</span>
          </label>
        </>
      ) : null}
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        {blocked !== null ? (
          <ActionButton type="button" variant="destructive" action={confirm} unavailable={acknowledged ? null : "Acknowledge the ended Number Assignments first."} onClick={() => void run(true)}>Disconnect anyway</ActionButton>
        ) : (
          <ActionButton type="button" variant="destructive" action={confirm} onClick={() => void run(false)}>Disconnect</ActionButton>
        )}
      </AlertDialogFooter>
    </>
  );
}

function ProviderTest({ id }: { id: "hyperdrive" | "email" }) {
  const test = useAction();

  function run() {
    return test.run(async () => {
      const response = await mutationFetch(`/api/integrations/${id}/test`, { method: "POST" }).catch(() => null);
      const body = response ? await responseBody(response) : {};
      if (response?.ok && id === "hyperdrive") return { message: `Connection verified at ${formatDate(typeof body.checkedAt === "string" ? body.checkedAt : null)}` };
      if (response?.ok) return { message: `Test email sent to ${typeof body.to === "string" ? body.to : "your address"}` };
      if (id === "email" && response?.status === 409) return { error: "Your address is not on the recipient allowlist." };
      return { error: id === "hyperdrive" ? "Hyperdrive test failed." : "Test email failed." };
    });
  }

  return <ActionButton type="button" variant="outline" action={test} onClick={() => void run()}>{id === "email" ? "Send Test Email" : "Test Connection"}</ActionButton>;
}

async function saveCredential(path: string, payload: unknown, describe: (status: number, detail: unknown) => string): Promise<string | null> {
  const response = await mutationFetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).catch(() => null);
  if (!response) return "Connection failed.";
  if (response.ok) return null;
  const body = await responseBody(response);
  return describe(response.status, body.detail);
}

export interface IntegrationsOverview {
  providers: ProviderHealth[];
  twilio: TwilioConnectionRecord | null;
  numbers: TwilioNumberRecord[];
  cloudflare: CloudflareConnectionRecord | null;
  sites: CloudflareSiteListEntry[];
  dataforseo?: DataForSeoConnectionRecord | null;
  formsKey?: { createdAt: string } | null;
}

function FormsKeyPanel({ initial }: { initial: { createdAt: string } | null }) {
  const [formsKey, setFormsKey] = useState(initial);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [outcome, announce] = useStatusMessage();
  const generate = useAction();

  function generateKey() {
    setCopied(false);
    return generate.run(async () => {
      const response = await mutationFetch("/api/integrations/forms-key", { method: "POST" }).catch(() => null);
      if (!response?.ok) return { error: "The Forms key could not be generated." };
      const body = (await response.json()) as { key: string; createdAt: string };
      setFormsKey({ createdAt: body.createdAt });
      setRevealed(body.key);
      announce(formsKey ? "Forms key rotated. Every Site's form posts are refused until the new key is deployed." : "Forms key generated.");
    });
  }

  async function revoke(): Promise<ActionResult> {
    const response = await mutationFetch("/api/integrations/forms-key", { method: "DELETE" }).catch(() => null);
    if (!response?.ok) return { error: "The Forms key could not be revoked." };
    setFormsKey(null);
    setRevealed(null);
    setRevokeOpen(false);
    announce("Forms key revoked. Every Site's form posts are refused until a new key is generated.");
  }

  async function copy() {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed).catch(() => undefined);
    setCopied(true);
  }

  return (
    <div className="flex flex-col gap-3 px-3 pb-3 text-sm">
      <p>
        <span className="font-medium">Status: </span>
        {formsKey ? `Generated ${formatDate(formsKey.createdAt)}` : "No key yet"}
      </p>
      {revealed ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <code className="break-all font-mono">{revealed}</code>
            <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Set it once as <span className="font-mono">TRACER_FORM_KEY</span> in the site repository&apos;s deploy environment so every Site&apos;s Worker gets it. It is shown only once.
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton type="button" variant="outline" action={generate} onClick={() => void generateKey()}>{formsKey ? "Rotate Forms key" : "Generate Forms key"}</ActionButton>
        {formsKey ? <Button type="button" variant="destructive" onClick={() => setRevokeOpen(true)}>Revoke Forms key</Button> : null}
        <StatusMessage status={outcome} className="text-sm text-muted-foreground" />
      </div>
      <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Revoke the Forms key?</AlertDialogTitle><AlertDialogDescription>Every Site&apos;s contact form posts are refused until a new key is generated and deployed. Stored Form Submissions are kept.</AlertDialogDescription></AlertDialogHeader>
          <ConfirmFooter label="Revoke Forms key" onConfirm={revoke} />
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function IntegrationsView({ initial, provider: requestedId }: { initial: IntegrationsOverview; provider: ProviderId }) {
  const [chosenId, setChosenId] = useState<ProviderId | null>(null);
  const selectedId = chosenId ?? requestedId;
  const [providers, setProviders] = useState<ProviderHealth[]>(initial.providers);
  const [twilio, setTwilio] = useState<TwilioConnectionRecord | null>(initial.twilio);
  const [numbers, setNumbers] = useState<TwilioNumberRecord[]>(initial.numbers);
  const [refreshError, setRefreshError] = useState(false);
  const [twilioDialog, setTwilioDialog] = useState<"connect" | "rotate" | "authToken" | "disconnect" | null>(null);
  const [twilioOutcome, announceTwilio] = useStatusMessage();
  const twilioTest = useAction();
  const twilioSync = useAction();
  const [cloudflare, setCloudflare] = useState<CloudflareConnectionRecord | null>(initial.cloudflare);
  const [sites, setSites] = useState<CloudflareSiteListEntry[]>(initial.sites);
  const [cloudflareDialog, setCloudflareDialog] = useState<"connect" | "rotate" | "disconnect" | null>(null);
  const [cloudflareOutcome, announceCloudflare] = useStatusMessage();
  const cloudflareTest = useAction();
  const cloudflareSync = useAction();
  const [dataforseo, setDataforseo] = useState<DataForSeoConnectionRecord | null>(initial.dataforseo ?? null);
  const [dataforseoDialog, setDataforseoDialog] = useState<"connect" | "rotate" | "disconnect" | null>(null);
  const [dataforseoOutcome, announceDataforseo] = useStatusMessage();
  const dataforseoTest = useAction();

  async function reload() {
    setRefreshError(false);
    try {
      const response = await fetch("/api/integrations");
      if (!response.ok) throw new Error("Integrations unavailable");
      const body = await responseBody(response) as unknown as IntegrationResponse;
      setProviders(Array.isArray(body.providers) ? body.providers : []);
      setTwilio(body.twilio ?? null);
      setNumbers(body.twilio && Array.isArray(body.numbers) ? body.numbers : []);
      setCloudflare(body.cloudflare ?? null);
      setSites(body.cloudflare && Array.isArray(body.sites) ? body.sites : []);
      setDataforseo(body.dataforseo ?? null);
    } catch {
      setRefreshError(true);
    }
  }

  async function submitDataForSeo(route: "connect" | "rotate", values: Record<string, string>): Promise<ActionResult> {
    const payload = route === "connect" ? { login: values.login, password: values.password } : { password: values.password };
    const error = await saveCredential(`/api/integrations/dataforseo/${route}`, payload, (status, detail) => dataforseoError(status, detail, "Connection failed."));
    if (error) return { error };
    setDataforseoDialog(null);
    await reload();
    announceDataforseo(route === "connect" ? "DataForSEO connected." : "DataForSEO password rotated.");
  }

  function testDataForSeo() {
    return dataforseoTest.run(async () => {
      const response = await mutationFetch("/api/integrations/dataforseo/test", { method: "POST" }).catch(() => null);
      const body = response ? await responseBody(response) : {};
      await reload();
      return response?.ok ? { message: "DataForSEO connection verified." } : { error: `DataForSEO test failed.${typeof body.detail === "string" ? ` ${body.detail}` : ""}` };
    });
  }

  async function disconnectDataForSeo(): Promise<ActionResult> {
    const response = await mutationFetch("/api/integrations/dataforseo/disconnect", { method: "POST" }).catch(() => null);
    const body = response ? await responseBody(response) : {};
    if (!response?.ok) return { error: `DataForSEO disconnect failed.${typeof body.detail === "string" ? ` ${body.detail}` : ""}` };
    setDataforseoDialog(null);
    await reload();
    announceDataforseo("DataForSEO disconnected.");
  }

  async function submitCloudflare(route: "connect" | "rotate", values: Record<string, string>): Promise<ActionResult> {
    const payload = route === "connect" ? { accountId: values.accountId, apiToken: values.apiToken } : { apiToken: values.apiToken };
    const error = await saveCredential(`/api/integrations/cloudflare/${route}`, payload, (status, detail) => cloudflareError(status, detail, "Connection failed."));
    if (error) return { error };
    setCloudflareDialog(null);
    await reload();
    announceCloudflare(route === "connect" ? "Cloudflare connected." : "Cloudflare token rotated.");
  }

  function runCloudflare(action: "test" | "sync") {
    return (action === "test" ? cloudflareTest : cloudflareSync).run(async () => {
      const response = await mutationFetch(`/api/integrations/cloudflare/${action}`, { method: "POST" }).catch(() => null);
      const body = response ? await responseBody(response) : {};
      if (!response?.ok) {
        if (action === "test") await reload();
        return { error: `Cloudflare ${action} failed.${typeof body.detail === "string" ? ` ${body.detail}` : ""}` };
      }
      await reload();
      return { message: action === "test" ? "Cloudflare connection verified." : `Synced ${typeof body.siteCount === "number" ? body.siteCount : 0} Sites.` };
    });
  }

  async function disconnectCloudflare(): Promise<ActionResult> {
    const response = await mutationFetch("/api/integrations/cloudflare/disconnect", { method: "POST" }).catch(() => null);
    const body = response ? await responseBody(response) : {};
    if (response?.status === 409 && typeof body.activeSiteLinkCount === "number") return { error: `Disconnect is blocked while ${body.activeSiteLinkCount} Site Links are open.` };
    if (!response?.ok) return { error: `Cloudflare disconnect failed.${typeof body.detail === "string" ? ` ${body.detail}` : ""}` };
    setCloudflareDialog(null);
    await reload();
    announceCloudflare("Cloudflare disconnected.");
  }

  function selectProvider(id: ProviderId) {
    setChosenId(id);
    window.history.replaceState(window.history.state, "", `/integrations?provider=${id}`);
  }

  async function submitTwilio(route: "connect" | "rotate" | "authToken", values: Record<string, string>): Promise<ActionResult> {
    const error = route === "connect"
      ? await saveCredential("/api/integrations/twilio/connect", { accountSid: values.accountSid, apiKeySid: values.apiKeySid, apiKeySecret: values.apiKeySecret }, (status, detail) => providerError(status, detail, "Connection failed."))
      : route === "rotate"
        ? await saveCredential("/api/integrations/twilio/rotate", { apiKeySid: values.apiKeySid, apiKeySecret: values.apiKeySecret }, (status, detail) => providerError(status, detail, "Connection failed."))
        : await saveCredential("/api/integrations/twilio/auth-token", { authToken: values.authToken }, (status, detail) => status === 400 ? "Enter the Twilio Auth Token." : providerError(status, detail, "Connection failed."));
    if (error) return { error };
    setTwilioDialog(null);
    await reload();
    announceTwilio(route === "connect" ? "Twilio connected." : route === "rotate" ? "Twilio API key rotated." : "Twilio Auth Token saved.");
  }

  function testTwilio() {
    return twilioTest.run(async () => {
      const response = await mutationFetch("/api/integrations/twilio/test", { method: "POST" }).catch(() => null);
      const body = response && !response.ok ? await responseBody(response) : {};
      await reload();
      return response?.ok ? { message: "Twilio connection verified." } : { error: `Twilio test failed.${typeof body.detail === "string" ? ` ${body.detail}` : ""}` };
    });
  }

  function syncTwilio() {
    return twilioSync.run(async () => {
      const response = await mutationFetch("/api/integrations/twilio/sync-numbers", { method: "POST" }).catch(() => null);
      const body = response ? await responseBody(response) : {};
      if (!response?.ok) return { error: `Twilio sync failed.${typeof body.detail === "string" ? ` ${body.detail}` : ""}` };
      setNumbers(Array.isArray(body.numbers) ? body.numbers as TwilioNumberRecord[] : []);
      await reload();
      return { message: `Synced ${Array.isArray(body.numbers) ? body.numbers.length : 0} numbers, skipped ${typeof body.skipped === "number" ? body.skipped : 0}.` };
    });
  }

  async function disconnectTwilio(force: boolean): Promise<TwilioDisconnectResult> {
    const response = await mutationFetch("/api/integrations/twilio/disconnect", force
      ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force: true }) }
      : { method: "POST" }).catch(() => null);
    const body = response ? await responseBody(response) : {};
    if (response?.status === 409 && typeof body.activeWorkspaceCount === "number") return { blocked: body.activeWorkspaceCount };
    if (!response?.ok) return { error: "Disconnect failed." };
    setTwilioDialog(null);
    await reload();
    announceTwilio(typeof body.endedAssignments === "number" && body.endedAssignments > 0
      ? `Twilio disconnected. ${body.endedAssignments} Number Assignments ended without restoring Twilio.`
      : "Twilio disconnected.");
  }

  const openConnect = () => setTwilioDialog("connect");
  const openRotate = () => setTwilioDialog("rotate");
  const openAuthToken = () => setTwilioDialog("authToken");

  const readyCount = providers.filter((provider) => provider.state === "connected" || provider.state === "configured").length;
  const records: ConnectionRecords = { twilio, cloudflare, dataforseo, sites };
  const selected = providers.find((provider) => provider.id === selectedId) ?? providers[0];
  const connections = providers.filter((provider) => provider.group === "connection");
  const services = providers.filter((provider) => provider.group === "service");
  const headingId = `integration-${selected.id}`;

  const reenterAction: Partial<Record<ProviderId, () => void>> = {
    twilio: openRotate,
    cloudflare: () => setCloudflareDialog("rotate"),
    dataforseo: () => setDataforseoDialog("rotate"),
  };
  const connectAction: Partial<Record<ProviderId, () => void>> = {
    twilio: openConnect,
    cloudflare: () => setCloudflareDialog("connect"),
    dataforseo: () => setDataforseoDialog("connect"),
  };

  // Needs attention: what the Operator can resolve from this page, in page order.
  const attention: { key: string; provider: ProviderHealth; message: string; action: ReactNode }[] = [];
  for (const provider of providers) {
    if (provider.connectable && provider.state === "not_configured") {
      attention.push({ key: `${provider.id}-connect`, provider, message: provider.note ?? "Not connected", action: <Button type="button" size="sm" onClick={connectAction[provider.id]}>Connect {provider.name}</Button> });
    }
    if (provider.state === "needs_reentry") {
      attention.push({ key: `${provider.id}-reentry`, provider, message: provider.note ?? "The stored credential cannot be opened with the current master key.", action: <Button type="button" size="sm" onClick={reenterAction[provider.id]}>Re-enter credential</Button> });
      continue;
    }
    if (provider.id === "twilio" && twilio && !twilio.authTokenConfigured) {
      attention.push({ key: "twilio-auth-token", provider, message: "The webhook Auth Token is not configured, so Twilio webhooks cannot be verified.", action: <Button type="button" size="sm" variant="outline" onClick={openAuthToken}>Set Auth Token</Button> });
    }
    if (provider.state === "degraded") {
      const message = provider.mediaLifecycle?.stuckCount
        ? `${provider.mediaLifecycle.stuckCount} purged or expired Recordings still have media to clean up.`
        : provider.lastFailureDetail ?? provider.note ?? `Last failure ${formatDate(provider.lastFailureAt)}.`;
      attention.push({ key: `${provider.id}-degraded`, provider, message, action: provider.id === selected.id ? null : <Link href={`/integrations?provider=${provider.id}`} scroll={false} className={buttonVariants({ size: "sm", variant: "outline" })}>View</Link> });
    }
  }

  function detailActions(provider: ProviderHealth): ReactNode {
    if (provider.id === "twilio") {
      return (
        <div className="flex flex-wrap items-center gap-2">
          {!twilio ? (provider.connectable ? <Button type="button" onClick={openConnect}>Connect Twilio</Button> : null) : twilio.credentialState === "unreadable" ? (
            <>
              <Button type="button" onClick={openRotate}>Re-enter credential</Button>
              <Button type="button" variant="destructive" onClick={() => setTwilioDialog("disconnect")}>Disconnect</Button>
            </>
          ) : (
            <>
              <ActionButton type="button" action={twilioTest} onClick={() => void testTwilio()}>Test Connection</ActionButton>
              <ActionButton type="button" variant="outline" action={twilioSync} onClick={() => void syncTwilio()}>Sync Numbers</ActionButton>
              <Button type="button" variant="outline" onClick={openRotate}>Rotate Key</Button>
              <Button type="button" variant="outline" onClick={openAuthToken}>Set Auth Token</Button>
              <Button type="button" variant="destructive" onClick={() => setTwilioDialog("disconnect")}>Disconnect</Button>
            </>
          )}
          <StatusMessage status={twilioOutcome} className="text-sm text-muted-foreground" />
        </div>
      );
    }
    if (provider.id === "cloudflare") {
      return (
        <div className="flex flex-wrap items-center gap-2">
          {!cloudflare ? (provider.connectable ? <Button type="button" onClick={() => setCloudflareDialog("connect")}>Connect Cloudflare</Button> : null) : cloudflare.credentialState === "unreadable" ? (
            <>
              <Button type="button" onClick={() => setCloudflareDialog("rotate")}>Re-enter credential</Button>
              <Button type="button" variant="destructive" onClick={() => setCloudflareDialog("disconnect")}>Disconnect</Button>
            </>
          ) : (
            <>
              <ActionButton type="button" action={cloudflareTest} onClick={() => void runCloudflare("test")}>Test Connection</ActionButton>
              <ActionButton type="button" variant="outline" action={cloudflareSync} onClick={() => void runCloudflare("sync")}>Sync now</ActionButton>
              <Button type="button" variant="outline" onClick={() => setCloudflareDialog("rotate")}>Rotate Token</Button>
              <Button type="button" variant="destructive" onClick={() => setCloudflareDialog("disconnect")}>Disconnect</Button>
            </>
          )}
          <StatusMessage status={cloudflareOutcome} className="text-sm text-muted-foreground" />
        </div>
      );
    }
    if (provider.id === "dataforseo") {
      return (
        <div className="flex flex-wrap items-center gap-2">
          {!dataforseo ? (provider.connectable ? <Button type="button" onClick={() => setDataforseoDialog("connect")}>Connect DataForSEO</Button> : null) : dataforseo.credentialState === "unreadable" ? (
            <>
              <Button type="button" onClick={() => setDataforseoDialog("rotate")}>Re-enter credential</Button>
              <Button type="button" variant="destructive" onClick={() => setDataforseoDialog("disconnect")}>Disconnect</Button>
            </>
          ) : (
            <>
              <ActionButton type="button" action={dataforseoTest} onClick={() => void testDataForSeo()}>Test Connection</ActionButton>
              <Button type="button" variant="outline" onClick={() => setDataforseoDialog("rotate")}>Rotate Password</Button>
              <Button type="button" variant="destructive" onClick={() => setDataforseoDialog("disconnect")}>Disconnect</Button>
            </>
          )}
          <StatusMessage status={dataforseoOutcome} className="text-sm text-muted-foreground" />
        </div>
      );
    }
    if ((provider.id === "hyperdrive" || provider.id === "email") && provider.testable) {
      return <ProviderTest key={provider.id} id={provider.id} />;
    }
    return null;
  }

  function detailFacts(provider: ProviderHealth): Fact[] | null {
    if (provider.id === "twilio") return twilio ? twilioFacts(twilio) : null;
    if (provider.id === "cloudflare") return cloudflare ? cloudflareFacts(cloudflare) : null;
    if (provider.id === "dataforseo") return dataforseo ? dataforseoFacts(dataforseo) : null;
    return serviceFacts(provider);
  }

  const facts = detailFacts(selected);
  const panels: { title: string; description?: string; body: ReactNode }[] = [];
  if (selected.id === "twilio" && twilio) panels.push({ title: "Numbers", description: `${twilio.numberCount} eligible numbers. Last synced ${formatDate(twilio.numbersSyncedAt)}.`, body: <NumbersTable numbers={numbers} /> });
  if (selected.id === "cloudflare" && cloudflare) panels.push({ title: "Sites", description: "Workers on the account that serve a custom hostname.", body: <SitesTable sites={sites} /> });
  if (selected.id === "cloudflare" && cloudflare) panels.push({ title: "Forms key", description: "The Organization's one secret every Site's Worker presents with its hostname when posting a Form Submission. Tracer keeps only its hash.", body: <FormsKeyPanel initial={initial.formsKey ?? null} /> });
  if (selected.recentFailures) panels.push({ title: "Recording transfer failures", body: <RecordingTransferFailures failures={selected.recentFailures} /> });
  if (selected.mediaLifecycle) panels.push({ title: "Media cleanup", description: "The oldest purged or expired Recordings whose media cleanup is unfinished.", body: <MediaLifecycle health={selected.mediaLifecycle} /> });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <StatusDot state={attention.length ? "degraded" : "connected"} />
          {readyCount} of {providers.length} providers ready
        </p>
      </div>
      {refreshError ? <div className="flex items-center gap-3"><p role="alert" className="text-sm text-destructive">Integrations could not be refreshed.</p><Button type="button" variant="outline" onClick={() => void reload()}>Retry</Button></div> : null}

      {attention.length ? (
        <Frame>
          <FrameHeader><FrameTitle>Needs attention</FrameTitle></FrameHeader>
          <FramePanel className="p-0">
            <ul aria-label="Needs attention" className="divide-y">
              {attention.map((item) => (
                <li key={item.key} className="flex items-center gap-3 px-3 py-2.5">
                  <ProviderLogo id={item.provider.id} className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 text-sm"><span className="font-medium">{item.provider.name}</span><span className="text-muted-foreground"> · {item.message}</span></span>
                  {item.action}
                </li>
              ))}
            </ul>
          </FramePanel>
        </Frame>
      ) : null}

      <div className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Providers" className="flex gap-4 overflow-x-auto md:flex-col md:overflow-visible">
          <NavGroup label="Organization connections" providers={connections} current={selected.id} records={records} onSelect={selectProvider} />
          <NavGroup label="Platform services" providers={services} current={selected.id} records={records} onSelect={selectProvider} />
        </nav>
        <section aria-labelledby={headingId} className="min-w-0">
          <Frame>
            <FramePanel className="flex flex-col gap-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <ProviderLogo id={selected.id} className="size-6 shrink-0" />
                    <h2 id={headingId} className="text-lg font-semibold">{selected.name}</h2>
                    <Badge variant={stateVariant(selected.state)}>{stateLabel(selected.state)}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{summaryLine(selected, records)}</p>
                </div>
                {detailActions(selected)}
              </div>
              {facts ? <FactList facts={facts} /> : null}
              {selected.note ? <p className="text-sm text-muted-foreground">{selected.note}</p> : null}
            </FramePanel>
            {panels.map((panel) => (
              <FramePanel key={panel.title} role="region" aria-label={panel.title} className="flex flex-col p-0">
                <div className="flex flex-col gap-0.5 px-3 pt-3 pb-2">
                  <h3 className="text-sm font-medium">{panel.title}</h3>
                  {panel.description ? <p className="text-xs text-muted-foreground">{panel.description}</p> : null}
                </div>
                {panel.body}
              </FramePanel>
            ))}
          </Frame>
        </section>
      </div>

      <Dialog open={twilioDialog === "connect"} onOpenChange={(open) => setTwilioDialog(open ? "connect" : null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Connect Twilio</DialogTitle><DialogDescription>Connect the Organization Twilio account.</DialogDescription></DialogHeader>
          <CredentialForm
            submitLabel="Connect"
            onSubmit={(values) => submitTwilio("connect", values)}
            fields={[
              { id: "twilio-account-sid", name: "accountSid", label: "Account SID", mono: true },
              { id: "twilio-api-key-sid", name: "apiKeySid", label: "API Key SID", mono: true },
              { id: "twilio-api-key-secret", name: "apiKeySecret", label: "API Key Secret", secret: true, description: <FieldDescription>The secret is encrypted with the deployment master key and never shown again.</FieldDescription> },
            ]}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={twilioDialog === "rotate"} onOpenChange={(open) => setTwilioDialog(open ? "rotate" : null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rotate Twilio API Key</DialogTitle><DialogDescription>Verify the replacement key before changing the connection.</DialogDescription></DialogHeader>
          <CredentialForm
            submitLabel="Rotate Key"
            onSubmit={(values) => submitTwilio("rotate", values)}
            fields={[
              { id: "rotate-api-key-sid", name: "apiKeySid", label: "API Key SID", mono: true },
              { id: "rotate-api-key-secret", name: "apiKeySecret", label: "API Key Secret", secret: true },
            ]}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={twilioDialog === "authToken"} onOpenChange={(open) => setTwilioDialog(open ? "authToken" : null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Set Twilio Auth Token</DialogTitle><DialogDescription>Tracer verifies Twilio webhook signatures with the account Auth Token. It is verified, encrypted, and never displayed again.</DialogDescription></DialogHeader>
          <CredentialForm submitLabel="Save Auth Token" onSubmit={(values) => submitTwilio("authToken", values)} fields={[{ id: "twilio-auth-token", name: "authToken", label: "Auth Token", secret: true }]} />
        </DialogContent>
      </Dialog>

      <Dialog open={cloudflareDialog === "connect"} onOpenChange={(open) => setCloudflareDialog(open ? "connect" : null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Connect Cloudflare</DialogTitle><DialogDescription>Connect the Organization Cloudflare account with an Account ID and a scoped API token.</DialogDescription></DialogHeader>
          <CredentialForm
            submitLabel="Connect"
            onSubmit={(values) => submitCloudflare("connect", values)}
            fields={[
              { id: "cloudflare-account-id", name: "accountId", label: "Account ID", mono: true },
              {
                id: "cloudflare-api-token",
                name: "apiToken",
                label: "API Token",
                secret: true,
                description: (
                  <>
                    <FieldDescription>Create the token on the Cloudflare <a className="underline" href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">API tokens</a> page with these permissions. It is encrypted with the deployment master key and never shown again.</FieldDescription>
                    <ul className="list-disc pl-5 text-xs text-muted-foreground">{cloudflareTokenPermissions.map((permission) => <li key={permission}>{permission}</li>)}</ul>
                  </>
                ),
              },
            ]}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={cloudflareDialog === "rotate"} onOpenChange={(open) => setCloudflareDialog(open ? "rotate" : null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rotate Cloudflare Token</DialogTitle><DialogDescription>Verify the replacement token before changing the connection.</DialogDescription></DialogHeader>
          <CredentialForm submitLabel="Rotate Token" onSubmit={(values) => submitCloudflare("rotate", values)} fields={[{ id: "cloudflare-rotate-token", name: "apiToken", label: "API Token", secret: true }]} />
        </DialogContent>
      </Dialog>

      <AlertDialog open={cloudflareDialog === "disconnect"} onOpenChange={(open) => setCloudflareDialog(open ? "disconnect" : null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Disconnect Cloudflare?</AlertDialogTitle><AlertDialogDescription>The encrypted token is removed. Discovered Sites and their synced traffic stay until the account is connected again.</AlertDialogDescription></AlertDialogHeader>
          <ConfirmFooter label="Disconnect" onConfirm={disconnectCloudflare} />
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={dataforseoDialog === "connect"} onOpenChange={(open) => setDataforseoDialog(open ? "connect" : null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Connect DataForSEO</DialogTitle><DialogDescription>Connect the Organization DataForSEO account with its API login and password.</DialogDescription></DialogHeader>
          <CredentialForm
            submitLabel="Connect"
            onSubmit={(values) => submitDataForSeo("connect", values)}
            fields={[
              { id: "dataforseo-login", name: "login", label: "API login", mono: true },
              { id: "dataforseo-password", name: "password", label: "API password", secret: true, description: <FieldDescription>Find both on the DataForSEO <a className="underline" href="https://app.dataforseo.com/api-access" target="_blank" rel="noreferrer">API access</a> page. The password is encrypted with the deployment master key and never shown again. Each Keyword check costs about $0.002.</FieldDescription> },
            ]}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={dataforseoDialog === "rotate"} onOpenChange={(open) => setDataforseoDialog(open ? "rotate" : null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rotate DataForSEO Password</DialogTitle><DialogDescription>Verify the replacement password before changing the connection.</DialogDescription></DialogHeader>
          <CredentialForm submitLabel="Rotate Password" onSubmit={(values) => submitDataForSeo("rotate", values)} fields={[{ id: "dataforseo-rotate-password", name: "password", label: "API password", secret: true }]} />
        </DialogContent>
      </Dialog>

      <AlertDialog open={dataforseoDialog === "disconnect"} onOpenChange={(open) => setDataforseoDialog(open ? "disconnect" : null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Disconnect DataForSEO?</AlertDialogTitle><AlertDialogDescription>The encrypted password is removed. Keywords and their stored positions stay, and the daily check pauses until the account is connected again.</AlertDialogDescription></AlertDialogHeader>
          <ConfirmFooter label="Disconnect" onConfirm={disconnectDataForSeo} />
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={twilioDialog === "disconnect"} onOpenChange={(open) => setTwilioDialog(open ? "disconnect" : null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Disconnect Twilio?</AlertDialogTitle><AlertDialogDescription>The encrypted credential and synced number inventory are removed.</AlertDialogDescription></AlertDialogHeader>
          <TwilioDisconnectConfirm disconnect={disconnectTwilio} />
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
