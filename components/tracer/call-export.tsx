/**
 * -------------------------------------------------------------------------
 * @file   call-export.tsx
 * @brief  Renders the Calls export actions, Export Call, and their confirmation.
 *
 * @description
 *  Export Recordings, the primary Calls action, and Export CSV, the
 *  secondary one, export the current Calls scope and the filters in the
 *  page URL; Export Call on Call Detail exports one Call as a Recording
 *  ZIP. Each opens a confirmation Dialog that previews the selection and
 *  shows matched Calls, retained Recordings, expired media, media an
 *  Operator purged, and Calls without recordings. A Recording export above the 500 retained
 *  Recording limit, or with none retained, is blocked with guidance to
 *  change the filters, and a selection matching no Calls is blocked too;
 *  a Calls CSV is not capped. Confirming creates the job, adds it to the
 *  shared jobs list so it appears in the notification popover, and says
 *  where to download it.
 *
 * @remarks
 *  The confirmation sends the Calls query string exactly as the Calls page
 *  writes it, so the server parses the same filters the grid shows; its
 *  page and sort parameters are ignored. The limit comes from the preview
 *  response rather than a client constant. The server enforces the same
 *  limits on creation, and its error codes map to concise messages. Each
 *  opening previews afresh, so counts never come from an earlier filter.
 *
 * @see
 *  data/reports-handler.ts
 *  components/tracer/report-jobs.tsx
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { DownloadIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import { reportErrorMessage, responseErrorCode, useReportJobs, type ReportJobItem } from "@/components/tracer/report-jobs";

export type CallExportRequest =
  | { kind: "call_export"; scope: { kind: "global" } | { kind: "workspace"; workspaceId: string }; file: "zip" | "csv"; query: string }
  | { kind: "call_export"; scope: { kind: "workspace"; workspaceId: string }; callId: string; file: "zip" };

interface ExportPreview {
  matchedCalls: number;
  retainedRecordings: number;
  expiredMedia: number;
  purgedMedia: number;
  callsWithoutRecording: number;
}

type PreviewState = { state: "loading" } | { state: "ready"; preview: ExportPreview; limit: number } | { state: "error"; message: string };

function blocker(request: CallExportRequest, preview: ExportPreview, limit: number): string | null {
  if (preview.matchedCalls === 0) return "No Calls match these filters. Change the filters and try again.";
  if (request.file !== "zip") return null;
  if (preview.retainedRecordings === 0) return reportErrorMessage("no_recordings");
  if (preview.retainedRecordings > limit) return `A Recording export holds at most ${limit} retained Recordings. Narrow the filters and try again.`;
  return null;
}

function ExportConfirmation({ title, request, onDone }: { title: string; request: CallExportRequest; onDone: () => void }) {
  const { addJob } = useReportJobs();
  const [preview, setPreview] = useState<PreviewState>({ state: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);
  const body = JSON.stringify(request);

  const loadPreview = useCallback(async () => {
    try {
      const response = await fetch("/api/reports/preview", { method: "POST", headers: { "content-type": "application/json" }, body });
      if (response.ok) {
        const result = (await response.json()) as { preview: ExportPreview; recordingExportLimit: number };
        setPreview({ state: "ready", preview: result.preview, limit: result.recordingExportLimit });
        return;
      }
      const code = await responseErrorCode(response);
      setPreview({ state: "error", message: code && response.status < 500 ? reportErrorMessage(code) : "Export counts are unavailable." });
    } catch {
      setPreview({ state: "error", message: "Export counts are unavailable." });
    }
  }, [body]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPreview(), 0);
    return () => window.clearTimeout(timer);
  }, [loadPreview]);

  async function confirm() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await mutationFetch("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body });
      if (!response.ok) {
        setSubmitError(reportErrorMessage(await responseErrorCode(response)));
        return;
      }
      addJob(((await response.json()) as { job: ReportJobItem }).job);
      setRequested(true);
    } catch {
      setSubmitError(reportErrorMessage(null));
    } finally {
      setSubmitting(false);
    }
  }

  if (requested) {
    return (
      <>
        <p>Export requested. Download it from notifications when it completes; closing this dialog does not cancel it.</p>
        <DialogFooter>
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        </DialogFooter>
      </>
    );
  }

  const ready = preview.state === "ready" ? preview : null;
  const blocked = ready ? blocker(request, ready.preview, ready.limit) : null;
  const stats: Array<[string, keyof ExportPreview]> = [
    ["Matched Calls", "matchedCalls"],
    ["Retained Recordings", "retainedRecordings"],
    ["Expired media", "expiredMedia"],
    ["Purged media", "purgedMedia"],
    ["Calls without recordings", "callsWithoutRecording"],
  ];

  return (
    <>
      {preview.state === "error" ? (
        <div className="flex flex-col items-start gap-2">
          <p>{preview.message}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setPreview({ state: "loading" });
              void loadPreview();
            }}
          >
            Retry
          </Button>
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-3">
          {stats.map(([label, key]) => (
            <div key={key} className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-lg font-semibold tracking-tight tabular-nums">{ready ? ready.preview[key] : <Skeleton className="h-6 w-12" />}</dd>
            </div>
          ))}
        </dl>
      )}
      {blocked ? <p className="font-medium">{blocked}</p> : null}
      {submitError ? (
        <p role="alert" className="text-destructive">
          {submitError}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="button" disabled={!ready || blocked !== null || submitting} onClick={() => void confirm()}>
          {title}
        </Button>
      </DialogFooter>
    </>
  );
}

function ExportDialog({ title, description, request, open, onOpenChange }: { title: string; description: string; request: CallExportRequest; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {open ? <ExportConfirmation title={title} request={request} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

export function CallsExportActions({ workspaceId, query }: { workspaceId?: string; query: string }) {
  const [open, setOpen] = useState<"zip" | "csv" | null>(null);
  const scope = workspaceId ? { kind: "workspace" as const, workspaceId } : { kind: "global" as const };
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" onClick={() => setOpen("zip")}>
        Export Recordings
      </Button>
      <Button type="button" variant="outline" onClick={() => setOpen("csv")}>
        Export CSV
      </Button>
      <ExportDialog
        title="Export Recordings"
        description="A ZIP of retained Recording MP3s with a CSV manifest, for the Calls matching the current filters."
        request={{ kind: "call_export", scope, file: "zip", query }}
        open={open === "zip"}
        onOpenChange={(next) => setOpen(next ? "zip" : null)}
      />
      <ExportDialog
        title="Export CSV"
        description="Full Call detail as CSV, for the Calls matching the current filters."
        request={{ kind: "call_export", scope, file: "csv", query }}
        open={open === "csv"}
        onOpenChange={(next) => setOpen(next ? "csv" : null)}
      />
    </div>
  );
}

export function ExportCallButton({ workspaceId, callId }: { workspaceId: string; callId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <DownloadIcon data-icon="inline-start" aria-hidden />
        Export Call
      </Button>
      <ExportDialog
        title="Export Call"
        description="A ZIP with this Call's Recording MP3, its CSV manifest row, and the Transcript and Lead Assessment when present."
        request={{ kind: "call_export", scope: { kind: "workspace", workspaceId }, callId, file: "zip" }}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
