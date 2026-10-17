/**
 * -------------------------------------------------------------------------
 * @file   integrations-view.tsx
 * @brief  Renders the Operator Integrations provider health surface.
 *
 * @description
 *  Renders server-provided provider health, manages Twilio credentials and
 *  numbers, exposes safe Hyperdrive and Email Service test actions, and
 *  lists recent Recording transfer failures for R2 and Trigger.dev.
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
import type { TwilioConnectionRecord, TwilioNumberRecord } from "@/data/integrations";
import type { ProviderHealth, ProviderState, RecordingTransferFailure } from "@/data/provider-health";

type IntegrationResponse = {
  providers: ProviderHealth[];
  twilio: TwilioConnectionRecord | null;
};

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

function ProviderDetails({ provider }: { provider: ProviderHealth }) {
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

export interface IntegrationsOverview {
  providers: ProviderHealth[];
  twilio: TwilioConnectionRecord | null;
  numbers: TwilioNumberRecord[];
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
    } catch {
      setRefreshError(true);
    }
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
