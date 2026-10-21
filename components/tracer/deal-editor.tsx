/**
 * -------------------------------------------------------------------------
 * @file   deal-editor.tsx
 * @brief  Edits and ends a Workspace's Deal from a dialog.
 *
 * @description
 *  DealDialog adds a Deal or edits the open one with its kind (Monthly,
 *  Weekly, or Per Lead), amount in dollars, and start date, posting to
 *  the Workspace Deal routes. EndDealDialog confirms ending the open Deal
 *  on a date. describeDeal names a Deal in one line for the Site page,
 *  the Overview scorecard, and Site settings.
 *
 * @remarks
 *  The amount is entered in dollars and sent as integer cents, the unit
 *  the Deal routes store. Every save goes through mutationFetch so the
 *  Client Cache clears and the next page read shows the new revenue.
 *
 * @see
 *  data/deals.ts
 *  components/tracer/site-view.tsx
 *  components/tracer/site-deal-settings.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { useState } from "react";

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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCallDate } from "@/components/tracer/call-format";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import type { DealRecord } from "@/data/deals";
import { dealKinds, formatUsdCents, type DealKind } from "@/data/pricing";

const dealUnits: Record<DealKind, string> = { Monthly: "per month", Weekly: "per week", "Per Lead": "per Good Lead" };

export function formatCalendarDate(day: string): string {
  return formatCallDate(`${day}T12:00:00Z`, "UTC");
}

export function describeDeal(deal: DealRecord | null): string {
  if (!deal) return "No Deal";
  return `${deal.kind}, ${formatUsdCents(deal.amountCents)} ${dealUnits[deal.kind]}, since ${formatCalendarDate(deal.startedOn)}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function DealDialog({ open, onOpenChange, workspaceId, deal, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; workspaceId: string; deal: DealRecord | null; onSaved: (deal: DealRecord) => void }) {
  const [kind, setKind] = useState<DealKind>(deal?.kind ?? "Monthly");
  const [amount, setAmount] = useState(deal ? (deal.amountCents / 100).toFixed(2) : "");
  const [startedOn, setStartedOn] = useState(deal?.startedOn ?? today());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const amountCents = Math.round(Number(amount) * 100);
    if (!amount || !Number.isFinite(amountCents) || amountCents <= 0 || !startedOn) {
      setError("Enter an amount above zero and a start date.");
      return;
    }
    setBusy(true);
    setError("");
    const response = await mutationFetch(deal ? `/api/workspaces/${workspaceId}/deal/${deal.id}` : `/api/workspaces/${workspaceId}/deal`, {
      method: deal ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, amountCents, startedOn }),
    }).catch(() => null);
    if (!response?.ok) {
      setError(response?.status === 400 ? "Enter an amount above zero and a start date." : "The Deal could not be saved.");
    } else {
      const body = (await response.json()) as { deal: DealRecord };
      onSaved(body.deal);
      onOpenChange(false);
    }
    setBusy(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{deal ? "Edit Deal" : "Add Deal"}</DialogTitle>
          <DialogDescription>What this Workspace&apos;s business pays. Monthly and Weekly amounts project a fixed revenue; Per Lead pays per Good Lead in the month.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field>
            <FieldLabel htmlFor="deal-kind">Kind</FieldLabel>
            <Select value={kind} onValueChange={(value) => setKind((value as DealKind | null) ?? kind)} disabled={busy}>
              <SelectTrigger id="deal-kind" aria-label="Deal kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dealKinds.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor="deal-amount">Amount</FieldLabel>
            <Input id="deal-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} disabled={busy} onChange={(event) => setAmount(event.target.value)} />
            <p className="text-xs text-muted-foreground">US dollars {dealUnits[kind]}</p>
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="deal-started-on">Start date</FieldLabel>
            <Input id="deal-started-on" type="date" value={startedOn} disabled={busy} onChange={(event) => setStartedOn(event.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" disabled={busy} onClick={() => void save()}>
            Save Deal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EndDealDialog({ open, onOpenChange, workspaceId, deal, onEnded }: { open: boolean; onOpenChange: (open: boolean) => void; workspaceId: string; deal: DealRecord | null; onEnded: (deal: DealRecord) => void }) {
  const [endedOn, setEndedOn] = useState(today());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function end() {
    if (!deal) return;
    setBusy(true);
    setError("");
    const response = await mutationFetch(`/api/workspaces/${workspaceId}/deal/${deal.id}/end`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endedOn }),
    }).catch(() => null);
    if (!response?.ok) {
      setError(response?.status === 400 ? "The end date must be on or after the start date." : "The Deal could not be ended.");
    } else {
      const body = (await response.json()) as { deal: DealRecord };
      onEnded(body.deal);
      onOpenChange(false);
    }
    setBusy(false);
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>End this Deal?</AlertDialogTitle>
          <AlertDialogDescription>The Deal stays in history and projected revenue stops from its end date. A new Deal can be added afterwards.</AlertDialogDescription>
        </AlertDialogHeader>
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor="deal-ended-on">End date</FieldLabel>
          <Input id="deal-ended-on" type="date" value={endedOn} disabled={busy} onChange={(event) => setEndedOn(event.target.value)} />
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={(event) => { event.preventDefault(); void end(); }}>
            End Deal
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DealActions({ workspaceId, deal, onChange, onMessage }: { workspaceId: string; deal: DealRecord | null; onChange: (deal: DealRecord | null) => void; onMessage?: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [ending, setEnding] = useState(false);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
          {deal ? "Edit Deal" : "Add Deal"}
        </Button>
        {deal ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setEnding(true)}>
            End Deal
          </Button>
        ) : null}
      </div>
      {editing ? (
        <DealDialog
          open
          onOpenChange={(open) => setEditing(open)}
          workspaceId={workspaceId}
          deal={deal}
          onSaved={(saved) => {
            onChange(saved);
            onMessage?.("Deal saved.");
          }}
        />
      ) : null}
      {ending ? (
        <EndDealDialog
          open
          onOpenChange={(open) => setEnding(open)}
          workspaceId={workspaceId}
          deal={deal}
          onEnded={() => {
            onChange(null);
            onMessage?.("Deal ended.");
          }}
        />
      ) : null}
    </>
  );
}
