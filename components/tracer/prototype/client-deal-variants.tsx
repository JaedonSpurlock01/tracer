/**
 * PROTOTYPE - three layouts for Client information beside the Deal on the
 * Site settings section. Client fields (business name, contact first and
 * last name, email, niche, city) live in React state only; nothing posts.
 *
 * Layout references:
 *  A  Pipedrive / Attio deal detail: a plain field grid with the map as a
 *     peer column, so the map answers "where" while you type.
 *  B  Stripe Customer and Google Business Profile: a map banner headed by
 *     an identity card, facts in a row, editing in a dialog like the Deal.
 *  C  HubSpot "About this company" properties: click-to-edit rows in a
 *     definition list with a small map thumbnail that expands on click.
 */
"use client";

import { useState, type ReactNode } from "react";
import { Building2, MapPin, Pencil } from "lucide-react";

import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DealActions, describeDeal } from "@/components/tracer/deal-editor";
import { OsmMap, useGeocode } from "@/components/tracer/prototype/osm-map";
import type { DealRecord } from "@/data/deals";

export interface ClientInfo {
  businessName: string;
  firstName: string;
  lastName: string;
  email: string;
  niche: string;
  city: string;
}

export interface VariantProps {
  workspaceId: string;
  deal: DealRecord | null;
  initialClient: ClientInfo;
  onMessage: (message: string) => void;
}

const fields: ReadonlyArray<{ key: keyof ClientInfo; label: string; type?: string; placeholder: string }> = [
  { key: "businessName", label: "Business name", placeholder: "Acme Plumbing" },
  { key: "niche", label: "Niche", placeholder: "Plumber" },
  { key: "firstName", label: "First name", placeholder: "Jordan" },
  { key: "lastName", label: "Last name", placeholder: "Lee" },
  { key: "email", label: "Email", type: "email", placeholder: "jordan@acmeplumbing.com" },
  { key: "city", label: "City", placeholder: "Austin, TX" },
];

function contactName(client: ClientInfo): string {
  return [client.firstName, client.lastName].filter(Boolean).join(" ");
}

function ClientFieldGrid({ draft, onChange, columns = "sm:grid-cols-2" }: { draft: ClientInfo; onChange: (next: ClientInfo) => void; columns?: string }) {
  return (
    <div className={`grid gap-3 ${columns}`}>
      {fields.map((field) => (
        <Field key={field.key} className={field.key === "businessName" ? "sm:col-span-2" : ""}>
          <FieldLabel htmlFor={`client-${field.key}`}>{field.label}</FieldLabel>
          <Input id={`client-${field.key}`} type={field.type ?? "text"} value={draft[field.key]} placeholder={field.placeholder} maxLength={120} onChange={(event) => onChange({ ...draft, [field.key]: event.target.value })} />
        </Field>
      ))}
    </div>
  );
}

function GeocodeNote({ status, label }: { status: ReturnType<typeof useGeocode>["status"]; label: string }) {
  if (status === "loading") return <p className="text-xs text-muted-foreground">Locating…</p>;
  if (status === "missing") return <p className="text-xs text-muted-foreground">That city was not found on OpenStreetMap.</p>;
  if (status === "failed") return <p className="text-xs text-muted-foreground">OpenStreetMap could not be reached.</p>;
  if (status === "found") return <p className="truncate text-xs text-muted-foreground" title={label}>{label}</p>;
  return null;
}

/* ----------------------------------------------------------------------- */
/* A: Form beside map                                                        */
/* ----------------------------------------------------------------------- */

export function VariantA({ workspaceId, deal: initialDeal, initialClient, onMessage }: VariantProps) {
  const [deal, setDeal] = useState(initialDeal);
  const [client, setClient] = useState(initialClient);
  const [draft, setDraft] = useState(initialClient);
  const geocode = useGeocode(draft.city);
  const dirty = JSON.stringify(draft) !== JSON.stringify(client);
  return (
    <section role="region" aria-labelledby="client-deal-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h3 id="client-deal-title" className="font-semibold">Client and Deal</h3>
        <p className="text-sm text-muted-foreground">Who this Workspace&apos;s business is and what they pay. At most one Deal is open at a time.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-4">
          <ClientFieldGrid draft={draft} onChange={setDraft} />
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" disabled={!dirty} onClick={() => { setClient(draft); onMessage("Client saved."); }}>
              Save Client
            </Button>
            {dirty ? <span className="text-xs text-muted-foreground">Unsaved changes</span> : null}
          </div>
          <div className="flex flex-col gap-2 border-t pt-4">
            <p className="text-sm"><span className="font-medium">Deal: </span>{describeDeal(deal)}</p>
            <DealActions workspaceId={workspaceId} deal={deal} onChange={setDeal} onMessage={onMessage} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <OsmMap point={geocode.point} title="Client location" className="h-64 lg:h-full lg:min-h-80" placeholder="Enter a city to place this business on the map." />
          <GeocodeNote status={geocode.status} label={geocode.label} />
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------- */
/* B: Profile card over a map banner                                         */
/* ----------------------------------------------------------------------- */

function ClientDialog({ open, onOpenChange, client, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; client: ClientInfo; onSaved: (client: ClientInfo) => void }) {
  const [draft, setDraft] = useState(client);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Client</DialogTitle>
          <DialogDescription>The business behind this Workspace and the person you deal with.</DialogDescription>
        </DialogHeader>
        <ClientFieldGrid draft={draft} onChange={setDraft} />
        <DialogFooter>
          <Button type="button" onClick={() => { onSaved(draft); onOpenChange(false); }}>Save Client</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export function VariantB({ workspaceId, deal: initialDeal, initialClient, onMessage }: VariantProps) {
  const [deal, setDeal] = useState(initialDeal);
  const [client, setClient] = useState(initialClient);
  const [editing, setEditing] = useState(false);
  const geocode = useGeocode(client.city);
  return (
    <section role="region" aria-labelledby="client-deal-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 id="client-deal-title" className="font-semibold">Client</h3>
          <p className="text-sm text-muted-foreground">The business behind this Workspace, where it is, and its Deal.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>Edit Client</Button>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <OsmMap point={geocode.point} span={0.2} title="Client location" className="h-44 rounded-none border-0" placeholder={<span className="flex items-center gap-2"><MapPin className="size-4" aria-hidden="true" />Add a city to show the business on the map.</span>} />
        <div className="flex flex-col gap-4 p-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted">
              <Building2 className="size-5" aria-hidden="true" />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-base font-semibold">{client.businessName || "Unnamed business"}</span>
                {client.niche ? <Badge variant="secondary">{client.niche}</Badge> : null}
              </div>
              <p className="text-sm text-muted-foreground">{client.city ? client.city : "No city"}{geocode.status === "missing" ? " (not found on OpenStreetMap)" : ""}</p>
            </div>
          </div>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Fact label="Contact">{contactName(client) || "—"}</Fact>
            <Fact label="Email">{client.email ? <a className="underline" href={`mailto:${client.email}`}>{client.email}</a> : "—"}</Fact>
            <Fact label="Deal">{describeDeal(deal)}</Fact>
          </dl>
          <DealActions workspaceId={workspaceId} deal={deal} onChange={setDeal} onMessage={onMessage} />
        </div>
      </div>
      {editing ? <ClientDialog open onOpenChange={setEditing} client={client} onSaved={(next) => { setClient(next); onMessage("Client saved."); }} /> : null}
    </section>
  );
}

/* ----------------------------------------------------------------------- */
/* C: Dossier rows with click-to-edit                                        */
/* ----------------------------------------------------------------------- */

function EditableRow({ label, value, type, placeholder, onSave }: { label: string; value: string; type?: string; placeholder: string; onSave: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  function commit() {
    onSave(draft.trim());
    setEditing(false);
  }
  return (
    <div className="group grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-3 py-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0">
        {editing ? (
          <Input
            autoFocus
            aria-label={label}
            type={type ?? "text"}
            value={draft}
            placeholder={placeholder}
            className="h-8"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
              if (event.key === "Escape") { setDraft(value); setEditing(false); }
            }}
          />
        ) : (
          <button type="button" className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm -ml-2 hover:bg-muted" onClick={() => { setDraft(value); setEditing(true); }}>
            <span className={`truncate ${value ? "" : "text-muted-foreground"}`}>{value || placeholder}</span>
            <Pencil className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" aria-hidden="true" />
          </button>
        )}
      </dd>
    </div>
  );
}

export function VariantC({ workspaceId, deal: initialDeal, initialClient, onMessage }: VariantProps) {
  const [deal, setDeal] = useState(initialDeal);
  const [client, setClient] = useState(initialClient);
  const [expanded, setExpanded] = useState(false);
  const geocode = useGeocode(client.city);
  function set(key: keyof ClientInfo, value: string) {
    setClient((previous) => ({ ...previous, [key]: value }));
    onMessage("Client saved.");
  }
  return (
    <section role="region" aria-labelledby="client-deal-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 id="client-deal-title" className="font-semibold">Client and Deal</h3>
        <p className="text-sm text-muted-foreground">Click a value to change it. Changes save when you leave the field.</p>
      </div>
      <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-start">
        <dl className="min-w-0 flex-1 divide-y">
          {fields.map((field) => (
            <EditableRow key={field.key} label={field.label} value={client[field.key]} type={field.type} placeholder={field.placeholder} onSave={(value) => set(field.key, value)} />
          ))}
          <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-3 py-2">
            <dt className="text-sm text-muted-foreground">Deal</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-3 text-sm">
              <span>{describeDeal(deal)}</span>
              <DealActions workspaceId={workspaceId} deal={deal} onChange={setDeal} onMessage={onMessage} />
            </dd>
          </div>
        </dl>
        <div className="flex w-full flex-col gap-1 sm:w-72">
          {geocode.point ? (
            <button type="button" className="group relative block overflow-hidden rounded-lg" onClick={() => setExpanded(true)} aria-label="Expand the map">
              <OsmMap point={geocode.point} span={0.3} title="Client location" className="pointer-events-none h-52" />
              <span className="absolute bottom-1 right-1 rounded-md border bg-background/90 px-1.5 py-0.5 text-xs opacity-0 transition-opacity group-hover:opacity-100">Expand</span>
            </button>
          ) : (
            <OsmMap point={null} title="Client location" className="h-52" placeholder={<span className="flex flex-col items-center gap-1"><MapPin className="size-4" aria-hidden="true" />No city yet</span>} />
          )}
          <GeocodeNote status={geocode.status} label={geocode.label} />
        </div>
      </div>
      {expanded ? (
        <Dialog open onOpenChange={setExpanded}>
          <DialogContent className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{client.businessName || "Client"} in {client.city}</DialogTitle>
              <DialogDescription>{geocode.label}</DialogDescription>
            </DialogHeader>
            <OsmMap point={geocode.point} span={0.12} title="Client location, expanded" className="h-[28rem]" />
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
