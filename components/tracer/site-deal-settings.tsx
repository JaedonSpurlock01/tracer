/**
 * -------------------------------------------------------------------------
 * @file   site-deal-settings.tsx
 * @brief  Edits a Site's Domain renewal and a Workspace's Deal in Site settings.
 *
 * @description
 *  DomainRenewalSettings records the registrar, the annual renewal price
 *  in dollars, and the renewal date of the linked Site, which the cost
 *  service amortizes over twelve months. DealSettings shows the open
 *  Deal in one line with Add, Edit, and End Deal through the shared Deal
 *  dialogs.
 *
 * @remarks
 *  The Domain renewal belongs to the Site, so it only renders with a
 *  linked Site; the Deal belongs to the Workspace and renders regardless.
 *
 * @see
 *  components/tracer/deal-editor.tsx
 *  components/tracer/workspace-settings-view.tsx
 *  data/sites.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DealActions, describeDeal } from "@/components/tracer/deal-editor";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import type { DealRecord } from "@/data/deals";
import type { SiteDomainRenewal } from "@/data/sites";

export function DomainRenewalSettings({ workspaceId, initial, onMessage }: { workspaceId: string; initial: SiteDomainRenewal; onMessage: (message: string) => void }) {
  const [registrar, setRegistrar] = useState(initial.registrar ?? "");
  const [price, setPrice] = useState(initial.renewalCents === null ? "" : (initial.renewalCents / 100).toFixed(2));
  const [renewsOn, setRenewsOn] = useState(initial.renewsOn ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const renewalCents = price === "" ? null : Math.round(Number(price) * 100);
    if (renewalCents !== null && (!Number.isFinite(renewalCents) || renewalCents < 0)) {
      setError("Enter the annual price in dollars.");
      return;
    }
    setBusy(true);
    setError("");
    const response = await mutationFetch(`/api/workspaces/${workspaceId}/site/domain`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ registrar: registrar.trim() || null, renewalCents, renewsOn: renewsOn || null }),
    }).catch(() => null);
    if (!response?.ok) {
      setError(response?.status === 400 ? "Enter a registrar of at most 80 characters, a price in dollars, and a renewal date." : "The Domain renewal could not be saved.");
    } else {
      const body = (await response.json()) as { domain: SiteDomainRenewal };
      setRegistrar(body.domain.registrar ?? "");
      setPrice(body.domain.renewalCents === null ? "" : (body.domain.renewalCents / 100).toFixed(2));
      setRenewsOn(body.domain.renewsOn ?? "");
      onMessage("Domain renewal saved.");
    }
    setBusy(false);
  }

  return (
    <section role="region" aria-labelledby="domain-renewal-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 id="domain-renewal-title" className="font-semibold">Domain renewal</h3>
        <p className="text-sm text-muted-foreground">What the Site&apos;s domain costs per year. One twelfth counts toward each month&apos;s cost.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="domain-registrar">Registrar</FieldLabel>
          <Input id="domain-registrar" value={registrar} maxLength={80} disabled={busy} onChange={(event) => setRegistrar(event.target.value)} />
        </Field>
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor="domain-renewal-price">Annual price</FieldLabel>
          <Input id="domain-renewal-price" type="number" inputMode="decimal" min="0" step="0.01" value={price} disabled={busy} onChange={(event) => setPrice(event.target.value)} />
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="domain-renews-on">Renewal date</FieldLabel>
          <Input id="domain-renews-on" type="date" value={renewsOn} disabled={busy} onChange={(event) => setRenewsOn(event.target.value)} />
        </Field>
      </div>
      <div>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void save()}>
          Save Domain renewal
        </Button>
      </div>
    </section>
  );
}

export function DealSettings({ workspaceId, initial, onMessage }: { workspaceId: string; initial: DealRecord | null; onMessage: (message: string) => void }) {
  const [deal, setDeal] = useState(initial);
  return (
    <section role="region" aria-labelledby="deal-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 id="deal-title" className="font-semibold">Deal</h3>
        <p className="text-sm text-muted-foreground">The agreement with this Workspace&apos;s business. At most one Deal is open at a time; ending one keeps it in history.</p>
      </div>
      <p className="text-sm">{describeDeal(deal)}</p>
      <DealActions workspaceId={workspaceId} deal={deal} onChange={setDeal} onMessage={onMessage} />
    </section>
  );
}
