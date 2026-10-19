/**
 * -------------------------------------------------------------------------
 * @file   generate-report-dialog.tsx
 * @brief  Renders the Generate Report dialog and its trigger button.
 *
 * @description
 *  A focused Dialog requests an asynchronous report. Global scope offers a
 *  multi-select of the user's accessible Workspaces, all selected at
 *  first; Workspace scope fixes the one Workspace and its reporting
 *  timezone. The period is Previous Week, Previous Month, All Time, or a
 *  Custom Range of calendar dates. More than one selected Workspace asks
 *  for one document timezone, defaulting to the account timezone. The PDF
 *  is on by default and CSV detail is optional. A live matched Call count
 *  comes from the preview route once selections settle; No matching Calls
 *  blocks generation and explains how to widen the request. A successful
 *  request adds the job to the shared jobs list, so it appears in the
 *  notification popover and Report history, and the dialog confirms that
 *  closing it does not cancel the job.
 *
 * @remarks
 *  The server validates every value again and answers stable error codes,
 *  which map to concise messages. The form resets each time the dialog
 *  opens. Generation stays disabled until the preview for the current
 *  selections has counted at least one Call, so a stale count never
 *  enables it.
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

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import { reportErrorMessage, responseErrorCode, useReportJobs, type ReportJobItem } from "@/components/tracer/report-jobs";
import type { ReportPeriod } from "@/data/report-period";

export type GenerateReportScope =
  | { kind: "workspace"; workspace: { id: string; name: string; reportingTimezone: string } }
  | { kind: "global"; workspaces: Array<{ id: string; name: string }>; accountTimeZone: string };

type PeriodKind = ReportPeriod["kind"];

const periodOptions: Array<{ kind: PeriodKind; label: string }> = [
  { kind: "previousWeek", label: "Previous Week" },
  { kind: "previousMonth", label: "Previous Month" },
  { kind: "all", label: "All Time" },
  { kind: "custom", label: "Custom Range" },
];

const previewDelayMs = 350;

type Preview = { key: string; matchedCalls: number } | { key: string; error: string };

function timeZones(current: string): string[] {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
  return all.includes(current) ? all : [current, ...all];
}

function matchedCallsLabel(count: number): string {
  return `${count} matched ${count === 1 ? "Call" : "Calls"}`;
}

function GenerateReportForm({ scope, onDone }: { scope: GenerateReportScope; onDone: () => void }) {
  const { addJob } = useReportJobs();
  const [workspaceIds, setWorkspaceIds] = useState<string[]>(() => (scope.kind === "global" ? scope.workspaces.map(({ id }) => id) : []));
  const [periodKind, setPeriodKind] = useState<PeriodKind>("previousWeek");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [timeZone, setTimeZone] = useState(scope.kind === "global" ? scope.accountTimeZone : scope.workspace.reportingTimezone);
  const [pdf, setPdf] = useState(true);
  const [csv, setCsv] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);

  const multiWorkspace = scope.kind === "global" && workspaceIds.length > 1;
  const { body, blocker } = useMemo(() => {
    const files = [...(pdf ? ["pdf" as const] : []), ...(csv ? ["csv" as const] : [])];
    if (scope.kind === "global" && workspaceIds.length === 0) return { body: null, blocker: "Select at least one Workspace." };
    if (periodKind === "custom" && (!from || !to)) return { body: null, blocker: "Choose a start and end date." };
    if (files.length === 0) return { body: null, blocker: "Select at least one file." };
    const period: ReportPeriod = periodKind === "custom" ? { kind: "custom", from, to } : { kind: periodKind };
    const requestScope = scope.kind === "global"
      ? { kind: "global" as const, workspaceIds, timeZone: workspaceIds.length > 1 ? timeZone : null }
      : { kind: "workspace" as const, workspaceId: scope.workspace.id };
    return { body: { kind: "report" as const, scope: requestScope, period, files }, blocker: null };
  }, [csv, from, pdf, periodKind, scope, timeZone, to, workspaceIds]);
  const key = body ? JSON.stringify(body) : null;

  useEffect(() => {
    if (key === null) return;
    let current = true;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/reports/preview", { method: "POST", headers: { "content-type": "application/json" }, body: key });
        const result = response.ok ? ((await response.json()) as { preview: { matchedCalls: number } }) : null;
        const next: Preview = result ? { key, matchedCalls: result.preview.matchedCalls } : { key, error: reportErrorMessage(await responseErrorCode(response)) };
        if (current) setPreview(next);
      } catch {
        if (current) setPreview({ key, error: "Matched Calls are unavailable. Try again." });
      }
    }, previewDelayMs);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [key]);

  const currentPreview = preview && preview.key === key ? preview : null;
  const matchedCalls = currentPreview && "matchedCalls" in currentPreview ? currentPreview.matchedCalls : null;
  const status = blocker
    ?? (currentPreview === null ? "Counting matched Calls..." : "error" in currentPreview ? currentPreview.error : matchedCalls === 0 ? reportErrorMessage("no_matching_calls") : matchedCallsLabel(matchedCalls ?? 0));
  const canGenerate = body !== null && matchedCalls !== null && matchedCalls > 0 && !submitting;

  async function generate() {
    if (!body) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await mutationFetch("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
        <p>Report requested. Track it in notifications and Report history; closing this dialog does not cancel it.</p>
        <DialogFooter>
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        {scope.kind === "global" ? (
          <FieldSet>
            <FieldLegend variant="label">Workspaces</FieldLegend>
            <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
              {scope.workspaces.map((workspace) => (
                <Field key={workspace.id} orientation="horizontal">
                  <Checkbox
                    id={`report-workspace-${workspace.id}`}
                    checked={workspaceIds.includes(workspace.id)}
                    onCheckedChange={(checked) => setWorkspaceIds((current) => (checked ? [...current, workspace.id] : current.filter((id) => id !== workspace.id)))}
                  />
                  <FieldLabel htmlFor={`report-workspace-${workspace.id}`}>{workspace.name}</FieldLabel>
                </Field>
              ))}
            </div>
          </FieldSet>
        ) : (
          <Field>
            <FieldTitle>Workspace</FieldTitle>
            <p className="text-muted-foreground">
              {scope.workspace.name}, in {scope.workspace.reportingTimezone}
            </p>
          </Field>
        )}
        <Field>
          <FieldTitle>Period</FieldTitle>
          <ButtonGroup aria-label="Report period" className="flex-wrap">
            {periodOptions.map((option) => (
              <Button
                key={option.kind}
                type="button"
                size="sm"
                variant={periodKind === option.kind ? "secondary" : "outline"}
                aria-pressed={periodKind === option.kind}
                onClick={() => setPeriodKind(option.kind)}
              >
                {option.label}
              </Button>
            ))}
          </ButtonGroup>
        </Field>
        {periodKind === "custom" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field>
              <FieldLabel htmlFor="report-from">From</FieldLabel>
              <Input id="report-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="report-to">To</FieldLabel>
              <Input id="report-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </Field>
          </div>
        ) : null}
        {multiWorkspace ? (
          <Field>
            <FieldLabel htmlFor="report-timezone">Document timezone</FieldLabel>
            <Select value={timeZone} onValueChange={(value) => setTimeZone(value ?? timeZone)}>
              <SelectTrigger id="report-timezone" aria-label="Document timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timeZones(timeZone).map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>One timezone applies to every selected Workspace.</FieldDescription>
          </Field>
        ) : null}
        <FieldSet>
          <FieldLegend variant="label">Files</FieldLegend>
          <Field orientation="horizontal">
            <Checkbox id="report-file-pdf" checked={pdf} onCheckedChange={setPdf} />
            <FieldLabel htmlFor="report-file-pdf">PDF report</FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <Checkbox id="report-file-csv" checked={csv} onCheckedChange={setCsv} />
            <FieldLabel htmlFor="report-file-csv">CSV detail</FieldLabel>
          </Field>
        </FieldSet>
        <p role="status" className="font-medium tabular-nums">
          {status}
        </p>
        {submitError ? (
          <p role="alert" className="text-destructive">
            {submitError}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="button" disabled={!canGenerate} onClick={() => void generate()}>
          Generate Report
        </Button>
      </DialogFooter>
    </>
  );
}

export function GenerateReportDialog({ scope, open, onOpenChange }: { scope: GenerateReportScope; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate Report</DialogTitle>
          <DialogDescription>Reports generate in the background and stay downloadable for 7 days.</DialogDescription>
        </DialogHeader>
        {open ? <GenerateReportForm scope={scope} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

export default function GenerateReportButton({ scope }: { scope: GenerateReportScope }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Generate Report
      </Button>
      <GenerateReportDialog scope={scope} open={open} onOpenChange={setOpen} />
    </>
  );
}
