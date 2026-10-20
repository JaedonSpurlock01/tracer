"use client";

/**
 * -------------------------------------------------------------------------
 * @file   call-analysis.tsx
 * @brief  Renders a Call's Transcript, Lead Review, and Lead Assessment.
 *
 * @description
 *  Shows the Transcript as timestamped Caller and Business turns that seek
 *  the Recording player, highlights the active turn, follows playback until
 *  the user scrolls away with a Resume Follow action, and searches turn
 *  text with highlighted matches. Shows the current Lead Review as the
 *  reporting result with an Operator form to add or update it, and the
 *  automated Lead Assessment whose evidence seeks and emphasizes its turn.
 *  Transcript and Lead Assessment processing states render on their own,
 *  with an Operator-only Retry for a failed stage. After media expiry or a
 *  purge the Transcript explains which, and the assessment keeps its
 *  summary, classification, and score without a Rationale or evidence.
 *
 * @remarks
 *  The Lead Assessment stays labeled as an automated estimate and never
 *  reads as final. Failure reasons arrive only in Operator payloads, and
 *  Client Viewers see neutral unavailable messages. A successful write
 *  refreshes the client cache; until the refreshed Call arrives, the saved
 *  Lead Review or the retried stage shows locally. Follow and evidence
 *  scrolling move only the Transcript list, never the page, and respect
 *  reduced motion.
 *
 * @see
 *  components/tracer/playback.tsx
 *  data/call-details.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { Badge } from "@/components/reui/badge";
import { Frame, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatCallTime, formatClock } from "@/components/tracer/call-format";
import { EmptyState } from "@/components/tracer/empty-state";
import LeadClassificationBadge from "@/components/tracer/lead-classification-badge";
import { NoTranscriptArt } from "@/components/tracer/line-art";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import { usePlayback } from "@/components/tracer/playback";
import type { CallDetail, LeadAssessmentEvidence } from "@/data/call-details";
import { leadClassifications, leadReviewNoteMaxLength, type LeadClassification } from "@/data/lead-classification";
import type { LeadReview } from "@/data/lead-reviews";

type Turn = NonNullable<CallDetail["transcript"]["turns"]>[number];

function activeTurnIndex(turns: Turn[], currentMs: number): number {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].startMs <= currentMs) return currentMs < Math.max(turns[index].endMs, turns[index + 1]?.startMs ?? 0) ? index : -1;
  }
  return -1;
}

type Emphasis = { turnIndex: number; at: number } | null;

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function scrollTurnIntoView(container: HTMLElement | null, turn: Element | null | undefined) {
  if (!container || !(turn instanceof HTMLElement)) return;
  const top = turn.offsetTop - container.clientHeight / 2 + turn.clientHeight / 2;
  container.scrollTo?.({ top: Math.max(top, 0), behavior: reducedMotion() ? "auto" : "smooth" });
}

type SearchMatch = { turnIndex: number; start: number; end: number };

const followScrollKeys = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

function searchMatches(turns: Turn[], query: string): SearchMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return turns.flatMap((turn, turnIndex) => {
    const matches: SearchMatch[] = [];
    const text = turn.text.toLowerCase();
    for (let start = text.indexOf(needle); start !== -1; start = text.indexOf(needle, start + needle.length)) {
      matches.push({ turnIndex, start, end: start + needle.length });
    }
    return matches;
  });
}

function HighlightedText({ text, matches, current }: { text: string; matches: SearchMatch[]; current: SearchMatch | undefined }) {
  if (!matches.length) return text;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of matches) {
    parts.push(text.slice(cursor, match.start));
    parts.push(
      <mark key={match.start} data-current={match === current ? "true" : undefined} className="rounded-sm bg-primary/15 text-foreground data-[current=true]:bg-primary/35">
        {text.slice(match.start, match.end)}
      </mark>,
    );
    cursor = match.end;
  }
  parts.push(text.slice(cursor));
  return parts;
}

function searchStatus(count: number, current: number): string {
  if (!count) return "No matches";
  if (current >= 0) return `Match ${current + 1} of ${count}`;
  return count === 1 ? "1 match" : `${count} matches`;
}

function TranscriptTurns({ turns, emphasis }: { turns: Turn[]; emphasis: Emphasis }) {
  const playback = usePlayback();
  const listRef = useRef<HTMLOListElement>(null);
  const [following, setFollowing] = useState(true);
  const [query, setQuery] = useState("");
  const [currentMatch, setCurrentMatch] = useState(-1);
  const active = playback.available ? activeTurnIndex(turns, playback.currentTime * 1000) : -1;
  const matches = searchMatches(turns, query);
  const current = matches[currentMatch];

  function scrollToTurn(index: number) {
    scrollTurnIntoView(listRef.current, listRef.current?.children[index]);
  }

  useEffect(() => {
    if (following && playback.playing && active >= 0) scrollTurnIntoView(listRef.current, listRef.current?.children[active]);
  }, [active, following, playback.playing]);

  useEffect(() => {
    if (emphasis) scrollTurnIntoView(listRef.current, listRef.current?.children[emphasis.turnIndex]);
  }, [emphasis]);

  function resumeFollow() {
    setFollowing(true);
    if (!playback.playing && active >= 0) scrollToTurn(active);
  }

  function moveMatch(direction: 1 | -1) {
    if (!matches.length) return;
    const next = currentMatch < 0 ? (direction === 1 ? 0 : matches.length - 1) : (currentMatch + direction + matches.length) % matches.length;
    setCurrentMatch(next);
    setFollowing(false);
    scrollToTurn(matches[next].turnIndex);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Search Transcript"
          placeholder="Search Transcript"
          className="w-full sm:w-64"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCurrentMatch(-1);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            moveMatch(event.shiftKey ? -1 : 1);
          }}
        />
        {query.trim() ? <p role="status" className="text-xs tabular-nums text-muted-foreground">{searchStatus(matches.length, currentMatch)}</p> : null}
        {!following ? (
          <Button type="button" variant="outline" size="sm" className="sm:ml-auto" onClick={resumeFollow}>
            Resume Follow
          </Button>
        ) : null}
      </div>
      <ol
        ref={listRef}
        aria-label="Transcript turns"
        tabIndex={0}
        className="relative flex max-h-96 flex-col gap-1 overflow-y-auto rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onWheel={() => setFollowing(false)}
        onTouchMove={() => setFollowing(false)}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && followScrollKeys.has(event.key)) setFollowing(false);
        }}
      >
        {turns.map((turn, index) => (
          <li
            key={index}
            aria-current={index === active ? "true" : undefined}
            data-evidence={emphasis?.turnIndex === index ? "true" : undefined}
            className="flex cursor-pointer flex-col gap-1 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50 aria-[current=true]:bg-muted data-[evidence=true]:ring-2 data-[evidence=true]:ring-ring/50 data-[evidence=true]:ring-inset sm:flex-row sm:gap-3"
            onClick={() => playback.seek(turn.startMs / 1000)}
          >
            <div className="flex shrink-0 items-center gap-2 sm:w-36">
              <button
                type="button"
                aria-label={`Seek to ${formatClock(turn.startMs / 1000)}, ${turn.speaker}`}
                disabled={!playback.available}
                className="rounded-sm text-xs tabular-nums text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:hover:text-muted-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  playback.seek(turn.startMs / 1000);
                }}
              >
                {formatClock(turn.startMs / 1000)}
              </button>
              <span className="text-xs font-medium">{turn.speaker}</span>
            </div>
            <p className="min-w-0 text-sm">
              <HighlightedText text={turn.text} matches={matches.filter((match) => match.turnIndex === index)} current={current} />
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

const skipReasons: Record<NonNullable<CallDetail["transcript"]["skipReason"]>, string> = {
  analysis_disabled: "Analysis was turned off for this Workspace when the Recording was stored.",
  spam_gate_not_passed: "The Call did not pass the spam gate, so it was not analyzed.",
  too_short: "The Call had less than 15 seconds of conversation, so it was not analyzed.",
};

type RetryState = { pending: boolean; error: string; retry(): void };

function retryError(status: number): string {
  if (status === 409) return "There is nothing to retry. Refresh to see the latest state.";
  if (status === 403) return "Only Operators can retry analysis.";
  return "Analysis could not be restarted. Try again.";
}

function Notice({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">{title}</p>
        {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}
      </div>
      {children}
    </div>
  );
}

function FailedNotice({ title, failureReason, retry }: { title: string; failureReason?: string; retry: RetryState }) {
  return (
    <Notice title={title} detail={failureReason}>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={retry.pending} onClick={retry.retry}>
          {retry.pending ? "Retrying..." : "Retry"}
        </Button>
        {retry.error ? <p role="alert" className="text-sm">{retry.error}</p> : null}
      </div>
    </Notice>
  );
}

function TranscriptSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="text-sm font-medium">Transcript processing</p>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex gap-3">
          <Skeleton className="h-4 w-20 shrink-0" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  );
}

function TranscriptBody({ transcript, operator, retry, emphasis }: { transcript: CallDetail["transcript"]; operator: boolean; retry: RetryState; emphasis: Emphasis }) {
  switch (transcript.state) {
    case "Completed":
      return <TranscriptTurns turns={transcript.turns ?? []} emphasis={emphasis} />;
    case "Pending":
      return <TranscriptSkeleton />;
    case "Failed":
      return operator ? <FailedNotice title="Transcription failed" failureReason={transcript.failureReason} retry={retry} /> : <Notice title="Transcript unavailable" detail="The Transcript is not available for this Call." />;
    case "Skipped":
      return <EmptyState art={<NoTranscriptArt />} title="No Transcript" description={transcript.skipReason ? skipReasons[transcript.skipReason] : "This Call was not analyzed."} />;
    case "Purged":
      return <Notice title="Transcript purged" detail="An Operator purged the Transcript with the Recording media." />;
    case "Expired":
      return <Notice title="Transcript expired" detail="Transcript content is removed 12 months after the Call." />;
    case "Unavailable":
      return <EmptyState art={<NoTranscriptArt />} title="Transcript unavailable" description="No Transcript exists for this Call." />;
  }
}

function TranscriptSection({ transcript, operator, retry, emphasis }: { transcript: CallDetail["transcript"]; operator: boolean; retry: RetryState; emphasis: Emphasis }) {
  return (
    <section aria-labelledby="call-transcript-title">
      <Frame>
        <FrameHeader>
          <FrameTitle><h2 id="call-transcript-title">Transcript</h2></FrameTitle>
        </FrameHeader>
        <FramePanel>
          <TranscriptBody transcript={transcript} operator={operator} retry={retry} emphasis={emphasis} />
        </FramePanel>
      </Frame>
    </section>
  );
}

type ContentRemoval = "Purged" | "Expired" | null;

const removedEvidence: Record<NonNullable<ContentRemoval>, string> = {
  Purged: "Evidence and rationale were purged with the Transcript.",
  Expired: "Evidence and rationale expired with the Transcript.",
};

function AssessmentEvidence({ evidence, removal, onSelect }: { evidence: CallDetail["leadAssessment"]["evidence"]; removal: ContentRemoval; onSelect(item: LeadAssessmentEvidence): void }) {
  if (!evidence) return removal ? <p className="text-sm text-muted-foreground">{removedEvidence[removal]}</p> : null;
  if (!evidence.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-muted-foreground">Evidence</h3>
      <ul className="flex flex-col gap-1">
        {evidence.map((item, index) => (
          <li key={index}>
            <button
              type="button"
              className="flex w-full gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() => onSelect(item)}
            >
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatClock(item.startMs / 1000)}</span>
              <span className="min-w-0">&ldquo;{item.quote}&rdquo;</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CompletedAssessment({ assessment, timeZone, reviewed, contentRemoval, onEvidence }: { assessment: CallDetail["leadAssessment"]; timeZone: string; reviewed: boolean; contentRemoval: ContentRemoval; onEvidence(item: LeadAssessmentEvidence): void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {assessment.classification ? <LeadClassificationBadge classification={assessment.classification} /> : null}
        <span className="text-sm font-medium tabular-nums">{assessment.score} / 100</span>
        <Badge variant="outline">Automated estimate</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {reviewed ? "The Lead Review above is the reporting result." : "This assessment has not been reviewed and may be wrong."}
      </p>
      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-medium text-muted-foreground">Summary</h3>
        <p className="text-sm">{assessment.summary}</p>
      </div>
      {assessment.rationale ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-medium text-muted-foreground">Rationale</h3>
          <p className="text-sm">{assessment.rationale}</p>
        </div>
      ) : null}
      <AssessmentEvidence evidence={assessment.evidence} removal={contentRemoval} onSelect={onEvidence} />
      {assessment.processedAt ? <p className="text-xs tabular-nums text-muted-foreground">Processed {formatCallTime(assessment.processedAt, timeZone)}</p> : null}
    </div>
  );
}

function AssessmentBody(props: { assessment: CallDetail["leadAssessment"]; operator: boolean; retry: RetryState; timeZone: string; reviewed: boolean; contentRemoval: ContentRemoval; onEvidence(item: LeadAssessmentEvidence): void }) {
  const { assessment, operator, retry } = props;
  switch (assessment.state) {
    case "Completed":
      return <CompletedAssessment {...props} />;
    case "Pending":
      return <p role="status" className="text-sm font-medium">Analysis pending</p>;
    case "Failed":
      return operator ? <FailedNotice title="Lead Assessment failed" failureReason={assessment.failureReason} retry={retry} /> : <Notice title="Lead Assessment unavailable" detail="The Lead Assessment is not available for this Call." />;
    case "Unavailable":
      return <Notice title="Lead Assessment unavailable" detail="No Lead Assessment exists for this Call." />;
  }
}

function LeadAssessmentSection(props: Parameters<typeof AssessmentBody>[0]) {
  return (
    <section aria-labelledby="call-lead-assessment-title">
      <Frame>
        <FrameHeader>
          <FrameTitle><h2 id="call-lead-assessment-title">Lead Assessment</h2></FrameTitle>
        </FrameHeader>
        <FramePanel>
          <AssessmentBody {...props} />
        </FramePanel>
      </Frame>
    </section>
  );
}

function reviewError(status: number): string {
  if (status === 400) return "Check the classification and note, then try again.";
  if (status === 403) return "Only Operators can review Leads.";
  if (status === 404) return "This Call is no longer available.";
  return "The Lead Review could not be saved. Try again.";
}

function LeadReviewForm({ call, review, onSaved, onCancel }: { call: CallDetail; review: LeadReview | null; onSaved(review: LeadReview): void; onCancel(): void }) {
  const [classification, setClassification] = useState<LeadClassification | null>(review?.classification ?? null);
  const [note, setNote] = useState(review?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const classificationId = useId();
  const noteId = useId();
  const counterId = useId();
  const noteTooLong = note.trim().length > leadReviewNoteMaxLength;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classification) return setError("Choose a classification.");
    if (noteTooLong) return setError(`Keep the note to ${leadReviewNoteMaxLength} characters or fewer.`);
    setSaving(true);
    setError("");
    try {
      const response = await mutationFetch(`/api/workspaces/${call.workspace.id}/calls/${call.id}/lead-review`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ classification, note: note.trim() || undefined }),
      });
      if (!response.ok) {
        setError(reviewError(response.status));
        return;
      }
      onSaved(((await response.json()) as { leadReview: LeadReview }).leadReview);
    } catch {
      setError(reviewError(0));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void save(event)}>
      <Field data-invalid={error !== "" && !classification}>
        <FieldLabel htmlFor={classificationId}>Classification</FieldLabel>
        <Select value={classification} onValueChange={(value) => setClassification(value as LeadClassification | null)}>
          <SelectTrigger id={classificationId} aria-label="Classification" className="w-full sm:w-56">
            <SelectValue placeholder="Choose a classification" />
          </SelectTrigger>
          <SelectContent>
            {leadClassifications.map((value) => (
              <SelectItem key={value} value={value}>{value}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field data-invalid={noteTooLong}>
        <FieldLabel htmlFor={noteId}>Note (optional)</FieldLabel>
        <Textarea id={noteId} aria-describedby={counterId} aria-invalid={noteTooLong} value={note} onChange={(event) => setNote(event.target.value)} />
        <FieldDescription id={counterId} className="tabular-nums">{note.length} / {leadReviewNoteMaxLength}</FieldDescription>
      </Field>
      {error ? <FieldError>{error}</FieldError> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={saving}>{saving ? "Saving..." : "Save Lead Review"}</Button>
        <Button type="button" variant="outline" size="sm" disabled={saving} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function ReviewDetails({ review, timeZone }: { review: LeadReview; timeZone: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <LeadClassificationBadge classification={review.classification} />
        <Badge variant="outline">Reporting result</Badge>
      </div>
      {review.note ? <p className="text-sm break-words whitespace-pre-line">{review.note}</p> : null}
      <p className="text-xs tabular-nums text-muted-foreground">
        Reviewed by {review.reviewerName ?? "a former Operator"} on {formatCallTime(review.reviewedAt, timeZone)}
      </p>
    </div>
  );
}

function LeadReviewSection({ call, operator }: { call: CallDetail; operator: boolean }) {
  const [saved, setSaved] = useState<LeadReview | null>(null);
  const [editing, setEditing] = useState(false);
  const review = saved && (!call.leadReview || saved.reviewedAt > call.leadReview.reviewedAt) ? saved : call.leadReview;
  if (!review && !operator) return null;
  return (
    <section aria-labelledby="call-lead-review-title">
      <Frame>
        <FrameHeader>
          <FrameTitle><h2 id="call-lead-review-title">Lead Review</h2></FrameTitle>
        </FrameHeader>
        <FramePanel>
          {editing ? (
            <LeadReviewForm
              call={call}
              review={review}
              onCancel={() => setEditing(false)}
              onSaved={(next) => {
                setSaved(next);
                setEditing(false);
              }}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {review ? <ReviewDetails review={review} timeZone={call.workspace.reportingTimezone} /> : <Notice title="Not reviewed" detail="An Operator's Lead Review becomes the reporting result for this Call." />}
              {operator ? (
                <div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
                    {review ? "Update Lead Review" : "Add Lead Review"}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </FramePanel>
      </Frame>
    </section>
  );
}

function useAnalysisRetry(call: CallDetail) {
  const [retried, setRetried] = useState<{ call: CallDetail; stage: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function retry() {
    setPending(true);
    setError("");
    try {
      const response = await mutationFetch(`/api/workspaces/${call.workspace.id}/calls/${call.id}/analysis/retry`, { method: "POST" });
      if (!response.ok) {
        setError(retryError(response.status));
        return;
      }
      const body = (await response.json()) as { retry?: { stage?: string } };
      setRetried({ call, stage: body.retry?.stage ?? "transcription" });
    } catch {
      setError(retryError(0));
    } finally {
      setPending(false);
    }
  }

  const stage = retried?.call === call ? retried.stage : null;
  return { stage, state: { pending, error, retry: () => void retry() } };
}

export default function CallAnalysis({ call, operator }: { call: CallDetail; operator: boolean }) {
  const { stage, state: retry } = useAnalysisRetry(call);
  const transcript: CallDetail["transcript"] = stage === "transcription" ? { state: "Pending" } : call.transcript;
  const analysisPending = stage !== null || (call.leadAssessment.state === "Unavailable" && transcript.state === "Pending");
  const assessment: CallDetail["leadAssessment"] = analysisPending ? { state: "Pending" } : call.leadAssessment;
  const playback = usePlayback();
  const [emphasis, setEmphasis] = useState<Emphasis>(null);

  function selectEvidence(item: LeadAssessmentEvidence) {
    playback.seek(item.startMs / 1000);
    setEmphasis({ turnIndex: item.turnIndex, at: Date.now() });
  }

  return (
    <>
      <TranscriptSection transcript={transcript} operator={operator} retry={retry} emphasis={emphasis} />
      <LeadReviewSection call={call} operator={operator} />
      <LeadAssessmentSection
        assessment={assessment}
        operator={operator}
        retry={retry}
        timeZone={call.workspace.reportingTimezone}
        reviewed={call.leadReview !== null}
        contentRemoval={call.transcript.state === "Purged" || call.transcript.state === "Expired" ? call.transcript.state : null}
        onEvidence={selectEvidence}
      />
    </>
  );
}
