/**
 * -------------------------------------------------------------------------
 * @file   site-search-settings.tsx
 * @brief  Edits a linked Site's Service Area and Keywords and suggests new Keywords.
 *
 * @description
 *  Renders the Service Area picker (a location search over DataForSEO's
 *  own location names, so a rank check is never sent somewhere Google
 *  does not know, with Save) and
 *  the Keywords editor (each live Keyword with a weight Select and
 *  Remove, an add row with a phrase and weight, the count against the
 *  25 Keyword limit, and inline validation) and the Suggested Keywords
 *  panel (Suggest Keywords asks Tracer for phrases from the Business
 *  niche and Service Area with their monthly volume, the Operator ticks
 *  the ones to track, and Add selected adds them at weight 3) inside the
 *  Workspace Settings Site section.
 *
 * @remarks
 *  Every change goes through the Workspace Site routes and then clears
 *  the Client Cache so the Site page's Search panel reads the new set.
 *  A duplicate phrase and the Keyword limit are reported inline from the
 *  route's conflict codes rather than guessed on the client. The last
 *  suggestion set arrives with the page so reopening it bills nothing;
 *  Suggest again asks both providers once more.
 *
 * @see
 *  data/site-keywords.ts
 *  data/keyword-discovery.ts
 *  components/tracer/workspace-settings-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import type { KeywordSuggestionSet } from "@/data/keyword-discovery";
import { siteKeywordLimit, type ServiceArea, type SiteKeywordRecord } from "@/data/site-keywords";

export interface SiteSearchSettingsData {
  serviceArea: ServiceArea;
  keywords: SiteKeywordRecord[];
  suggestions: KeywordSuggestionSet | null;
}

const suggestedKeywordWeight = 3;

const weights = ["1", "2", "3", "4", "5"];

/** A Service Area saved before the picker existed has no location name; its parts still read as one. */
function legacyAreaName(area: ServiceArea): string | null {
  const parts = [area.city, area.region, area.country].filter(Boolean);
  return area.city ? parts.join(",") : null;
}

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
  const [area, setArea] = useState<{ locationCode: number | null; locationName: string | null }>({ locationCode: initial.serviceArea.locationCode, locationName: initial.serviceArea.locationName ?? legacyAreaName(initial.serviceArea) });
  const [chosen, setChosen] = useState<{ code: number; name: string } | null>(null);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationOptions, setLocationOptions] = useState<{ code: number; name: string; kind: string }[]>([]);
  const [locationsError, setLocationsError] = useState("");
  const [areaError, setAreaError] = useState("");
  const [keywords, setKeywords] = useState(initial.keywords);
  const [phrase, setPhrase] = useState("");
  const [weight, setWeight] = useState("1");
  const [addError, setAddError] = useState("");
  const [keywordError, setKeywordError] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState(initial.suggestions);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [finding, setFinding] = useState(false);
  const [suggestError, setSuggestError] = useState("");
  const [nicheMissing, setNicheMissing] = useState(false);
  const base = `/api/workspaces/${workspaceId}/site`;
  const atLimit = keywords.length >= siteKeywordLimit;

  const visibleOptions = locationQuery.trim().length >= 2 ? locationOptions : [];

  useEffect(() => {
    const query = locationQuery.trim();
    if (query.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetch(`${base}/locations?q=${encodeURIComponent(query)}`)
        .then(async (response) => {
          if (!response.ok) throw new Error(response.status === 404 ? "Connect DataForSEO on Integrations to search locations." : "Locations could not be searched.");
          const body = (await response.json()) as { locations: { code: number; name: string; kind: string }[] };
          if (!cancelled) {
            setLocationOptions(body.locations);
            setLocationsError("");
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) setLocationsError(error instanceof Error ? error.message : "Locations could not be searched.");
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [base, locationQuery]);

  function chooseLocation(option: { code: number; name: string }) {
    setChosen(option);
    setLocationQuery("");
    setLocationOptions([]);
    setAreaError("");
  }

  async function saveServiceArea() {
    if (!chosen) {
      setAreaError("Pick a location first.");
      return;
    }
    setBusy(true);
    setAreaError("");
    const response = await mutationFetch(`${base}/service-area`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locationCode: chosen.code, locationName: chosen.name }),
    }).catch(() => null);
    if (!response?.ok) {
      setAreaError(response?.status === 400 ? "Pick a location from the list." : "The Service Area could not be saved.");
    } else {
      const body = (await response.json()) as { serviceArea: ServiceArea };
      setArea({ locationCode: body.serviceArea.locationCode, locationName: body.serviceArea.locationName });
      setChosen(null);
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

  async function suggest() {
    setFinding(true);
    setSuggestError("");
    setNicheMissing(false);
    const response = await fetch(`${base}/keywords/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh: suggestions !== null }),
    }).catch(() => null);
    const body = response ? ((await response.json().catch(() => ({}))) as { suggestions?: KeywordSuggestionSet; error?: string }) : {};
    if (response?.ok && body.suggestions) {
      setSuggestions(body.suggestions);
      setSelected(new Set());
    } else if (body.error === "business_niche_missing") {
      setNicheMissing(true);
    } else if (body.error === "not_connected") {
      setSuggestError("Connect DataForSEO on Integrations before suggesting Keywords.");
    } else if (response?.status === 503) {
      setSuggestError("OpenAI and DataForSEO must both be configured before Tracer can suggest Keywords.");
    } else {
      setSuggestError("Keywords could not be suggested right now.");
    }
    setFinding(false);
  }

  function toggleSelected(phrase: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(phrase);
      else next.delete(phrase);
      return next;
    });
  }

  async function addSelected() {
    setBusy(true);
    setSuggestError("");
    let added = 0;
    for (const phrase of selected) {
      const response = await mutationFetch(`${base}/keywords`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phrase, weight: suggestedKeywordWeight }),
      }).catch(() => null);
      const body = response ? ((await response.json().catch(() => ({}))) as { keyword?: SiteKeywordRecord; error?: string }) : {};
      if (response?.ok && body.keyword) {
        added += 1;
        setKeywords((current) => [...current, body.keyword!]);
      } else if (body.error === "keyword_limit") {
        setSuggestError(`At most ${siteKeywordLimit} Keywords per Site; the rest were not added.`);
        break;
      } else if (body.error !== "duplicate_phrase") {
        setSuggestError(`${phrase} could not be added.`);
        break;
      }
      setSuggestions((current) => (current ? { ...current, suggestions: current.suggestions.filter((suggestion) => suggestion.phrase !== phrase) } : current));
      setSelected((current) => {
        const next = new Set(current);
        next.delete(phrase);
        return next;
      });
    }
    if (added > 0) onMessage(added === 1 ? "Keyword added." : `${added} Keywords added.`);
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-8">
      <section role="region" aria-labelledby="service-area-title" className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 id="service-area-title" className="font-semibold">Service Area</h3>
          <p className="text-sm text-muted-foreground">Where the business serves. Keyword positions are checked from this Google location.</p>
        </div>
        <p className="text-sm">
          <span className="font-medium">Current: </span>
          {chosen ? <span>{chosen.name.split(",").join(", ")} <span className="text-muted-foreground">(unsaved)</span></span> : area.locationName ? area.locationName.split(",").join(", ") : <span className="text-muted-foreground">No Service Area yet</span>}
        </p>
        <Field data-invalid={Boolean(areaError)} className="max-w-md">
          <FieldLabel htmlFor="service-area-search">Search locations</FieldLabel>
          <Input
            id="service-area-search"
            role="combobox"
            aria-label="Search locations"
            aria-expanded={visibleOptions.length > 0}
            aria-controls="service-area-options"
            aria-autocomplete="list"
            placeholder="City, region, or county"
            value={locationQuery}
            onChange={(event) => setLocationQuery(event.target.value)}
          />
          {visibleOptions.length > 0 ? (
            <ul id="service-area-options" role="listbox" aria-label="Matching locations" className="divide-y divide-border rounded-md border text-sm">
              {visibleOptions.map((option) => (
                <li key={option.code} role="option" aria-selected={chosen?.code === option.code} className="cursor-pointer px-3 py-1.5 hover:bg-muted" onClick={() => chooseLocation(option)}>
                  {option.name.split(",").join(", ")} <span className="text-xs text-muted-foreground">{option.kind}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {locationsError ? <FieldError>{locationsError}</FieldError> : null}
          {areaError ? <FieldError>{areaError}</FieldError> : null}
        </Field>
        <div>
          <Button type="button" variant="outline" disabled={busy || !chosen} onClick={() => void saveServiceArea()}>
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
      <section role="region" aria-labelledby="keyword-suggestions-title" className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 id="keyword-suggestions-title" className="font-semibold">Suggested Keywords</h3>
          <p className="text-sm text-muted-foreground">Phrases people in the Service Area search for the Business niche, with their monthly Google searches. Tick the ones to track; each is added at weight {suggestedKeywordWeight}.</p>
        </div>
        {nicheMissing ? (
          <p role="alert" className="text-sm">
            Add the Business niche first so Tracer knows what to suggest. <Link href={`/workspaces/${workspaceId}/settings/business`} className="underline underline-offset-4">Business settings</Link>
          </p>
        ) : null}
        {suggestError ? <p role="alert" className="text-sm">{suggestError}</p> : null}
        {finding ? <p role="status" className="text-sm text-muted-foreground">Finding keywords</p> : null}
        {suggestions && suggestions.suggestions.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {suggestions.suggestions.map((suggestion) => (
              <li key={suggestion.phrase} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-3">
                  <Checkbox aria-label={suggestion.phrase} checked={selected.has(suggestion.phrase)} disabled={busy || atLimit} onCheckedChange={(checked) => toggleSelected(suggestion.phrase, checked === true)} />
                  <span className="truncate">{suggestion.phrase}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground tabular-nums">
                  {suggestion.intent ? <span className="capitalize">{suggestion.intent}</span> : null}
                  <span>{suggestion.monthlyVolume > 0 ? `${suggestion.monthlyVolume.toLocaleString("en-US")} / mo` : "No volume data"}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : suggestions && !finding ? (
          <p className="text-sm text-muted-foreground">Every suggestion is tracked. Suggest again for more.</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy || finding} onClick={() => void suggest()}>
            {suggestions ? "Suggest again" : "Suggest Keywords"}
          </Button>
          {suggestions && suggestions.suggestions.length > 0 ? (
            <Button type="button" disabled={busy || finding || atLimit || selected.size === 0} onClick={() => void addSelected()}>
              Add selected
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
