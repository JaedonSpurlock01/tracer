/**
 * -------------------------------------------------------------------------
 * @file   forms-view.tsx
 * @brief  Renders the Workspace Forms page: a ledger of Form Submissions.
 *
 * @description
 *  Lists a Workspace's Form Submissions newest first in one-line rows of
 *  Received, Name, Contact, Fields, Forwarding, and Lead. Received shows
 *  the short time with the full timestamp as its hover title. Any row
 *  expands to show the page, the recipients, the forwarding time, and
 *  every field in full. Operators approve or
 *  reject a Held submission, add or clear a Lead Review, and Resend one
 *  whose forwarding failed or had no recipients. Client Viewers read the
 *  same ledger without actions.
 *
 * @remarks
 *  Every mutation replaces the row with the submission the route returns,
 *  so the ledger and the held count never guess at the outcome. Times are
 *  shown in UTC because the list carries no Workspace timezone and the
 *  received time is an identifier more than a schedule. Long cell values
 *  truncate rather than wrap, and an absent value is named rather than
 *  printed as a dash.
 *
 * @see
 *  data/form-submissions.ts
 *  data/workspaces-handler.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { ChevronDownIcon } from "lucide-react";
import { useId, useState } from "react";

import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCallTime, formatShortTime } from "@/components/tracer/call-format";
import { EmptyState } from "@/components/tracer/empty-state";
import LeadClassificationBadge from "@/components/tracer/lead-classification-badge";
import { NoWorkspacesArt } from "@/components/tracer/line-art";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import { PageHeader, Panel } from "@/components/tracer/page-parts";
import type { FormForwardStatus, FormSubmissionList, FormSubmissionRecord } from "@/data/form-submissions";
import { leadClassifications, leadReviewNoteMaxLength, type LeadClassification } from "@/data/lead-classification";

const headerCell = "h-10 px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground first:ps-4 last:pe-4";
const bodyCell = "px-3 py-2.5 align-middle text-sm whitespace-nowrap first:ps-4 last:pe-4";

const forwardBadges: Record<FormForwardStatus, [label: string, variant: "success-light" | "destructive-light" | "warning-light" | "outline"]> = {
  Sent: ["Forwarded", "success-light"],
  Failed: ["Forward failed", "destructive-light"],
  "Not configured": ["Not forwarded", "outline"],
  Held: ["Held", "warning-light"],
  Rejected: ["Rejected", "outline"],
};

const identityFields = new Set(["name", "phone", "email"]);

function formatReceived(iso: string): string {
  return `${formatCallTime(iso, "UTC")} UTC`;
}

function Absent({ children = "None" }: { children?: string }) {
  return <span className="text-muted-foreground">{children}</span>;
}

function otherFields(submission: FormSubmissionRecord): [string, string][] {
  return Object.entries(submission.fields).filter(([key]) => !identityFields.has(key.trim().toLowerCase()));
}

function actionError(action: string, status: number | undefined): string {
  if (status === 409) return `The Form Submission could not be ${action} because its hold state changed. Reload to see it.`;
  return `The Form Submission could not be ${action}.`;
}

function ReviewPopover({ submission, busy, onReview }: { submission: FormSubmissionRecord; busy: boolean; onReview: (classification: LeadClassification, note: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [classification, setClassification] = useState<LeadClassification | null>(submission.review?.classification ?? null);
  const [note, setNote] = useState(submission.review?.note ?? "");
  const classificationId = useId();
  const noteId = useId();
  const noteTooLong = note.trim().length > leadReviewNoteMaxLength;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" variant="outline" size="sm" disabled={busy} />}>Review</PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-3">
        <Field>
          <FieldLabel htmlFor={classificationId}>Lead Review</FieldLabel>
          <Select value={classification} onValueChange={(value) => setClassification(value as LeadClassification | null)}>
            <SelectTrigger id={classificationId} aria-label="Classification" className="w-full">
              <SelectValue placeholder="Choose a classification" />
            </SelectTrigger>
            <SelectContent>
              {leadClassifications.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field data-invalid={noteTooLong}>
          <FieldLabel htmlFor={noteId}>Note (optional)</FieldLabel>
          <Textarea id={noteId} aria-invalid={noteTooLong} value={note} rows={3} onChange={(event) => setNote(event.target.value)} />
          <FieldDescription className="tabular-nums">{note.length} / {leadReviewNoteMaxLength}</FieldDescription>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || !classification || noteTooLong}
            onClick={async () => {
              if (classification && (await onReview(classification, note.trim()))) setOpen(false);
            }}
          >
            Save Lead Review
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SubmissionRow({
  submission,
  operator,
  busy,
  onAction,
  onReview,
}: {
  submission: FormSubmissionRecord;
  operator: boolean;
  busy: boolean;
  onAction: (path: "approve" | "reject" | "resend" | "review", init?: RequestInit) => Promise<boolean>;
  onReview: (classification: LeadClassification, note: string) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const [forwardLabel, forwardVariant] = forwardBadges[submission.forward.status];
  const summary = otherFields(submission);
  const canResend = submission.forward.status === "Failed" || submission.forward.status === "Not configured";
  return (
    <>
      <tr className="border-t border-border">
        <td className={`${bodyCell} tabular-nums`}>
          <span title={formatReceived(submission.receivedAt)}>{formatShortTime(submission.receivedAt, "UTC")}</span>
        </td>
        <td className={`${bodyCell} font-medium`}>
          <span className="block max-w-40 truncate">{submission.name}</span>
        </td>
        <td className={bodyCell}>
          {submission.phone || submission.email ? (
            <span className="flex max-w-64 items-center gap-2">
              {submission.phone ? <span className="font-mono tabular-nums">{submission.phone}</span> : null}
              {submission.email ? <span className="truncate text-muted-foreground">{submission.email}</span> : null}
            </span>
          ) : (
            <Absent />
          )}
        </td>
        <td className={`${bodyCell} text-muted-foreground`}>
          {summary.length > 0 ? (
            <span className="block max-w-64 truncate">
              {summary.map(([key, value], index) => (
                <span key={key}>
                  {index > 0 ? " · " : null}
                  <span>
                    {key}: {value}
                  </span>
                </span>
              ))}
            </span>
          ) : (
            "None"
          )}
        </td>
        <td className={bodyCell}>
          <span className="flex max-w-56 items-center gap-2">
            <Badge variant={forwardVariant}>{forwardLabel}</Badge>
            {submission.forward.status === "Failed" && submission.forward.error ? (
              <span className="truncate text-xs text-muted-foreground" title={submission.forward.error}>
                {submission.forward.error}
              </span>
            ) : null}
          </span>
        </td>
        <td className={bodyCell}>
          <span className="flex max-w-56 items-center gap-2">
            {submission.effectiveClassification ? (
              <LeadClassificationBadge classification={submission.effectiveClassification.classification} />
            ) : (
              <span className="text-xs text-muted-foreground">Awaiting approval</span>
            )}
            {submission.review?.note ? (
              <span className="truncate text-xs text-muted-foreground" title={submission.review.note}>
                {submission.review.note}
              </span>
            ) : null}
          </span>
        </td>
        <td className={`${bodyCell} text-right`}>
          <div className="flex justify-end gap-1">
            {operator && submission.held ? (
              <>
                <Button type="button" size="sm" disabled={busy} onClick={() => void onAction("approve")}>
                  Approve
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void onAction("reject")}>
                  Reject
                </Button>
              </>
            ) : null}
            {operator && !submission.held ? <ReviewPopover key={submission.review?.reviewedAt ?? "none"} submission={submission} busy={busy} onReview={onReview} /> : null}
            {operator && submission.review ? (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void onAction("review", { method: "DELETE" })}>
                Clear review
              </Button>
            ) : null}
            {operator && canResend ? (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void onAction("resend")}>
                Resend
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((open) => !open)}>
              Details
              <ChevronDownIcon data-icon="inline-end" aria-hidden className={expanded ? "rotate-180" : undefined} />
            </Button>
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={7} className={`${bodyCell} pt-0 whitespace-normal`}>
            <section id={detailsId} aria-label={`${submission.name} details`} className="rounded-md bg-muted/40 px-3 py-2">
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
                <dt className="text-xs text-muted-foreground">Page</dt>
                <dd className="font-mono text-xs">{submission.page ?? <Absent />}</dd>
                <dt className="text-xs text-muted-foreground">Forwarded to</dt>
                <dd>{submission.forward.to.length > 0 ? submission.forward.to.join(", ") : <Absent>No recipients</Absent>}</dd>
                {submission.forward.status === "Sent" && submission.forward.forwardedAt ? (
                  <>
                    <dt className="text-xs text-muted-foreground">Forwarded at</dt>
                    <dd className="tabular-nums">{formatReceived(submission.forward.forwardedAt)}</dd>
                  </>
                ) : null}
                {Object.entries(submission.fields).map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-xs text-muted-foreground">{key}</dt>
                    <dd className="break-words whitespace-pre-line">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default function FormsView({ list, readOnly = false }: { list: FormSubmissionList; readOnly?: boolean }) {
  const [submissions, setSubmissions] = useState(list.submissions);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const operator = !readOnly;
  const heldCount = submissions.filter((submission) => submission.held).length;

  async function act(submission: FormSubmissionRecord, path: string, init: RequestInit, failure: string): Promise<boolean> {
    setBusyId(submission.id);
    setError("");
    const response = await mutationFetch(`/api/workspaces/${list.workspace.id}/forms/${submission.id}/${path}`, init).catch(() => null);
    if (!response?.ok) {
      setError(actionError(failure, response?.status));
      setBusyId(null);
      return false;
    }
    const body = (await response.json()) as { submission: FormSubmissionRecord };
    setSubmissions((current) => current.map((item) => (item.id === submission.id ? body.submission : item)));
    setBusyId(null);
    return true;
  }

  const failures = { approve: "approved", reject: "rejected", resend: "resent", review: "changed" } as const;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Forms"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums">{submissions.length === 1 ? "1 Form Submission" : `${submissions.length} Form Submissions`}</span>
            {heldCount > 0 ? <Badge variant="warning-light">{heldCount} held for approval</Badge> : null}
          </span>
        }
      />
      <Panel>
        {error ? (
          <p role="alert" className="border-b border-border px-4 py-3 text-sm">
            {error}
          </p>
        ) : null}
        {submissions.length === 0 ? (
          <div className="px-4 py-6">
            <EmptyState
              art={<NoWorkspacesArt />}
              title="No Form Submissions yet"
              description={
                list.site
                  ? `Form Submissions appear here when the contact form on ${list.site.primaryHostname} posts with the Forms key.`
                  : "This Workspace has no linked Site. Link a Site in Workspace Settings to receive its Form Submissions."
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th scope="col" className={headerCell}>Received</th>
                  <th scope="col" className={headerCell}>Name</th>
                  <th scope="col" className={headerCell}>Contact</th>
                  <th scope="col" className={headerCell}>Fields</th>
                  <th scope="col" className={headerCell}>Forwarding</th>
                  <th scope="col" className={headerCell}>Lead</th>
                  <th scope="col" className={headerCell}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((submission) => (
                  <SubmissionRow
                    key={submission.id}
                    submission={submission}
                    operator={operator}
                    busy={busyId === submission.id}
                    onAction={(path, init) => act(submission, path, init ?? { method: "POST" }, failures[path])}
                    onReview={(classification, note) =>
                      act(submission, "review", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ classification, note: note || null }) }, "reviewed")
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
