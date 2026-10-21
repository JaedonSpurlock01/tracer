/**
 * -------------------------------------------------------------------------
 * @file   integrations-view.tsx
 * @brief  Renders the Operator Integrations provider health surface.
 *
 * @description
 *  Renders server-provided provider health, manages Twilio credentials and
 *  numbers, manages the Cloudflare connection and lists its Sites with
 *  their link state, manages the DataForSEO connection with its lookups
 *  this month and Keywords tracked, exposes safe Hyperdrive and Email
 *  Service test actions,
 *  lists recent Recording transfer failures for R2 and Trigger.dev,
 *  shows the OpenAI configured models, last successful Transcript and Lead
 *  Assessment, and recent processing failures, and lists on the Trigger.dev
 *  card the oldest purged or expired Recordings whose media cleanup is
 *  unfinished, each linking to its Call Detail.
 *
 * @remarks
 *  Provider actions remain behind the authenticated HTTP boundary. The first
 *  data arrives from the server, so the page never shows a loading Skeleton;
 *  it refreshes in place after mount and after each action, and a failed
 *  refresh keeps the current data with a Retry.
 *
 * @see
 *  data/integrations-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { Badge } from "@/components/reui/badge";
import { Frame, FramePanel } from "@/components/reui/frame";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import { callDetailHref } from "@/data/call-source";
import type { CloudflareConnectionRecord, CloudflareSiteListEntry } from "@/data/cloudflare-connection";
import type { DataForSeoConnectionRecord } from "@/data/dataforseo-connection";
import type { TwilioConnectionRecord, TwilioNumberRecord } from "@/data/integrations";
import type { SiteHealth } from "@/data/site-health";
import type { MediaLifecycleHealth, OpenAIAnalysisHealth, ProviderHealth, ProviderState, RecordingTransferFailure } from "@/data/provider-health";

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

function AnalysisDetails({ identifier, analysis }: { identifier: string | null; analysis: OpenAIAnalysisHealth }) {
  const rows: [string, string][] = [
    ["Identifier", identifier ?? "Not available"],
    ["Transcription model", analysis.transcriptionModel],
    ["Lead analysis model", analysis.leadAssessmentModel],
    ["Last successful Transcript", formatDate(analysis.lastTranscriptAt)],
    ["Last successful Lead Assessment", formatDate(analysis.lastLeadAssessmentAt)],
    ["Recent processing failures", String(analysis.failedCount)],
    ["Last failure", formatDate(analysis.lastFailureAt)],
  ];
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      {rows.map(([term, value]) => (
        <div key={term}>
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ProviderDetails({ provider }: { provider: ProviderHealth }) {
  if (provider.analysis) {
    return (
      <>
        <AnalysisDetails identifier={provider.identifier} analysis={provider.analysis} />
        {provider.note ? <p className="text-sm text-muted-foreground">{provider.note}</p> : null}
      </>
    );
  }
  return (
    <>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Identifier</dt>
          <dd>{provider.identifier ?? "Not available"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{provider.recentFailures ? "Last successful Recording transfer" : "Last successful check"}</dt>
          <dd>{formatDate(provider.lastSuccessAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Last failure</dt>
          <dd>{formatDate(provider.lastFailureAt)}</dd>
        </div>
        {provider.lastFailureDetail ? <div><dt className="text-muted-foreground">Failure detail</dt><dd>{provider.lastFailureDetail}</dd></div> : null}
      </dl>
      {provider.recentFailures ? <RecordingTransferFailures failures={provider.recentFailures} /> : null}
      {provider.mediaLifecycle ? <MediaLifecycle health={provider.mediaLifecycle} /> : null}
      {provider.note ? <p className="text-sm text-muted-foreground">{provider.note}</p> : null}
    </>
  );
}

function RecordingTransferFailures({ failures }: { failures: RecordingTransferFailure[] }) {
  if (!failures.length) return <p className="text-sm text-muted-foreground">No Recording transfer failures.</p>;
  return (
    <div className="overflow-x-auto">
      <table aria-label="Recent transfer failures" className="w-full text-sm">
        <caption className="sr-only">Recent transfer failures</caption>
        <thead><tr className="border-b text-left"><th className="px-2 py-2">Stage</th><th className="px-2 py-2">Reason</th><th className="px-2 py-2">Failed at</th></tr></thead>
        <tbody>{failures.map((failure, index) => <tr key={index} className="border-b"><td className="px-2 py-2">{failure.stage[0].toUpperCase() + failure.stage.slice(1)}</td><td className="px-2 py-2">{failure.reason}</td><td className="px-2 py-2 tabular-nums">{formatDate(failure.at)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function MediaLifecycle({ health }: { health: MediaLifecycleHealth }) {
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Unfinished media cleanup</dt>
          <dd className="tabular-nums">{health.stuckCount}</dd>
        </div>
      </dl>
      {health.oldestStuck.length ? (
        <div className="overflow-x-auto">
          <table aria-label="Unfinished media cleanup" className="w-full text-sm">
            <caption className="sr-only">Unfinished media cleanup</caption>
            <thead><tr className="border-b text-left"><th className="px-2 py-2">Call</th><th className="px-2 py-2">Workspace</th><th className="px-2 py-2">Media</th><th className="px-2 py-2">Since</th><th className="px-2 py-2">Detail</th></tr></thead>
            <tbody>{health.oldestStuck.map((entry) => <tr key={entry.callId} className="border-b"><td className="px-2 py-2"><Link href={callDetailHref({ id: entry.callId, workspaceId: entry.workspaceId }, null)} prefetch={false} className="font-medium hover:underline">View Call</Link></td><td className="px-2 py-2">{entry.workspaceName}</td><td className="px-2 py-2">{entry.media}</td><td className="px-2 py-2 tabular-nums">{formatDate(entry.since)}</td><td className="px-2 py-2">{entry.twilioNotConnected ? "Twilio is not connected" : "Retried by the daily sweep"}</td></tr>)}</tbody>
          </table>
        </div>
      ) : <p className="text-sm text-muted-foreground">No unfinished media cleanup.</p>}
    </div>
  );
}

export interface IntegrationsOverview {
  providers: ProviderHealth[];
  twilio: TwilioConnectionRecord | null;
  numbers: TwilioNumberRecord[];
  cloudflare: CloudflareConnectionRecord | null;
  sites: CloudflareSiteListEntry[];
  dataforseo?: DataForSeoConnectionRecord | null;
}

export default function IntegrationsView({ initial }: { initial: IntegrationsOverview }) {
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
  const twilioProvider = providers.find((provider) => provider.id === "twilio");
  const canConnect = !twilio && twilioProvider?.note === "No Organization Twilio credential is connected";
  const canConnectCloudflare = !cloudflare && providers.find((provider) => provider.id === "cloudflare")?.note === "No Organization Cloudflare credential is connected";
  const canConnectDataForSeo = !dataforseo && providers.find((provider) => provider.id === "dataforseo")?.note === "No Organization DataForSEO credential is connected";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground">{readyCount} of {providers.length} providers ready</p>
      </div>
      {status ? <p role="status">{status}</p> : null}
      {refreshError ? <div className="flex items-center gap-3"><p role="alert">Integrations could not be refreshed.</p><Button type="button" variant="outline" onClick={() => void reload()}>Retry</Button></div> : null}
      {providers.map((provider) => {
        const headingId = `integration-${provider.id}`;
        const isTwilio = provider.id === "twilio";
        return (
          <section key={provider.id} aria-labelledby={headingId}>
            <Frame>
              <FramePanel className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 id={headingId} className="text-lg font-semibold">{provider.name}</h2>
                  <Badge variant={stateVariant(provider.state)}>{stateLabel(provider.state)}</Badge>
                </div>
                <ProviderDetails provider={provider} />
                {isTwilio ? (
                  twilio ? <TwilioConnected connection={twilio} numbers={numbers} action={twilioAction} error={twilioError} retry={twilioRetry} onTest={() => void testTwilio()} onSync={() => void syncTwilio()} onRotate={openRotate} onSetAuthToken={openAuthToken} onDisconnect={() => setDisconnectOpen(true)} />
                    : canConnect ? <Button type="button" onClick={openConnect}>Connect Twilio</Button> : null
                ) : provider.id === "cloudflare" ? (
                  cloudflare ? <CloudflareConnected connection={cloudflare} sites={sites} action={cloudflareAction} error={cloudflareMessage} onTest={() => void runCloudflare("test")} onSync={() => void runCloudflare("sync")} onRotate={() => openCloudflareDialog("rotate")} onDisconnect={() => { setCloudflareMessage(""); setCloudflareDisconnectOpen(true); }} />
                    : canConnectCloudflare ? <Button type="button" onClick={() => openCloudflareDialog("connect")}>Connect Cloudflare</Button> : null
                ) : provider.id === "dataforseo" ? (
                  dataforseo ? <DataForSeoConnected connection={dataforseo} action={dataforseoAction} error={dataforseoMessage} onTest={() => void runDataForSeo("test")} onRotate={() => openDataForSeoDialog("rotate")} onDisconnect={() => openDataForSeoDialog("disconnect")} />
                    : canConnectDataForSeo ? <Button type="button" onClick={() => openDataForSeoDialog("connect")}>Connect DataForSEO</Button> : null
                ) : provider.id === "hyperdrive" && provider.testable ? (
                  <ProviderAction id="hyperdrive" action={providerAction} message={providerMessages.hyperdrive} error={providerErrors.hyperdrive} onClick={() => void testProvider("hyperdrive")} />
                ) : provider.id === "email" && provider.testable ? (
                  <ProviderAction id="email" action={providerAction} message={providerMessages.email} error={providerErrors.email} onClick={() => void testProvider("email")} />
                ) : null}
              </FramePanel>
            </Frame>
          </section>
        );
      })}

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

function ProviderAction({ id, action, message, error, onClick }: { id: "hyperdrive" | "email"; action: Action; message?: string; error?: string; onClick: () => void }) {
  return <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" disabled={action === id} onClick={onClick}>{action === id ? <><Spinner /> Testing...</> : id === "email" ? "Send Test Email" : "Test Connection"}</Button>{message ? <p>{message}</p> : null}{error ? <><p role="alert">{error}</p><Button type="button" variant="outline" onClick={onClick}>Retry</Button></> : null}</div>;
}

function TwilioConnected({ connection, numbers, action, error, retry, onTest, onSync, onRotate, onSetAuthToken, onDisconnect }: { connection: TwilioConnectionRecord; numbers: TwilioNumberRecord[]; action: Action; error: string; retry: boolean; onTest: () => void; onSync: () => void; onRotate: () => void; onSetAuthToken: () => void; onDisconnect: () => void }) {
  const busy = action !== null;
  const progress = actionText(action);
  return <div className="flex flex-col gap-4">
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Account SID</dt><dd>{connection.accountSid}</dd></div>
      <div><dt className="text-muted-foreground">API Key SID</dt><dd>{connection.apiKeySid}</dd></div>
      <div><dt className="text-muted-foreground">Account name</dt><dd>{connection.accountFriendlyName ?? "Not available"}</dd></div>
      <div><dt className="text-muted-foreground">Connected by</dt><dd>{connection.connectedBy?.name ?? "Unknown"}</dd></div>
      <div><dt className="text-muted-foreground">Connected at</dt><dd>{formatDate(connection.connectedAt)}</dd></div>
      <div><dt className="text-muted-foreground">Last verified</dt><dd>{formatDate(connection.lastVerifiedAt)}</dd></div>
      <div><dt className="text-muted-foreground">Webhook Auth Token</dt><dd><Badge variant={connection.authTokenConfigured ? "success-light" : "warning-light"}>{connection.authTokenConfigured ? "Configured" : "Not configured"}</Badge></dd></div>
    </dl>
    <p className="text-sm"><span>{connection.numberCount} eligible numbers</span>. Last synced {formatDate(connection.numbersSyncedAt)}.</p>
    <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Active Number Assignments</dt><dd>Available after Workspace activation</dd></div><div><dt className="text-muted-foreground">Webhook health</dt><dd>Available after call routing</dd></div></dl>
    {error ? <div className="flex items-center gap-3"><p role="alert">{error}</p>{retry ? <Button type="button" variant="outline" disabled={busy} onClick={onTest}>Retry</Button> : null}</div> : null}
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={busy} onClick={onTest}>{action === "test" ? <><Spinner /> {progress}</> : "Test Connection"}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={onSync}>{action === "sync" ? <><Spinner /> {progress}</> : "Sync Numbers"}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={onRotate}>{action === "rotate" ? <><Spinner /> Rotating...</> : "Rotate Key"}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={onSetAuthToken}>Set Auth Token</Button>
      <Button type="button" variant="destructive" disabled={busy} onClick={onDisconnect}>Disconnect</Button>
    </div>
    <div className="overflow-x-auto">
      {numbers.length ? <table aria-label="Twilio numbers" className="w-full text-sm"><caption className="sr-only">Twilio numbers</caption><thead><tr className="border-b text-left"><th className="px-2 py-2">Phone Number</th><th className="px-2 py-2">Friendly Name</th><th className="px-2 py-2">Voice</th><th className="px-2 py-2">Status</th></tr></thead><tbody>{numbers.map((number) => <tr key={number.id} className="border-b"><td className="px-2 py-2">{number.phoneNumber}</td><td className="px-2 py-2">{number.friendlyName}</td><td className="px-2 py-2">{number.voiceCapable ? "Yes" : "No"}</td><td className="px-2 py-2"><Badge variant={number.releasedAt ? "outline" : "success-light"}>{number.releasedAt ? "Released" : "Active"}</Badge></td></tr>)}</tbody></table> : <p className="text-sm text-muted-foreground">No numbers synced yet.</p>}
    </div>
  </div>;
}

function CloudflareConnected({ connection, sites, action, error, onTest, onSync, onRotate, onDisconnect }: { connection: CloudflareConnectionRecord; sites: CloudflareSiteListEntry[]; action: Action; error: string; onTest: () => void; onSync: () => void; onRotate: () => void; onDisconnect: () => void }) {
  const busy = action !== null;
  return <div className="flex flex-col gap-4">
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">Account ID</dt><dd className="font-mono">{connection.accountId}</dd></div>
      <div><dt className="text-muted-foreground">Connected by</dt><dd>{connection.connectedBy?.name ?? "Unknown"}</dd></div>
      <div><dt className="text-muted-foreground">Connected at</dt><dd>{formatDate(connection.connectedAt)}</dd></div>
      <div><dt className="text-muted-foreground">Last verified</dt><dd>{formatDate(connection.lastVerifiedAt)}</dd></div>
      <div><dt className="text-muted-foreground">Last sync</dt><dd>{formatDate(connection.lastSyncedAt)}</dd></div>
      <div><dt className="text-muted-foreground">Sites</dt><dd className="tabular-nums">{connection.siteCount}</dd></div>
    </dl>
    {error ? <div className="flex items-center gap-3"><p role="alert">{error}</p>{action === null ? <Button type="button" variant="outline" onClick={onTest}>Retry</Button> : null}</div> : null}
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={busy} onClick={onTest}>{action === "test" ? <><Spinner /> Testing...</> : "Test Connection"}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={onSync}>{action === "sync" ? <><Spinner /> Syncing...</> : "Sync now"}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={onRotate}>Rotate Token</Button>
      <Button type="button" variant="destructive" disabled={busy} onClick={onDisconnect}>Disconnect</Button>
    </div>
    <div className="overflow-x-auto">
      {sites.length ? <table aria-label="Sites" className="w-full text-sm">
        <caption className="sr-only">Sites</caption>
        <thead><tr className="border-b text-left"><th className="px-2 py-2">Preview</th><th className="px-2 py-2">Site</th><th className="px-2 py-2">Health</th><th className="px-2 py-2">Last deployment</th><th className="px-2 py-2">Visits (30 days)</th><th className="px-2 py-2">Workspace</th></tr></thead>
        <tbody>{sites.map((site) => <tr key={site.id} className="border-b">
          <td className="px-2 py-2"><div className="flex aspect-[16/10] w-20 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">No preview</div></td>
          <td className="px-2 py-2 font-mono">{site.primaryHostname}</td>
          <td className="px-2 py-2"><Badge variant={siteHealthVariant(site.health)}>{site.health}</Badge></td>
          <td className="px-2 py-2 tabular-nums">{formatDate(site.lastDeployedAt)}</td>
          <td className="px-2 py-2 tabular-nums">{visitsFormatter.format(site.visits30d)}</td>
          <td className="px-2 py-2">{site.linkedWorkspace ? <Link href={`/workspaces/${site.linkedWorkspace.id}`} prefetch={false} className="hover:underline">Linked to {site.linkedWorkspace.name}</Link> : <span className="text-muted-foreground">Not linked</span>}</td>
        </tr>)}</tbody>
      </table> : <p className="text-sm text-muted-foreground">No Sites with a custom domain were found on the account.</p>}
    </div>
  </div>;
}

function DataForSeoConnected({ connection, action, error, onTest, onRotate, onDisconnect }: { connection: DataForSeoConnectionRecord; action: Action; error: string; onTest: () => void; onRotate: () => void; onDisconnect: () => void }) {
  const busy = action !== null;
  return <div className="flex flex-col gap-4">
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div><dt className="text-muted-foreground">API login</dt><dd className="font-mono">{connection.login}</dd></div>
      <div><dt className="text-muted-foreground">Connected by</dt><dd>{connection.connectedBy?.name ?? "Unknown"}</dd></div>
      <div><dt className="text-muted-foreground">Connected at</dt><dd>{formatDate(connection.connectedAt)}</dd></div>
      <div><dt className="text-muted-foreground">Last verified</dt><dd>{formatDate(connection.lastVerifiedAt)}</dd></div>
      <div><dt className="text-muted-foreground">Last check</dt><dd>{formatDate(connection.lastCheckedAt)}</dd></div>
      <div><dt className="text-muted-foreground">Lookups this month</dt><dd className="tabular-nums">{visitsFormatter.format(connection.lookupsThisMonth)}</dd></div>
      <div><dt className="text-muted-foreground">Keywords tracked</dt><dd className="tabular-nums">{visitsFormatter.format(connection.keywordCount)}</dd></div>
    </dl>
    {error ? <div className="flex items-center gap-3"><p role="alert">{error}</p>{action === null ? <Button type="button" variant="outline" onClick={onTest}>Retry</Button> : null}</div> : null}
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={busy} onClick={onTest}>{action === "test" ? <><Spinner /> Testing...</> : "Test Connection"}</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={onRotate}>Rotate Password</Button>
      <Button type="button" variant="destructive" disabled={busy} onClick={onDisconnect}>Disconnect</Button>
    </div>
  </div>;
}
