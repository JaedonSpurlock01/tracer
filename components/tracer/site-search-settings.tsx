/**
 * -------------------------------------------------------------------------
 * @file   site-search-settings.tsx
 * @brief  Edits a linked Site's Service Area and Keywords.
 *
 * @description
 *  Renders the Service Area editor (city, region, country with Save) and
 *  the Keywords editor (each live Keyword with a weight Select and
 *  Remove, an add row with a phrase and weight, the count against the
 *  25 Keyword limit, and inline validation) inside the Workspace
 *  Settings Site section.
 *
 * @remarks
 *  Every change goes through the Workspace Site routes and then clears
 *  the Client Cache so the Site page's Search panel reads the new set.
 *  A duplicate phrase and the Keyword limit are reported inline from the
 *  route's conflict codes rather than guessed on the client.
 *
 * @see
 *  data/site-keywords.ts
 *  components/tracer/workspace-settings-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import { siteKeywordLimit, type ServiceArea, type SiteKeywordRecord } from "@/data/site-keywords";

export interface SiteSearchSettingsData {
  serviceArea: ServiceArea;
  keywords: SiteKeywordRecord[];
}

const weights = ["1", "2", "3", "4", "5"];

function WeightSelect({ id, label, value, disabled, onChange }: { id: string; label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next ?? value)} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label} className="w-20">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {weights.map((weight) => (
          <SelectItem key={weight} value={weight}>
            {weight}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function SiteSearchSettings({ workspaceId, initial, onMessage }: { workspaceId: string; initial: SiteSearchSettingsData; onMessage: (message: string) => void }) {
  const [area, setArea] = useState({ city: initial.serviceArea.city ?? "", region: initial.serviceArea.region ?? "", country: initial.serviceArea.country ?? "United States" });
  const [areaError, setAreaError] = useState("");
  const [keywords, setKeywords] = useState(initial.keywords);
  const [phrase, setPhrase] = useState("");
  const [weight, setWeight] = useState("1");
  const [addError, setAddError] = useState("");
  const [keywordError, setKeywordError] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/workspaces/${workspaceId}/site`;
  const atLimit = keywords.length >= siteKeywordLimit;

  async function saveServiceArea() {
    setBusy(true);
    setAreaError("");
    const response = await mutationFetch(`${base}/service-area`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ city: area.city, region: area.region, country: area.country }),
    }).catch(() => null);
    if (!response?.ok) {
      setAreaError(response?.status === 400 ? "Enter a city, region, and country of at most 80 characters each." : "The Service Area could not be saved.");
    } else {
      const body = (await response.json()) as { serviceArea: ServiceArea };
      setArea({ city: body.serviceArea.city ?? "", region: body.serviceArea.region ?? "", country: body.serviceArea.country ?? "United States" });
      onMessage("Service Area saved.");
    }
    setBusy(false);
  }

  async function addKeyword() {
    setAddError("");
    if (!phrase.trim()) {
      setAddError("Enter a phrase.");
      return;
    }
    setBusy(true);
    const response = await mutationFetch(`${base}/keywords`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phrase: phrase.trim(), weight: Number(weight) }),
    }).catch(() => null);
    const body = response ? ((await response.json().catch(() => ({}))) as { keyword?: SiteKeywordRecord; error?: string }) : {};
    if (response?.ok && body.keyword) {
      setKeywords((current) => [...current, body.keyword!]);
      setPhrase("");
      setWeight("1");
      onMessage("Keyword added.");
    } else if (body.error === "duplicate_phrase") {
      setAddError("This phrase is already tracked for the Site.");
    } else if (body.error === "keyword_limit") {
      setAddError(`At most ${siteKeywordLimit} Keywords per Site.`);
    } else if (response?.status === 400) {
      setAddError("Enter a phrase of at most 120 characters and a weight from 1 to 5.");
    } else {
      setAddError("The Keyword could not be added.");
    }
    setBusy(false);
  }

  async function changeWeight(keyword: SiteKeywordRecord, next: string) {
    setBusy(true);
    setKeywordError("");
    const response = await mutationFetch(`${base}/keywords/${keyword.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ weight: Number(next) }),
    }).catch(() => null);
    if (!response?.ok) {
      setKeywordError("The weight could not be changed.");
    } else {
      const body = (await response.json()) as { keyword: SiteKeywordRecord };
      setKeywords((current) => current.map((item) => (item.id === keyword.id ? body.keyword : item)));
    }
    setBusy(false);
  }

  async function removeKeyword(keyword: SiteKeywordRecord) {
    setBusy(true);
    setKeywordError("");
    const response = await mutationFetch(`${base}/keywords/${keyword.id}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) {
      setKeywordError("The Keyword could not be removed.");
    } else {
      setKeywords((current) => current.filter((item) => item.id !== keyword.id));
      onMessage("Keyword removed.");
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-8">
      <section role="region" aria-labelledby="service-area-title" className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 id="service-area-title" className="font-semibold">Service Area</h3>
          <p className="text-sm text-muted-foreground">Where the business serves. Keyword positions are checked from here.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="service-area-city">City</FieldLabel>
            <Input id="service-area-city" value={area.city} maxLength={80} onChange={(event) => setArea((current) => ({ ...current, city: event.target.value }))} />
          </Field>
          <Field>
            <FieldLabel htmlFor="service-area-region">Region</FieldLabel>
            <Input id="service-area-region" value={area.region} maxLength={80} onChange={(event) => setArea((current) => ({ ...current, region: event.target.value }))} />
          </Field>
          <Field data-invalid={Boolean(areaError)}>
            <FieldLabel htmlFor="service-area-country">Country</FieldLabel>
            <Input id="service-area-country" value={area.country} maxLength={80} onChange={(event) => setArea((current) => ({ ...current, country: event.target.value }))} />
            {areaError ? <FieldError>{areaError}</FieldError> : null}
          </Field>
        </div>
        <div>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void saveServiceArea()}>
            Save Service Area
          </Button>
        </div>
      </section>
      <section role="region" aria-labelledby="keywords-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h3 id="keywords-title" className="font-semibold">Keywords</h3>
            <p className="text-sm text-muted-foreground">Phrases checked daily from the Service Area. Weight sets how much each counts toward Search Visibility.</p>
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">{keywords.length} of {siteKeywordLimit} Keywords</p>
        </div>
        {keywordError ? <p role="alert" className="text-sm">{keywordError}</p> : null}
        {keywords.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Keywords yet. Add the phrases customers search for.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {keywords.map((keyword) => (
              <li key={keyword.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="truncate">{keyword.phrase}</span>
                <span className="flex items-center gap-2">
                  <WeightSelect id={`keyword-weight-${keyword.id}`} label={`Weight for ${keyword.phrase}`} value={String(keyword.weight)} disabled={busy} onChange={(next) => void changeWeight(keyword, next)} />
                  <Button type="button" variant="ghost" size="sm" disabled={busy} aria-label={`Remove ${keyword.phrase}`} onClick={() => void removeKeyword(keyword)}>
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <Field data-invalid={Boolean(addError)}>
            <FieldLabel htmlFor="keyword-phrase">Keyword phrase</FieldLabel>
            <Input id="keyword-phrase" value={phrase} maxLength={120} disabled={atLimit} onChange={(event) => setPhrase(event.target.value)} />
            {addError ? <FieldError>{addError}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="keyword-weight">Weight</FieldLabel>
            <WeightSelect id="keyword-weight" label="Weight" value={weight} disabled={atLimit} onChange={setWeight} />
          </Field>
          <Button type="button" disabled={busy || atLimit} onClick={() => void addKeyword()}>
            Add Keyword
          </Button>
        </div>
      </section>
    </div>
  );
}
