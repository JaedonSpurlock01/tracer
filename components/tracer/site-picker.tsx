/**
 * -------------------------------------------------------------------------
 * @file   site-picker.tsx
 * @brief  Lets an Operator choose one of the Organization's Sites.
 *
 * @description
 *  Lists the connected account's Sites five per page from the picker
 *  route with a hostname search, a preview thumbnail when one is served,
 *  the primary hostname, last deployment, 30-day visits, and whether the
 *  Site is Available or already linked to a Workspace. Linking posts to
 *  the Workspace's link or replace route, clears the client cache, and
 *  hands the linked Site back. The list is used inline by the Create
 *  Workspace wizard and inside a Dialog by Workspace Settings, the Site
 *  page, and Workspace Overview.
 *
 * @remarks
 *  A Site linked elsewhere cannot be chosen. A failed link shows an inline
 *  Retry and never blocks Skip, so wizard activation does not depend on
 *  the Site Link. Only a Site linked to a Workspace has a preview route,
 *  so unlinked Sites show a placeholder box. The list scrolls inside a
 *  bounded height so the footer stays inside the dialog on short viewports.
 *
 * @see
 *  data/sites.ts
 *  components/tracer/workspaces-view.tsx
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCallDate } from "@/components/tracer/call-format";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import type { SiteHealth } from "@/data/site-health";
import type { SiteDeploymentRecord, SitePickerEntry, SitePickerResult, SiteUptime } from "@/data/sites";

export type SitePickerMode = "link" | "replace";

/** The Site as the Workspace site routes return it for the current actor. */
export interface SiteResponse {
  id: string;
  primaryHostname: string;
  domain?: { registrar: string | null; renewalCents: number | null; renewsOn: string | null };
  hostnames: { hostname: string; zoneId?: string; certificateId: string | null; enabled: boolean }[];
  lastDeployedAt: string | null;
  latestPreview: { versionId?: string | null; capturedAt: string } | null;
  latestCheck: { checkedAt: string; ok: boolean; statusCode: number | null; responseMs: number | null } | null;
  uptime30d?: SiteUptime;
  health: SiteHealth;
  healthReason?: string | null;
  lastSyncedAt: string | null;
  linkedAt: string;
  scriptName?: string;
  liveVersionId?: string | null;
  lastDeployment?: SiteDeploymentRecord | null;
  deployments?: SiteDeploymentRecord[];
}

export const siteHealthBadges: Record<SiteHealth, readonly [string, "success-light" | "warning-light" | "destructive-light" | "outline"]> = {
  Healthy: ["Healthy", "success-light"],
  Warning: ["Warning", "warning-light"],
  Down: ["Down", "destructive-light"],
  Unknown: ["Unknown", "outline"],
};

export function previewImageSrc(workspaceId: string, capturedAt: string): string {
  return `/api/workspaces/${workspaceId}/site/preview?v=${Date.parse(capturedAt)}`;
}

interface SitePickerListProps {
  workspaceId: string;
  mode: SitePickerMode;
  timeZone: string;
  onLinked: (site: SiteResponse) => void;
  onSkip?: () => void;
}

const pageSize = 5;
const count = new Intl.NumberFormat("en-US");

function linkErrorMessage(status: number | null): string {
  if (status === 409) return "This Site is already linked to another Workspace.";
  if (status === 404) return "This Site is no longer available.";
  return "The Site could not be linked.";
}

export function SitePreviewThumbnail({ src, alt, className = "" }: { src: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const frame = `relative aspect-[16/10] w-full overflow-hidden rounded-md border bg-muted ${className}`;
  if (!src || failed) return <div aria-hidden="true" className={frame} />;
  return (
    <div className={frame}>
      <Image src={src} alt={alt} fill unoptimized sizes="14rem" className="object-cover object-top" onError={() => setFailed(true)} />
    </div>
  );
}

export function SitePickerList({ workspaceId, mode, timeZone, onLinked, onSkip }: SitePickerListProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<SitePickerResult | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), search });
    void fetch(`/api/workspaces/sites?${params}`)
      .then(async (response) => (response.ok ? ((await response.json()) as SitePickerResult) : null))
      .then((body) => {
        if (cancelled) return;
        if (body) {
          setResult(body);
          setLoadError(false);
        } else setLoadError(true);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [page, search, reloads]);

  async function link() {
    if (!selectedId) return;
    setBusy(true);
    setLinkError("");
    const response = await mutationFetch(`/api/workspaces/${workspaceId}/site/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ siteId: selectedId }),
    }).catch(() => null);
    if (!response?.ok) {
      setLinkError(linkErrorMessage(response?.status ?? null));
      setBusy(false);
      return;
    }
    const body = (await response.json()) as { site: SiteResponse };
    setBusy(false);
    onLinked(body.site);
  }

  const sites: SitePickerEntry[] = Array.isArray(result?.sites) ? result.sites : [];
  const pageCount = Math.max(1, Math.ceil((result?.total ?? 0) / (result?.pageSize || pageSize)));

  return (
    <div className="flex flex-col gap-3">
      <Input
        type="search"
        aria-label="Search Sites"
        placeholder="Search by hostname"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
      />
      {loadError ? (
        <div className="flex items-center gap-3 text-sm">
          <p role="alert">Sites are unavailable.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setReloads((value) => value + 1)}>
            Retry
          </Button>
        </div>
      ) : null}
      {!result && !loadError ? (
        <div className="grid gap-2" aria-busy="true">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-16 w-full" />
          ))}
        </div>
      ) : null}
      {result && sites.length === 0 ? <p className="text-sm text-muted-foreground">{search ? "No Sites match your search." : "No Sites on the connected account yet. Run Sync now on Integrations."}</p> : null}
      {sites.length > 0 ? (
        <ScrollArea className="[&>[data-slot=scroll-area-viewport]]:max-h-76">
          <div className="grid gap-2 pe-3">
            {sites.map((site) => {
              const linkedElsewhere = site.linkedWorkspace !== null && site.linkedWorkspace.id !== workspaceId;
              return (
                <label key={site.id} className="grid grid-cols-[auto_6rem_1fr] items-center gap-3 rounded-md border p-3 has-[:checked]:border-primary/40 has-[:checked]:bg-muted/40">
                  <input
                    type="radio"
                    name="site"
                    aria-label={site.primaryHostname}
                    checked={selectedId === site.id}
                    disabled={linkedElsewhere || busy}
                    onChange={() => setSelectedId(site.id)}
                  />
                  <SitePreviewThumbnail src={site.linkedWorkspace ? `/api/workspaces/${site.linkedWorkspace.id}/site/preview` : null} alt="" />
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-mono text-sm font-medium">{site.primaryHostname}</span>
                      {site.linkedWorkspace ? <Badge variant="outline">Linked to {site.linkedWorkspace.name}</Badge> : <Badge variant="success-light">Available</Badge>}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">{count.format(site.visits30d)} visits, 30 days</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{site.lastDeployedAt ? `Deployed ${formatCallDate(site.lastDeployedAt, timeZone)}` : "No deployment recorded"}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </ScrollArea>
      ) : null}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">Page {result?.page ?? page} of {pageCount}</span>
        <div className="flex gap-1">
          <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            Previous
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>
            Next
          </Button>
        </div>
      </div>
      {linkError ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <p role="alert">{linkError}</p>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void link()}>
            Retry
          </Button>
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        {onSkip ? (
          <Button type="button" variant="outline" onClick={onSkip} disabled={busy}>
            Skip
          </Button>
        ) : null}
        <Button type="button" onClick={() => void link()} disabled={!selectedId || busy}>
          {mode === "replace" ? "Replace Site" : "Link Site"}
        </Button>
      </div>
    </div>
  );
}

export function SitePickerDialog({
  open,
  onOpenChange,
  workspaceId,
  mode,
  timeZone,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  mode: SitePickerMode;
  timeZone: string;
  onLinked: (site: SiteResponse) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "replace" ? "Replace Site" : "Link Site"}</DialogTitle>
          <DialogDescription>
            {mode === "replace"
              ? "The current Site Link ends and a new one starts with the chosen Site. Cloudflare is not changed."
              : "Choose one of the connected Cloudflare account's Sites. A Site can be linked to one Workspace at a time."}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <SitePickerList
            workspaceId={workspaceId}
            mode={mode}
            timeZone={timeZone}
            onLinked={(site) => {
              onOpenChange(false);
              onLinked(site);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
