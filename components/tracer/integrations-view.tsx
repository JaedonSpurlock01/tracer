/**
 * -------------------------------------------------------------------------
 * @file   integrations-view.tsx
 * @brief  Renders the Operator Integrations provider health surface.
 *
 * @description
 *  Lays the page out as a provider navigation beside one provider's detail,
 *  chosen by the `provider` search parameter so a provider is linkable.
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
 *  refresh keeps the current data with a Retry.
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
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { Badge } from "@/components/reui/badge";
import { Frame, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import { ProviderLogo } from "@/components/tracer/provider-logo";
import { callDetailHref } from "@/data/call-source";
import type { CloudflareConnectionRecord, CloudflareSiteListEntry } from "@/data/cloudflare-connection";
import type { DataForSeoConnectionRecord } from "@/data/dataforseo-connection";
import type { TwilioConnectionRecord, TwilioNumberRecord } from "@/data/integrations";
import type { SiteHealth } from "@/data/site-health";
import type { MediaLifecycleHealth, OpenAIAnalysisHealth, ProviderHealth, ProviderId, ProviderState, RecordingTransferFailure } from "@/data/provider-health";

type IntegrationResponse = {
  providers: ProviderHealth[];
  twilio: TwilioConnectionRecord | null;
  cloudflare: CloudflareConnectionRecord | null;
  dataforseo?: DataForSeoConnectionRecord | null;
};

type CloudflareFormValues = { accountId: string; apiToken: string };
type DataForSeoFormValues = { login: string; password: string };

const emptyCloudflareForm: CloudflareFormValues = { accountId: "", apiToken: "" };
const emptyDataForSeoForm: DataForSeoFormValues = { login: "", password: "" };
const cloudflareTokenPermissions = ["Workers Scripts Read", "Workers Custom Domains Read", "Account Analytics Read", "Browser Rendering Edit"];
const visitsFormatter = new Intl.NumberFormat("en-US");

type Action = "test" | "sync" | "rotate" | "authToken" | "disconnect" | "hyperdrive" | "email" | null;

type FormValues = {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
};

const emptyForm: FormValues = { accountSid: "", apiKeySid: "", apiKeySecret: "" };
const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

function formatDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : "Never";
}

function stateVariant(state: ProviderState): "success-light" | "primary-light" | "warning-light" | "outline" {
  if (state === "connected") return "success-light";
  if (state === "configured") return "primary-light";
  if (state === "degraded") return "warning-light";
  return "outline";
}

function stateLabel(state: ProviderState): string {
  if (state === "not_configured") return "Not configured";
  return state[0].toUpperCase() + state.slice(1);
}

function responseBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

function actionText(action: Action): string | null {
  if (action === "test") return "Testing...";
  if (action === "sync") return "Syncing...";
  if (action === "rotate") return "Rotating...";
  if (action === "disconnect") return "Disconnecting...";
  return null;
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
  const color = state === "connected" ? "bg-success" : state === "configured" ? "bg-primary/70" : state === "degraded" ? "bg-warning" : "bg-muted-foreground/40";
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

function NavGroup({ label, providers, current, records }: { label: string; providers: ProviderHealth[]; current: ProviderId; records: ConnectionRecords }) {
  return (
    <div className="flex shrink-0 flex-col gap-1">
      <p className="px-2 text-xs font-medium text-muted-foreground">{label}</p>
      <ul className="flex gap-1 md:flex-col">
        {providers.map((provider) => {
          const active = provider.id === current;
          return (
            <li key={provider.id}>
              <Link
                href={`/integrations?provider=${provider.id}`}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 whitespace-nowrap rounded-md px-2 py-1.5 text-sm transition-colors ${active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"}`}
              >
                <ProviderLogo id={provider.id} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{provider.name}</span>
                  <span className="hidden truncate text-xs text-muted-foreground md:block">{summaryLine(provider, records)}</span>
                </span>
                <StatusDot state={provider.state} />
              </Link>
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

function ProviderAction({ id, action, message, error, onClick }: { id: "hyperdrive" | "email"; action: Action; message?: string; error?: string; onClick: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" disabled={action === id} onClick={onClick}>{action === id ? <><Spinner /> Testing...</> : id === "email" ? "Send Test Email" : "Test Connection"}</Button>
      {message ? <p className="text-sm">{message}</p> : null}
      {error ? <><p role="alert" className="text-sm">{error}</p><Button type="button" variant="outline" onClick={onClick}>Retry</Button></> : null}
    </div>
  );
}

function ErrorLine({ error, retry }: { error: string; retry: (() => void) | null }) {
  if (!error) return null;
  return <div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-sm">{error}</p>{retry ? <Button type="button" variant="outline" onClick={retry}>Retry</Button> : null}</div>;
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
  const [action, setAction] = useState<"generate" | "revoke" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [revokeOpen, setRevokeOpen] = useState(false);

  async function generate() {
    setAction("generate");
    setError("");
    setMessage("");
    setCopied(false);
    const response = await mutationFetch("/api/integrations/forms-key", { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      setError("The Forms key could not be generated.");
    } else {
      const body = (await response.json()) as { key: string; createdAt: string };
      setFormsKey({ createdAt: body.createdAt });
      setRevealed(body.key);
      setMessage(formsKey ? "Forms key rotated. Every Site's form posts are refused until the new key is deployed." : "Forms key generated.");
    }
    setAction(null);
  }

  async function revoke() {
    setAction("revoke");
    setError("");
    setMessage("");
    const response = await mutationFetch("/api/integrations/forms-key", { method: "DELETE" }).catch(() => null);
    if (!response?.ok) {
      setError("The Forms key could not be revoked.");
    } else {
      setFormsKey(null);
      setRevealed(null);
      setMessage("Forms key revoked. Every Site's form posts are refused until a new key is generated.");
    }
    setRevokeOpen(false);
    setAction(null);
  }

  async function copy() {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed).catch(() => undefined);
    setCopied(true);
  }

  const busy = action !== null;
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
      {message ? <p>{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => void generate()}>{action === "generate" ? <><Spinner /> Generating...</> : formsKey ? "Rotate Forms key" : "Generate Forms key"}</Button>
        {formsKey ? <Button type="button" variant="destructive" disabled={busy} onClick={() => setRevokeOpen(true)}>Revoke Forms key</Button> : null}
      </div>
      <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Revoke the Forms key?</AlertDialogTitle><AlertDialogDescription>Every Site&apos;s contact form posts are refused until a new key is generated and deployed. Stored Form Submissions are kept.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={(event) => { event.preventDefault(); void revoke(); }}>{action === "revoke" ? <><Spinner /> Revoking...</> : "Revoke Forms key"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function IntegrationsView({ initial, provider: selectedId }: { initial: IntegrationsOverview; provider: ProviderId }) {
  const [providers, setProviders] = useState<ProviderHealth[]>(initial.providers);
  const [twilio, setTwilio] = useState<TwilioConnectionRecord | null>(initial.twilio);
  const [numbers, setNumbers] = useState<TwilioNumberRecord[]>(initial.numbers);
  const [refreshError, setRefreshError] = useState(false);
  const [status, setStatus] = useState("");
  const [twilioAction, setTwilioAction] = useState<Action>(null);
  const [providerAction, setProviderAction] = useState<Action>(null);
  const [twilioError, setTwilioError] = useState("");
  const [twilioRetry, setTwilioRetry] = useState(false);
  const [providerErrors, setProviderErrors] = useState<Record<string, string>>({});
  const [providerMessages, setProviderMessages] = useState<Record<string, string>>({});
  const [connectOpen, setConnectOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [authTokenOpen, setAuthTokenOpen] = useState(false);
  const [authToken, setAuthToken] = useState("");
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [formError, setFormError] = useState("");
  const [cloudflare, setCloudflare] = useState<CloudflareConnectionRecord | null>(initial.cloudflare);
  const [sites, setSites] = useState<CloudflareSiteListEntry[]>(initial.sites);
  const [cloudflareAction, setCloudflareAction] = useState<Action>(null);
  const [cloudflareMessage, setCloudflareMessage] = useState("");
  const [cloudflareConnectOpen, setCloudflareConnectOpen] = useState(false);
  const [cloudflareRotateOpen, setCloudflareRotateOpen] = useState(false);
  const [cloudflareDisconnectOpen, setCloudflareDisconnectOpen] = useState(false);
  const [cloudflareForm, setCloudflareForm] = useState<CloudflareFormValues>(emptyCloudflareForm);
  const [cloudflareFormError, setCloudflareFormError] = useState("");
  const [dataforseo, setDataforseo] = useState<DataForSeoConnectionRecord | null>(initial.dataforseo ?? null);
  const [dataforseoAction, setDataforseoAction] = useState<Action>(null);
  const [dataforseoMessage, setDataforseoMessage] = useState("");
  const [dataforseoDialog, setDataforseoDialog] = useState<"connect" | "rotate" | "disconnect" | null>(null);
  const [dataforseoForm, setDataforseoForm] = useState<DataForSeoFormValues>(emptyDataForSeoForm);
  const [dataforseoFormError, setDataforseoFormError] = useState("");

  async function reload() {
    setRefreshError(false);
    try {
      const response = await fetch("/api/integrations");
      if (!response.ok) throw new Error("Integrations unavailable");
      const body = await responseBody(response) as unknown as IntegrationResponse;
      setProviders(Array.isArray(body.providers) ? body.providers : []);
      setTwilio(body.twilio ?? null);
      if (body.twilio) {
        const numbersResponse = await fetch("/api/integrations/twilio/numbers");
        if (!numbersResponse.ok) throw new Error("Integrations unavailable");
        const numbersBody = await responseBody(numbersResponse);
        setNumbers(Array.isArray(numbersBody.numbers) ? numbersBody.numbers as TwilioNumberRecord[] : []);
      } else {
        setNumbers([]);
      }
      setCloudflare(body.cloudflare ?? null);
      if (body.cloudflare) {
        const sitesResponse = await fetch("/api/integrations/cloudflare/sites");
        if (!sitesResponse.ok) throw new Error("Integrations unavailable");
        const sitesBody = await responseBody(sitesResponse);
        setSites(Array.isArray(sitesBody.sites) ? sitesBody.sites as CloudflareSiteListEntry[] : []);
      } else {
        setSites([]);
      }
      setDataforseo(body.dataforseo ?? null);
    } catch {
      setRefreshError(true);
    }
  }

  async function submitDataForSeo(event: FormEvent<HTMLFormElement>, route: "connect" | "rotate") {
    event.preventDefault();
    setDataforseoFormError("");
    setDataforseoAction(route === "rotate" ? "rotate" : null);
    const payload = route === "connect" ? dataforseoForm : { password: dataforseoForm.password };
    const response = await mutationFetch(`/api/integrations/dataforseo/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    if (!response) {
      setDataforseoFormError("Connection failed.");
      setDataforseoAction(null);
      return;
    }
    const body = await responseBody(response);
    if (!response.ok) {
      setDataforseoFormError(dataforseoError(response.status, body.detail, "Connection failed."));
      setDataforseoAction(null);
      return;
    }
    setDataforseoDialog(null);
    setDataforseoForm(emptyDataForSeoForm);
    await reload();
    setStatus(route === "connect" ? "DataForSEO connected." : "DataForSEO password rotated.");
    setDataforseoAction(null);
  }

  async function runDataForSeo(action: "test" | "disconnect") {
    setDataforseoAction(action);
    setDataforseoMessage("");
    const response = await mutationFetch(`/api/integrations/dataforseo/${action}`, { method: "POST" }).catch(() => null);
    const body = response ? await responseBody(response) : {};
    if (response?.ok) {
      if (action === "disconnect") setDataforseoDialog(null);
      await reload();
      setStatus(action === "test" ? "DataForSEO connection verified." : "DataForSEO disconnected.");
    } else {
      setDataforseoMessage(`DataForSEO ${action} failed.${typeof body.detail === "string" ? ` ${body.detail}` : ""}`);
      if (action === "test") await reload();
    }
    setDataforseoAction(null);
  }

  function openDataForSeoDialog(dialog: "connect" | "rotate" | "disconnect") {
    setDataforseoForm(emptyDataForSeoForm);
    setDataforseoFormError("");
    setDataforseoMessage("");
    setDataforseoDialog(dialog);
  }

  async function submitCloudflare(event: FormEvent<HTMLFormElement>, route: "connect" | "rotate") {
    event.preventDefault();
    setCloudflareFormError("");
    setCloudflareAction(route === "rotate" ? "rotate" : null);
    const payload = route === "connect" ? cloudflareForm : { apiToken: cloudflareForm.apiToken };
    const response = await mutationFetch(`/api/integrations/cloudflare/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    if (!response) {
      setCloudflareFormError("Connection failed.");
      setCloudflareAction(null);
      return;
    }
    const body = await responseBody(response);
    if (!response.ok) {
      setCloudflareFormError(cloudflareError(response.status, body.detail, "Connection failed."));
      setCloudflareAction(null);
      return;
    }
    setCloudflareConnectOpen(false);
    setCloudflareRotateOpen(false);
    setCloudflareForm(emptyCloudflareForm);
    await reload();
    setStatus(route === "connect" ? "Cloudflare connected." : "Cloudflare token rotated.");
    setCloudflareAction(null);
  }

  async function runCloudflare(action: "test" | "sync" | "disconnect") {
    setCloudflareAction(action);
    setCloudflareMessage("");
    const response = await mutationFetch(`/api/integrations/cloudflare/${action}`, { method: "POST" }).catch(() => null);
    const body = response ? await responseBody(response) : {};
    if (response?.ok) {
      if (action === "disconnect") setCloudflareDisconnectOpen(false);
      await reload();
      setStatus(action === "test" ? "Cloudflare connection verified." : action === "sync" ? `Synced ${typeof body.siteCount === "number" ? body.siteCount : 0} Sites.` : "Cloudflare disconnected.");
    } else if (action === "disconnect" && response?.status === 409 && typeof body.activeSiteLinkCount === "number") {
      setCloudflareMessage(`Disconnect is blocked while ${body.activeSiteLinkCount} Site Links are open.`);
    } else {
      setCloudflareMessage(`Cloudflare ${action} failed.${typeof body.detail === "string" ? ` ${body.detail}` : ""}`);
      if (action === "test") await reload();
    }
    setCloudflareAction(null);
  }

  function openCloudflareDialog(dialog: "connect" | "rotate") {
    setCloudflareForm(emptyCloudflareForm);
    setCloudflareFormError("");
    if (dialog === "connect") setCloudflareConnectOpen(true);
    else setCloudflareRotateOpen(true);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function resetForm() {
    setForm(emptyForm);
    setFormError("");
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const response = await mutationFetch("/api/integrations/twilio/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => null);
    if (!response) {
      setFormError("Connection failed.");
      return;
    }
    const body = await responseBody(response);
    if (!response.ok) {
      setFormError(providerError(response.status, body.detail, "Connection failed."));
      return;
    }
    setConnectOpen(false);
    resetForm();
    await reload();
    setStatus("Twilio connected.");
  }

  async function rotate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setTwilioAction("rotate");
    const response = await mutationFetch("/api/integrations/twilio/rotate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKeySid: form.apiKeySid, apiKeySecret: form.apiKeySecret }),
    }).catch(() => null);
    if (!response) {
      setFormError("Connection failed.");
      setTwilioAction(null);
      return;
    }
    const body = await responseBody(response);
    if (!response.ok) {
      setFormError(providerError(response.status, body.detail, "Connection failed."));
      setTwilioAction(null);
      return;
    }
    setRotateOpen(false);
    resetForm();
    await reload();
    setStatus("Twilio API key rotated.");
    setTwilioAction(null);
  }

  async function saveAuthToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setTwilioAction("authToken");
    const response = await mutationFetch("/api/integrations/twilio/auth-token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ authToken }),
    }).catch(() => null);
    if (!response) {
      setFormError("Connection failed.");
      setTwilioAction(null);
      return;
    }
    const body = await responseBody(response);
    if (!response.ok) {
      setFormError(response.status === 400 ? "Enter the Twilio Auth Token." : providerError(response.status, body.detail, "Connection failed."));
      setTwilioAction(null);
      return;
    }
    setAuthTokenOpen(false);
    setAuthToken("");
    await reload();
    setStatus("Twilio Auth Token saved.");
    setTwilioAction(null);
  }

  async function testTwilio() {
    setTwilioAction("test");
    setTwilioError("");
    setTwilioRetry(false);
    const response = await mutationFetch("/api/integrations/twilio/test", { method: "POST" }).catch(() => null);
    if (response?.ok) {
      setStatus("Twilio connection verified.");
    } else {
      const body = response ? await responseBody(response) : {};
      setTwilioError(`Twilio test failed.${typeof body.detail === "string" ? ` ${body.detail}` : ""}`);
      setTwilioRetry(true);
    }
    await reload();
    setTwilioAction(null);
  }

  async function syncTwilio() {
    setTwilioAction("sync");
    setTwilioError("");
    const response = await mutationFetch("/api/integrations/twilio/sync-numbers", { method: "POST" }).catch(() => null);
    if (response?.ok) {
      const body = await responseBody(response);
      setNumbers(Array.isArray(body.numbers) ? body.numbers as TwilioNumberRecord[] : []);
      setStatus(`Synced ${Array.isArray(body.numbers) ? body.numbers.length : 0} numbers, skipped ${typeof body.skipped === "number" ? body.skipped : 0}.`);
      await reload();
    } else {
      const body = response ? await responseBody(response) : {};
      setTwilioError(`Twilio sync failed.${typeof body.detail === "string" ? ` ${body.detail}` : ""}`);
    }
    setTwilioAction(null);
  }

  async function disconnect() {
    setTwilioAction("disconnect");
    setTwilioError("");
    const response = await mutationFetch("/api/integrations/twilio/disconnect", { method: "POST" }).catch(() => null);
    if (response?.ok) {
      setDisconnectOpen(false);
      await reload();
      setStatus("Twilio disconnected.");
    } else {
      const body = response ? await responseBody(response) : {};
      if (response?.status === 409 && typeof body.activeWorkspaceCount === "number") {
        setTwilioError(`Disconnect is blocked while ${body.activeWorkspaceCount} Active Workspaces depend on Twilio.`);
      } else {
        setTwilioError("Disconnect failed.");
      }
    }
    setTwilioAction(null);
  }

  async function testProvider(id: "hyperdrive" | "email") {
    setProviderAction(id);
    setProviderErrors((current) => ({ ...current, [id]: "" }));
    const response = await mutationFetch(`/api/integrations/${id}/test`, { method: "POST" }).catch(() => null);
    const body = response ? await responseBody(response) : {};
    if (response?.ok && id === "hyperdrive") {
      setProviderMessages((current) => ({ ...current, hyperdrive: `Connection verified at ${formatDate(typeof body.checkedAt === "string" ? body.checkedAt : null)}` }));
    } else if (response?.ok && id === "email") {
      setProviderMessages((current) => ({ ...current, email: `Test email sent to ${typeof body.to === "string" ? body.to : "your address"}` }));
    } else if (id === "email" && response?.status === 409) {
      setProviderErrors((current) => ({ ...current, email: "Your address is not on the recipient allowlist." }));
    } else {
      setProviderErrors((current) => ({ ...current, [id]: id === "hyperdrive" ? "Hyperdrive test failed." : "Test email failed." }));
    }
    setProviderAction(null);
  }

  function openConnect() {
    resetForm();
    setConnectOpen(true);
  }

  function openRotate() {
    resetForm();
    setRotateOpen(true);
  }

  function openAuthToken() {
    setFormError("");
    setAuthToken("");
    setAuthTokenOpen(true);
  }

  const readyCount = providers.filter((provider) => provider.state === "connected" || provider.state === "configured").length;
  const records: ConnectionRecords = { twilio, cloudflare, dataforseo, sites };
  const selected = providers.find((provider) => provider.id === selectedId) ?? providers[0];
  const connections = providers.filter((provider) => provider.group === "connection");
  const services = providers.filter((provider) => provider.group === "service");
  const headingId = `integration-${selected.id}`;

  const connectAction: Partial<Record<ProviderId, () => void>> = {
    twilio: openConnect,
    cloudflare: () => openCloudflareDialog("connect"),
    dataforseo: () => openDataForSeoDialog("connect"),
  };

  // Needs attention: what the Operator can resolve from this page, in page order.
  const attention: { key: string; provider: ProviderHealth; message: string; action: ReactNode }[] = [];
  for (const provider of providers) {
    if (provider.connectable && provider.state === "not_configured") {
      attention.push({ key: `${provider.id}-connect`, provider, message: provider.note ?? "Not connected", action: <Button type="button" size="sm" onClick={connectAction[provider.id]}>Connect {provider.name}</Button> });
    }
    if (provider.id === "twilio" && twilio && !twilio.authTokenConfigured) {
      attention.push({ key: "twilio-auth-token", provider, message: "The webhook Auth Token is not configured, so Twilio webhooks cannot be verified.", action: <Button type="button" size="sm" variant="outline" onClick={openAuthToken}>Set Auth Token</Button> });
    }
    if (provider.state === "degraded") {
      const message = provider.mediaLifecycle?.stuckCount
        ? `${provider.mediaLifecycle.stuckCount} purged or expired Recordings still have media to clean up.`
        : provider.lastFailureDetail ?? provider.note ?? `Last failure ${formatDate(provider.lastFailureAt)}.`;
      attention.push({ key: `${provider.id}-degraded`, provider, message, action: provider.id === selected.id ? null : <Button type="button" size="sm" variant="outline" render={<Link href={`/integrations?provider=${provider.id}`} scroll={false} />}>View</Button> });
    }
  }

  function detailActions(provider: ProviderHealth): ReactNode {
    if (provider.id === "twilio") {
      if (!twilio) return provider.connectable ? <Button type="button" onClick={openConnect}>Connect Twilio</Button> : null;
      const busy = twilioAction !== null;
      const progress = actionText(twilioAction);
      return (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => void testTwilio()}>{twilioAction === "test" ? <><Spinner /> {progress}</> : "Test Connection"}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void syncTwilio()}>{twilioAction === "sync" ? <><Spinner /> {progress}</> : "Sync Numbers"}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={openRotate}>Rotate Key</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={openAuthToken}>Set Auth Token</Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => setDisconnectOpen(true)}>Disconnect</Button>
        </div>
      );
    }
    if (provider.id === "cloudflare") {
      if (!cloudflare) return provider.connectable ? <Button type="button" onClick={() => openCloudflareDialog("connect")}>Connect Cloudflare</Button> : null;
      const busy = cloudflareAction !== null;
      return (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => void runCloudflare("test")}>{cloudflareAction === "test" ? <><Spinner /> Testing...</> : "Test Connection"}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void runCloudflare("sync")}>{cloudflareAction === "sync" ? <><Spinner /> Syncing...</> : "Sync now"}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => openCloudflareDialog("rotate")}>Rotate Token</Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => { setCloudflareMessage(""); setCloudflareDisconnectOpen(true); }}>Disconnect</Button>
        </div>
      );
    }
    if (provider.id === "dataforseo") {
      if (!dataforseo) return provider.connectable ? <Button type="button" onClick={() => openDataForSeoDialog("connect")}>Connect DataForSEO</Button> : null;
      const busy = dataforseoAction !== null;
      return (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => void runDataForSeo("test")}>{dataforseoAction === "test" ? <><Spinner /> Testing...</> : "Test Connection"}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => openDataForSeoDialog("rotate")}>Rotate Password</Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => openDataForSeoDialog("disconnect")}>Disconnect</Button>
        </div>
      );
    }
    if ((provider.id === "hyperdrive" || provider.id === "email") && provider.testable) {
      return <ProviderAction id={provider.id} action={providerAction} message={providerMessages[provider.id]} error={providerErrors[provider.id]} onClick={() => void testProvider(provider.id as "hyperdrive" | "email")} />;
    }
    return null;
  }

  function detailFacts(provider: ProviderHealth): Fact[] | null {
    if (provider.id === "twilio") return twilio ? twilioFacts(twilio) : null;
    if (provider.id === "cloudflare") return cloudflare ? cloudflareFacts(cloudflare) : null;
    if (provider.id === "dataforseo") return dataforseo ? dataforseoFacts(dataforseo) : null;
    return serviceFacts(provider);
  }

  function detailError(provider: ProviderHealth): ReactNode {
    if (provider.id === "twilio") return <ErrorLine error={twilioError} retry={twilioRetry && twilioAction === null ? () => void testTwilio() : null} />;
    if (provider.id === "cloudflare") return <ErrorLine error={cloudflareMessage} retry={cloudflareAction === null ? () => void runCloudflare("test") : null} />;
    if (provider.id === "dataforseo") return <ErrorLine error={dataforseoMessage} retry={dataforseoAction === null ? () => void runDataForSeo("test") : null} />;
    return null;
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
      {status ? <p role="status" className="text-sm">{status}</p> : null}
      {refreshError ? <div className="flex items-center gap-3"><p role="alert" className="text-sm">Integrations could not be refreshed.</p><Button type="button" variant="outline" onClick={() => void reload()}>Retry</Button></div> : null}

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
          <NavGroup label="Organization connections" providers={connections} current={selected.id} records={records} />
          <NavGroup label="Platform services" providers={services} current={selected.id} records={records} />
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
              {detailError(selected)}
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

      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Connect Twilio</DialogTitle><DialogDescription>Connect the Organization Twilio account.</DialogDescription></DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => void connect(event)}>
            <Field data-invalid={Boolean(formError)}><FieldLabel htmlFor="twilio-account-sid">Account SID</FieldLabel><Input id="twilio-account-sid" value={form.accountSid} onChange={(event) => setForm((current) => ({ ...current, accountSid: event.target.value }))} required />{formError ? <FieldError>{formError}</FieldError> : null}</Field>
            <Field><FieldLabel htmlFor="twilio-api-key-sid">API Key SID</FieldLabel><Input id="twilio-api-key-sid" value={form.apiKeySid} onChange={(event) => setForm((current) => ({ ...current, apiKeySid: event.target.value }))} required /></Field>
            <Field><FieldLabel htmlFor="twilio-api-key-secret">API Key Secret</FieldLabel><Input id="twilio-api-key-secret" type="password" autoComplete="off" value={form.apiKeySecret} onChange={(event) => setForm((current) => ({ ...current, apiKeySecret: event.target.value }))} required /><FieldDescription>The secret is encrypted with the deployment master key and never shown again.</FieldDescription></Field>
            <DialogFooter><Button type="submit">Connect</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={rotateOpen} onOpenChange={setRotateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rotate Twilio API Key</DialogTitle><DialogDescription>Verify the replacement key before changing the connection.</DialogDescription></DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => void rotate(event)}>
            <Field data-invalid={Boolean(formError)}><FieldLabel htmlFor="rotate-api-key-sid">API Key SID</FieldLabel><Input id="rotate-api-key-sid" value={form.apiKeySid} onChange={(event) => setForm((current) => ({ ...current, apiKeySid: event.target.value }))} required />{formError ? <FieldError>{formError}</FieldError> : null}</Field>
            <Field><FieldLabel htmlFor="rotate-api-key-secret">API Key Secret</FieldLabel><Input id="rotate-api-key-secret" type="password" autoComplete="off" value={form.apiKeySecret} onChange={(event) => setForm((current) => ({ ...current, apiKeySecret: event.target.value }))} required /></Field>
            <DialogFooter><Button type="submit">Rotate Key</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={authTokenOpen} onOpenChange={setAuthTokenOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Set Twilio Auth Token</DialogTitle><DialogDescription>Tracer verifies Twilio webhook signatures with the account Auth Token. It is verified, encrypted, and never displayed again.</DialogDescription></DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => void saveAuthToken(event)}>
            <Field data-invalid={Boolean(formError)}><FieldLabel htmlFor="twilio-auth-token">Auth Token</FieldLabel><Input id="twilio-auth-token" type="password" autoComplete="off" value={authToken} onChange={(event) => setAuthToken(event.target.value)} required />{formError ? <FieldError>{formError}</FieldError> : null}</Field>
            <DialogFooter><Button type="submit" disabled={twilioAction === "authToken"}>{twilioAction === "authToken" ? <><Spinner /> Saving...</> : "Save Auth Token"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={cloudflareConnectOpen} onOpenChange={setCloudflareConnectOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Connect Cloudflare</DialogTitle><DialogDescription>Connect the Organization Cloudflare account with an Account ID and a scoped API token.</DialogDescription></DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => void submitCloudflare(event, "connect")}>
            <Field data-invalid={Boolean(cloudflareFormError)}><FieldLabel htmlFor="cloudflare-account-id">Account ID</FieldLabel><Input id="cloudflare-account-id" className="font-mono" value={cloudflareForm.accountId} onChange={(event) => setCloudflareForm((current) => ({ ...current, accountId: event.target.value }))} required />{cloudflareFormError ? <FieldError>{cloudflareFormError}</FieldError> : null}</Field>
            <Field>
              <FieldLabel htmlFor="cloudflare-api-token">API Token</FieldLabel>
              <Input id="cloudflare-api-token" type="password" autoComplete="off" value={cloudflareForm.apiToken} onChange={(event) => setCloudflareForm((current) => ({ ...current, apiToken: event.target.value }))} required />
              <FieldDescription>Create the token on the Cloudflare <a className="underline" href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">API tokens</a> page with these permissions. It is encrypted with the deployment master key and never shown again.</FieldDescription>
              <ul className="list-disc pl-5 text-xs text-muted-foreground">{cloudflareTokenPermissions.map((permission) => <li key={permission}>{permission}</li>)}</ul>
            </Field>
            <DialogFooter><Button type="submit">Connect</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={cloudflareRotateOpen} onOpenChange={setCloudflareRotateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rotate Cloudflare Token</DialogTitle><DialogDescription>Verify the replacement token before changing the connection.</DialogDescription></DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => void submitCloudflare(event, "rotate")}>
            <Field data-invalid={Boolean(cloudflareFormError)}><FieldLabel htmlFor="cloudflare-rotate-token">API Token</FieldLabel><Input id="cloudflare-rotate-token" type="password" autoComplete="off" value={cloudflareForm.apiToken} onChange={(event) => setCloudflareForm((current) => ({ ...current, apiToken: event.target.value }))} required />{cloudflareFormError ? <FieldError>{cloudflareFormError}</FieldError> : null}</Field>
            <DialogFooter><Button type="submit" disabled={cloudflareAction === "rotate"}>{cloudflareAction === "rotate" ? <><Spinner /> Rotating...</> : "Rotate Token"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={cloudflareDisconnectOpen} onOpenChange={setCloudflareDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Disconnect Cloudflare?</AlertDialogTitle><AlertDialogDescription>The encrypted token is removed. Discovered Sites and their synced traffic stay until the account is connected again.</AlertDialogDescription></AlertDialogHeader>
          {cloudflareMessage ? <p role="alert">{cloudflareMessage}</p> : null}
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={cloudflareAction !== null} onClick={() => void runCloudflare("disconnect")}>{cloudflareAction === "disconnect" ? <><Spinner /> Disconnecting...</> : "Disconnect"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={dataforseoDialog === "connect"} onOpenChange={(open) => setDataforseoDialog(open ? "connect" : null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Connect DataForSEO</DialogTitle><DialogDescription>Connect the Organization DataForSEO account with its API login and password.</DialogDescription></DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => void submitDataForSeo(event, "connect")}>
            <Field data-invalid={Boolean(dataforseoFormError)}><FieldLabel htmlFor="dataforseo-login">API login</FieldLabel><Input id="dataforseo-login" className="font-mono" autoComplete="off" value={dataforseoForm.login} onChange={(event) => setDataforseoForm((current) => ({ ...current, login: event.target.value }))} required />{dataforseoFormError ? <FieldError>{dataforseoFormError}</FieldError> : null}</Field>
            <Field>
              <FieldLabel htmlFor="dataforseo-password">API password</FieldLabel>
              <Input id="dataforseo-password" type="password" autoComplete="off" value={dataforseoForm.password} onChange={(event) => setDataforseoForm((current) => ({ ...current, password: event.target.value }))} required />
              <FieldDescription>Find both on the DataForSEO <a className="underline" href="https://app.dataforseo.com/api-access" target="_blank" rel="noreferrer">API access</a> page. The password is encrypted with the deployment master key and never shown again. Each Keyword check costs about $0.002.</FieldDescription>
            </Field>
            <DialogFooter><Button type="submit">Connect</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dataforseoDialog === "rotate"} onOpenChange={(open) => setDataforseoDialog(open ? "rotate" : null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rotate DataForSEO Password</DialogTitle><DialogDescription>Verify the replacement password before changing the connection.</DialogDescription></DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => void submitDataForSeo(event, "rotate")}>
            <Field data-invalid={Boolean(dataforseoFormError)}><FieldLabel htmlFor="dataforseo-rotate-password">API password</FieldLabel><Input id="dataforseo-rotate-password" type="password" autoComplete="off" value={dataforseoForm.password} onChange={(event) => setDataforseoForm((current) => ({ ...current, password: event.target.value }))} required />{dataforseoFormError ? <FieldError>{dataforseoFormError}</FieldError> : null}</Field>
            <DialogFooter><Button type="submit" disabled={dataforseoAction === "rotate"}>{dataforseoAction === "rotate" ? <><Spinner /> Rotating...</> : "Rotate Password"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={dataforseoDialog === "disconnect"} onOpenChange={(open) => setDataforseoDialog(open ? "disconnect" : null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Disconnect DataForSEO?</AlertDialogTitle><AlertDialogDescription>The encrypted password is removed. Keywords and their stored positions stay, and the daily check pauses until the account is connected again.</AlertDialogDescription></AlertDialogHeader>
          {dataforseoMessage ? <p role="alert">{dataforseoMessage}</p> : null}
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={dataforseoAction !== null} onClick={() => void runDataForSeo("disconnect")}>{dataforseoAction === "disconnect" ? <><Spinner /> Disconnecting...</> : "Disconnect"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Disconnect Twilio?</AlertDialogTitle><AlertDialogDescription>The encrypted credential and synced number inventory are removed.</AlertDialogDescription></AlertDialogHeader>
          {twilioError ? <p role="alert">{twilioError}</p> : null}
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={twilioAction !== null} onClick={() => void disconnect()}>{twilioAction === "disconnect" ? <><Spinner /> Disconnecting...</> : "Disconnect"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
