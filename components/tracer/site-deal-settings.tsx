/**
 * -------------------------------------------------------------------------
 * @file   site-deal-settings.tsx
 * @brief  Edits a Site's Domain renewal and a Workspace's Business and Deal in Site settings.
 *
 * @description
 *  DomainRenewalSettings records the registrar, the annual renewal price
 *  in dollars, and the renewal date of the linked Site, which the cost
 *  service amortizes over twelve months. BusinessAndDealSettings edits
 *  the Business behind the Workspace (its name, contact, email, niche,
 *  own website, and city) beside a map of the chosen city, and shows the
 *  open Deal in one line with Add, Edit, and End Deal through the shared
 *  Deal dialogs.
 *
 * @remarks
 *  The Domain renewal belongs to the Site, so it only renders with a
 *  linked Site; the Business and Deal belong to the Workspace and render
 *  regardless. The city field asks the Places route after a pause in
 *  typing and keeps the chosen result's point, so the map and the stored
 *  point only ever come from a lookup result.
 *
 * @see
 *  components/tracer/deal-editor.tsx
 *  components/tracer/location-map.tsx
 *  components/tracer/workspace-settings-view.tsx
 *  data/business.ts
 *  data/sites.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DealActions, describeDeal } from "@/components/tracer/deal-editor";
import LocationMap from "@/components/tracer/location-map";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import type { BusinessRecord } from "@/data/business";
import type { DealRecord } from "@/data/deals";
import type { PlaceRecord } from "@/data/places-client";
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

type BusinessDraft = Pick<BusinessRecord, "name" | "firstName" | "lastName" | "email" | "niche" | "website" | "city" | "cityPoint">;

const emptyBusiness: BusinessDraft = { name: null, firstName: null, lastName: null, email: null, niche: null, website: null, city: null, cityPoint: null };

const businessFields: ReadonlyArray<{ key: Exclude<keyof BusinessDraft, "city" | "cityPoint">; label: string; type?: string; maxLength: number; wide?: boolean }> = [
  { key: "name", label: "Business name", maxLength: 120, wide: true },
  { key: "niche", label: "Niche", maxLength: 80 },
  { key: "website", label: "Their website", type: "url", maxLength: 200 },
  { key: "firstName", label: "First name", maxLength: 80 },
  { key: "lastName", label: "Last name", maxLength: 80 },
  { key: "email", label: "Email", type: "email", maxLength: 200 },
];

/** Edits the Business's city with a lookup, keeping the chosen result's point. */
function CityLookup({ city, point, disabled, onChange }: { city: string; point: BusinessDraft["cityPoint"]; disabled: boolean; onChange: (city: string, point: BusinessDraft["cityPoint"]) => void }) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<PlaceRecord[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/workspaces/places?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal }).catch(() => null);
      if (controller.signal.aborted) return;
      if (!response?.ok) {
        setFailed(true);
        setPlaces([]);
        return;
      }
      const body = (await response.json()) as { places: PlaceRecord[] };
      setFailed(false);
      setPlaces(body.places);
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function type(value: string) {
    onChange(value, null);
    setQuery(value);
    if (value.trim().length < 2) {
      setPlaces([]);
      setFailed(false);
    }
  }

  function pick(place: PlaceRecord) {
    onChange(place.label, { latitude: place.latitude, longitude: place.longitude });
    setQuery("");
    setPlaces([]);
  }

  const open = places.length > 0;
  return (
    <Field className="relative">
      <FieldLabel htmlFor="business-city">City</FieldLabel>
      <Input
        id="business-city"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        value={city}
        maxLength={160}
        disabled={disabled}
        onChange={(event) => type(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Escape") setPlaces([]); }}
      />
      {open ? (
        <div id={listId} role="listbox" aria-label="Matching cities" className="absolute top-full z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover py-1 shadow-md">
          {places.map((place) => (
            <button key={place.label} type="button" role="option" aria-selected={false} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent" onClick={() => pick(place)}>
              {place.label}
            </button>
          ))}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {failed ? "City lookup is unavailable right now." : point ? "Placed on the map." : city ? "Pick a match to place it on the map." : "Type a city and pick a match."}
      </p>
    </Field>
  );
}

export function BusinessAndDealSettings({ workspaceId, initialBusiness, initialDeal, onMessage }: { workspaceId: string; initialBusiness: BusinessRecord | null; initialDeal: DealRecord | null; onMessage: (message: string) => void }) {
  const [deal, setDeal] = useState(initialDeal);
  const [saved, setSaved] = useState<BusinessDraft>(initialBusiness ?? emptyBusiness);
  const [draft, setDraft] = useState<BusinessDraft>(initialBusiness ?? emptyBusiness);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  async function save() {
    setBusy(true);
    setError("");
    const response = await mutationFetch(`/api/workspaces/${workspaceId}/business`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    }).catch(() => null);
    if (!response?.ok) {
      setError(response?.status === 400 ? "Enter a valid email and website, and keep each field within its length." : "The Business could not be saved.");
    } else {
      const body = (await response.json()) as { business: BusinessRecord };
      setSaved(body.business);
      setDraft(body.business);
      onMessage("Business saved.");
    }
    setBusy(false);
  }

  return (
    <section role="region" aria-labelledby="business-deal-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h3 id="business-deal-title" className="font-semibold">Business and Deal</h3>
        <p className="text-sm text-muted-foreground">The client behind this Workspace and what they pay. At most one Deal is open at a time; ending one keeps it in history.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {businessFields.map((field) => (
              <Field key={field.key} className={field.wide ? "sm:col-span-2" : ""} data-invalid={Boolean(error) && (field.key === "email" || field.key === "website")}>
                <FieldLabel htmlFor={`business-${field.key}`}>{field.label}</FieldLabel>
                <Input id={`business-${field.key}`} type={field.type ?? "text"} value={draft[field.key] ?? ""} maxLength={field.maxLength} disabled={busy} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} />
              </Field>
            ))}
            <CityLookup city={draft.city ?? ""} point={draft.cityPoint} disabled={busy} onChange={(city, cityPoint) => setDraft({ ...draft, city, cityPoint })} />
          </div>
          {error ? <FieldError>{error}</FieldError> : null}
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" disabled={busy || !dirty} onClick={() => void save()}>
              Save Business
            </Button>
            {dirty ? <span className="text-xs text-muted-foreground">Unsaved changes</span> : null}
          </div>
          <div className="flex flex-col gap-2 border-t pt-4">
            <p className="text-sm">
              <span className="font-medium">Deal: </span>
              {describeDeal(deal)}
            </p>
            <DealActions workspaceId={workspaceId} deal={deal} onChange={setDeal} onMessage={onMessage} />
          </div>
        </div>
        <LocationMap point={draft.cityPoint} zoom={11} label={draft.city ? `Map of ${draft.city}` : "Map"} className="h-64 lg:h-full lg:min-h-80" placeholder="Pick a city to place this Business on the map." />
      </div>
    </section>
  );
}
