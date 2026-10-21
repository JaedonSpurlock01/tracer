"use client";

/**
 * -------------------------------------------------------------------------
 * @file   call-detail-view.tsx
 * @brief  Renders Call Detail as a reader with a now-playing bar.
 *
 * @description
 *  The Transcript is the page. A one-line header names the Call by its
 *  caller number with the Call Outcome and effective Lead classification,
 *  the Workspace, Tracking Number, and start time, the previous and next
 *  Call steps labeled with the Call they go to, and an actions menu with
 *  Download MP3, Export Call, and the Operator-only Purge Media. A verdict
 *  strip shows the effective classification, the Lead Assessment score and
 *  summary, and who reviewed the Call, and expands into the full Lead
 *  Assessment and the Lead Review. Below it the Transcript stays pinned
 *  while a rail of Call facts and the processing timeline scrolls, and the
 *  Recording player sits in a sticky now-playing bar at the bottom.
 *
 * @remarks
 *  A PlaybackProvider wraps the whole reader so the analysis hook, the
 *  Transcript, and the player share one playback and evidence can seek.
 *  Download MP3 appears whenever the read model gives a downloadable MP3;
 *  the read model withholds it once media expires or is purged. After a
 *  purge the page shows the purged media state locally until the refreshed
 *  Call arrives, as Lead Review and Retry do. The page resolves the back
 *  link and the previous and next Call steps on the server; without them
 *  the back link is Workspace Calls and both steps are disabled. The
 *  now-playing bar reaches the layout's edges with negative margins that
 *  mirror the app layout's padding. Call Detail keeps the Workspace Sidebar
 *  with Calls current and carries no navigation of its own. Times use the
 *  Workspace reporting timezone.
 *
 * @see
 *  data/call-details.ts
 *  data/call-source.ts
 *  components/tracer/recording-player.tsx
 *  components/tracer/call-analysis.tsx
 *  components/tracer/purge-media.tsx
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cn } from "cn";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronLeftIcon, ChevronUpIcon, DownloadIcon, EllipsisIcon, Trash2Icon } from "lucide-react";

import { Badge } from "@/components/reui/badge";
import { BreadcrumbLabel } from "@/components/tracer/breadcrumbs";
import { Button, buttonVariants } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Frame, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Timeline, TimelineContent, TimelineDate, TimelineHeader, TimelineIndicator, TimelineItem, TimelineSeparator, TimelineTitle } from "@/components/reui/timeline";
import { AssessmentBody, LeadReviewBody, TranscriptBody, useCallAnalysis } from "@/components/tracer/call-analysis";
import { ExportCallDialog } from "@/components/tracer/call-export";
import CallOutcomeBadge from "@/components/tracer/call-outcome-badge";
import { formatCallDate, formatCallTime, formatClock, formatTimeOfDay } from "@/components/tracer/call-format";
import LeadClassificationBadge from "@/components/tracer/lead-classification-badge";
import { PlaybackProvider } from "@/components/tracer/playback";
import PurgeMediaDialog, { canPurgeMedia, purgedCallDetail } from "@/components/tracer/purge-media";
import RecordingPlayer from "@/components/tracer/recording-player";
import type { CallDetail, CallTimelineEntry } from "@/data/call-details";
import type { CallStep } from "@/data/call-source";

const timelineVariants = {
  Completed: "success-light",
  Pending: "info-light",
  Failed: "destructive-light",
} as const satisfies Record<CallTimelineEntry["status"], string>;

function recordingStatus(call: CallDetail): string {
  const recording = call.recording;
  const timeZone = call.workspace.reportingTimezone;
  switch (recording.state) {
    case "Ready":
      return `${recording.channels === 2 ? "Dual-channel" : "Mixed audio"}, retained until ${formatCallDate(recording.expiresAt, timeZone)}`;
    case "Processing":
      return "Processing";
    case "Failed":
      return "Failed";
    case "Unavailable":
      return recording.reason === "disabled" ? "Not recorded" : "Not captured";
    case "Purged":
      return `Purged on ${formatCallTime(recording.purgedAt, timeZone)}`;
    case "Expired":
      return `Expired on ${formatCallDate(recording.expiredAt, timeZone)}`;
  }
}

function duration(seconds: number | null): string {
  return seconds === null ? "-" : formatClock(seconds);
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="text-sm break-words tabular-nums">{children}</dd>
    </div>
  );
}

function CallFacts({ call }: { call: CallDetail }) {
  const timeZone = call.workspace.reportingTimezone;
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-x-6 gap-y-3">
        <Fact term="Call start">{formatCallTime(call.startedAt, timeZone)}</Fact>
        <Fact term="Call end">{call.endedAt ? formatCallTime(call.endedAt, timeZone) : "-"}</Fact>
        <Fact term="Total duration">{duration(call.totalDurationSeconds)}</Fact>
        <Fact term="Connected duration">{duration(call.connectedDurationSeconds)}</Fact>
        <Fact term="Tracking Number dialed">{call.trackingNumber}</Fact>
        <Fact term="Destination Number used">{call.destinationNumber ?? "Not forwarded"}</Fact>
        <Fact term="Workspace">{call.workspace.name}</Fact>
        <Fact term="Call Outcome">{call.outcome ?? "In Progress"}</Fact>
        <Fact term="Spam gate">{call.spamGate}</Fact>
        <Fact term="Recording">{recordingStatus(call)}</Fact>
        {call.twilioCallSid ? <Fact term="Twilio call SID">{call.twilioCallSid}</Fact> : null}
      </dl>
      <p className="text-xs text-muted-foreground">Times are shown in {timeZone}.</p>
    </div>
  );
}

function ProcessingTimeline({ call }: { call: CallDetail }) {
  const completed = call.timeline.findIndex((entry) => entry.status !== "Completed");
  if (call.timeline.length === 0) return <p className="text-sm text-muted-foreground">No processing events were recorded for this Call.</p>;
  return (
    <Timeline value={completed === -1 ? call.timeline.length : completed}>
      {call.timeline.map((entry, index) => (
        <TimelineItem key={entry.id} step={index + 1}>
          <TimelineHeader>
            <TimelineDate className="tabular-nums">{formatTimeOfDay(entry.at, call.workspace.reportingTimezone)}</TimelineDate>
            <TimelineTitle>{entry.label}</TimelineTitle>
          </TimelineHeader>
          <TimelineIndicator />
          <TimelineSeparator />
          <TimelineContent>
            <Badge variant={timelineVariants[entry.status]}>{entry.status}</Badge>
          </TimelineContent>
        </TimelineItem>
      ))}
    </Timeline>
  );
}

/** A rail region that opens and closes; its header is one line, level with the Transcript's. */
function RailSection({ id, title, defaultOpen, children }: { id: string; title: string; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section aria-labelledby={id}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <Frame>
          <div className="flex items-center justify-between px-(--frame-panel-header-px) py-(--frame-panel-header-py)">
            <FrameTitle><h2 id={id}>{title}</h2></FrameTitle>
            <CollapsibleTrigger className={buttonVariants({ variant: "ghost", size: "icon-xs", className: "-my-1" })} aria-label={open ? `Collapse ${title}` : `Expand ${title}`}>
              <ChevronDownIcon aria-hidden className={cn("transition-transform", open ? "rotate-180" : "")} />
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            <FramePanel>{children}</FramePanel>
          </CollapsibleContent>
        </Frame>
      </Collapsible>
    </section>
  );
}

export interface CallDetailNavigation {
  back: string;
  previous: CallStep | null;
  next: CallStep | null;
}

/** A previous or next Call step that says which Call it goes to. */
function StepCall({ label, step, timeZone, children }: { label: string; step: CallStep | null; timeZone: string; children: ReactNode }) {
  if (!step) {
    return (
      <Button variant="outline" size="sm" aria-label={label} disabled>
        {children}
        <span className="hidden text-xs font-normal text-muted-foreground sm:inline">None</span>
      </Button>
    );
  }
  const caller = step.callerNumber ?? "Unknown caller";
  return (
    <Link className={buttonVariants({ variant: "outline", size: "sm" })} aria-label={`${label}: ${caller}, ${formatCallTime(step.startedAt, timeZone)}`} href={step.href} prefetch>
      {children}
      <span className="hidden items-baseline gap-1.5 sm:inline-flex">
        <span className="tabular-nums">{caller}</span>
        <span className="text-xs font-normal text-muted-foreground tabular-nums">{formatTimeOfDay(step.startedAt, timeZone)}</span>
      </span>
    </Link>
  );
}

function ActionsMenu({ call, operator, onPurged }: { call: CallDetail; operator: boolean; onPurged(purgedAt: string): void }) {
  const [dialog, setDialog] = useState<"export" | "purge" | null>(null);
  const purgeable = operator && canPurgeMedia(call.recording);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className={buttonVariants({ variant: "outline", size: "icon" })} aria-label="Call actions">
          <EllipsisIcon aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {call.mp3RecordingId ? (
            <DropdownMenuItem render={<a href={`/api/workspaces/${call.workspace.id}/recordings/${call.mp3RecordingId}/mp3`} download />}>
              <DownloadIcon aria-hidden /> Download MP3
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => setDialog("export")}>
            <DownloadIcon aria-hidden /> Export Call
          </DropdownMenuItem>
          {purgeable ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDialog("purge")}>
                <Trash2Icon aria-hidden /> Purge Media
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <ExportCallDialog workspaceId={call.workspace.id} callId={call.id} open={dialog === "export"} onOpenChange={(open) => setDialog(open ? "export" : null)} />
      {purgeable ? (
        <PurgeMediaDialog workspaceId={call.workspace.id} callId={call.id} open={dialog === "purge"} onOpenChange={(open) => setDialog(open ? "purge" : null)} onPurged={onPurged} />
      ) : null}
    </>
  );
}

function Verdict({ call, operator, analysis }: { call: CallDetail; operator: boolean; analysis: ReturnType<typeof useCallAnalysis> }) {
  const [open, setOpen] = useState(false);
  const assessment = analysis.assessment;
  const effective = call.effectiveLeadClassification;
  const timeZone = call.workspace.reportingTimezone;
  const showReview = call.leadReview !== null || operator;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Frame>
        <FramePanel className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              {effective ? <LeadClassificationBadge classification={effective.classification} automated={effective.source === "assessment"} /> : <Badge variant="outline">No classification</Badge>}
              {assessment.state === "Completed" && assessment.score !== undefined ? <span className="text-sm font-medium tabular-nums">{assessment.score} / 100</span> : null}
            </div>
            {assessment.state === "Completed" && assessment.summary ? (
              <p className="w-full text-sm md:w-auto md:min-w-0 md:flex-1">{assessment.summary}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No automated summary yet.</p>
            )}
            <CollapsibleTrigger className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {open ? "Hide details" : "Details"}
              <ChevronDownIcon data-icon="inline-end" aria-hidden className={cn("transition-transform", open ? "rotate-180" : "")} />
            </CollapsibleTrigger>
          </div>
          {call.leadReview ? (
            <p className="text-xs text-muted-foreground tabular-nums">
              Reporting result reviewed by {call.leadReview.reviewerName ?? "a former Operator"} on {formatCallTime(call.leadReview.reviewedAt, timeZone)}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Automated estimate, not yet reviewed.</p>
          )}
          <CollapsibleContent className="grid gap-6 border-t border-border pt-3 md:grid-cols-2">
            {showReview ? (
              <section aria-labelledby="call-lead-review-title" className="flex flex-col gap-2">
                <h2 id="call-lead-review-title" className="text-xs font-medium text-muted-foreground">Lead Review</h2>
                <LeadReviewBody call={call} operator={operator} />
              </section>
            ) : null}
            <section aria-labelledby="call-lead-assessment-title" className="flex flex-col gap-2">
              <h2 id="call-lead-assessment-title" className="text-xs font-medium text-muted-foreground">Lead Assessment</h2>
              <AssessmentBody
                assessment={assessment}
                operator={operator}
                retry={analysis.retry}
                timeZone={timeZone}
                reviewed={call.leadReview !== null}
                contentRemoval={analysis.contentRemoval}
                onEvidence={analysis.selectEvidence}
              />
            </section>
          </CollapsibleContent>
        </FramePanel>
      </Frame>
    </Collapsible>
  );
}

interface CallDetailViewProps {
  call: CallDetail;
  operator: boolean;
  autoPlay?: boolean;
  navigation?: CallDetailNavigation;
}

export default function CallDetailView(props: CallDetailViewProps) {
  // The provider wraps the whole reader so the analysis hook, the Transcript,
  // and the player all share one playback.
  return (
    <PlaybackProvider>
      <CallDetailReader {...props} />
    </PlaybackProvider>
  );
}

function CallDetailReader({
  call: loadedCall,
  operator,
  autoPlay = false,
  navigation = { back: `/workspaces/${loadedCall.workspace.id}/calls`, previous: null, next: null },
}: CallDetailViewProps) {
  const [purge, setPurge] = useState<{ call: CallDetail; purgedAt: string } | null>(null);
  const call = purge?.call === loadedCall ? purgedCallDetail(loadedCall, purge.purgedAt) : loadedCall;
  const timeZone = call.workspace.reportingTimezone;
  const analysis = useCallAnalysis(call);
  const caller = call.callerNumber ?? "Unknown caller";
  return (
    <div className="flex min-h-[calc(100vh-6rem)] flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <Link className={buttonVariants({ variant: "ghost", size: "icon", className: "-ml-2" })} href={navigation.back} prefetch aria-label="Back to Calls">
          <ChevronLeftIcon aria-hidden />
        </Link>
        <BreadcrumbLabel segment={call.id} label={caller} />
        <h1 className="text-xl font-semibold tracking-tight tabular-nums">{caller}</h1>
        <div className="flex items-center gap-2">
          <CallOutcomeBadge outcome={call.outcome} />
          {call.effectiveLeadClassification ? (
            <LeadClassificationBadge classification={call.effectiveLeadClassification.classification} automated={call.effectiveLeadClassification.source === "assessment"} />
          ) : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <Link href={`/workspaces/${call.workspace.id}`} prefetch className="text-foreground transition-colors hover:text-muted-foreground">
            {call.workspace.name}
          </Link>
          <span>
            Tracking Number <span className="text-foreground tabular-nums">{call.trackingNumber}</span>
          </span>
          <span className="tabular-nums">{formatCallTime(call.startedAt, timeZone)}</span>
        </p>
        <div className="ml-auto flex items-center gap-2">
          <ButtonGroup aria-label="Call navigation">
            <StepCall label="Previous Call" step={navigation.previous} timeZone={timeZone}>
              <ChevronUpIcon data-icon="inline-start" aria-hidden />
            </StepCall>
            <StepCall label="Next Call" step={navigation.next} timeZone={timeZone}>
              <ChevronDownIcon data-icon="inline-start" aria-hidden />
            </StepCall>
          </ButtonGroup>
          <ActionsMenu call={call} operator={operator} onPurged={(purgedAt) => setPurge({ call: loadedCall, purgedAt })} />
        </div>
      </header>
      <Verdict call={call} operator={operator} analysis={analysis} />
      <div className="grid flex-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="call-transcript-title" className="sticky top-4">
          <Frame>
            <FrameHeader>
              <FrameTitle><h2 id="call-transcript-title">Transcript</h2></FrameTitle>
            </FrameHeader>
            <FramePanel>
              <TranscriptBody transcript={analysis.transcript} operator={operator} retry={analysis.retry} emphasis={analysis.emphasis} listClassName="max-h-[calc(100vh-22rem)]" />
            </FramePanel>
          </Frame>
        </section>
        <div className="flex flex-col gap-4">
          <RailSection id="call-facts-title" title="Call facts" defaultOpen>
            <CallFacts call={call} />
          </RailSection>
          <RailSection id="call-timeline-title" title="Processing timeline" defaultOpen={false}>
            <ProcessingTimeline call={call} />
          </RailSection>
        </div>
      </div>
      <section aria-labelledby="call-recording-title" className="sticky bottom-0 z-10 -mx-6 -mb-6 border-t border-border bg-background px-6 py-3">
        <h2 id="call-recording-title" className="sr-only">Recording</h2>
        <RecordingPlayer workspaceId={call.workspace.id} recording={call.recording} autoPlay={autoPlay} turns={call.transcript.turns} />
      </section>
    </div>
  );
}
