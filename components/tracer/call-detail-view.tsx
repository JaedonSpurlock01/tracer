/**
 * -------------------------------------------------------------------------
 * @file   call-detail-view.tsx
 * @brief  Renders Call Detail as a Frame stack.
 *
 * @description
 *  Shows the caller number as the Call's identity with its Workspace,
 *  Tracking Number, Call Outcome, and effective Lead classification, a
 *  sticky Recording player Frame, the Transcript, Lead Review, and Lead
 *  Assessment, the Call facts in a dense definition list, and the
 *  processing timeline. The Twilio call SID appears only when the read
 *  model provides it, which it does for Operators. The header links back
 *  to the list the Call was opened from and steps to the previous and next
 *  Call in it, with a step disabled at either end of the list.
 *
 * @remarks
 *  A PlaybackProvider spans the player and the analysis regions so the
 *  Transcript and evidence can follow and seek playback. The header offers
 *  Download MP3 whenever the read model gives a downloadable MP3, whatever
 *  the waveform state; the read model withholds it once media expires. It
 *  downloads through the Workspace-authorized MP3 route. Export Call
 *  confirms and requests a single-Call Recording ZIP. Purge Media waits
 *  for a later milestone, so it does not render here. The page resolves the back link and previous and next Call
 *  hrefs on the server; without them the back link is Workspace Calls and
 *  both steps are disabled. Previous and next are compact icon buttons so
 *  the header row fits at 390px. Call Detail is a record-detail page, so
 *  it renders no Workspace tabs. Times use the Workspace reporting
 *  timezone.
 *
 * @see
 *  data/call-details.ts
 *  components/tracer/recording-player.tsx
 *  components/tracer/call-analysis.tsx
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDownIcon, ChevronLeftIcon, ChevronUpIcon, DownloadIcon } from "lucide-react";

import { Badge } from "@/components/reui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Frame, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Timeline, TimelineContent, TimelineDate, TimelineHeader, TimelineIndicator, TimelineItem, TimelineSeparator, TimelineTitle } from "@/components/reui/timeline";
import CallAnalysis from "@/components/tracer/call-analysis";
import { ExportCallButton } from "@/components/tracer/call-export";
import CallOutcomeBadge from "@/components/tracer/call-outcome-badge";
import { formatCallDate, formatCallTime, formatClock, formatTimeOfDay } from "@/components/tracer/call-format";
import LeadClassificationBadge from "@/components/tracer/lead-classification-badge";
import { PlaybackProvider } from "@/components/tracer/playback";
import RecordingPlayer from "@/components/tracer/recording-player";
import type { CallDetail, CallTimelineEntry } from "@/data/call-details";

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

function ProcessingTimeline({ call }: { call: CallDetail }) {
  const completed = call.timeline.findIndex((entry) => entry.status !== "Completed");
  return (
    <section aria-labelledby="call-timeline-title">
      <Frame>
        <FrameHeader>
          <FrameTitle><h2 id="call-timeline-title">Processing timeline</h2></FrameTitle>
        </FrameHeader>
        <FramePanel>
          {call.timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No processing events were recorded for this Call.</p>
          ) : (
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
          )}
        </FramePanel>
      </Frame>
    </section>
  );
}

export interface CallDetailNavigation {
  back: string;
  previous: string | null;
  next: string | null;
}

function StepCall({ label, href, children }: { label: string; href: string | null; children: ReactNode }) {
  return href ? (
    <Link className={buttonVariants({ variant: "outline", size: "icon" })} aria-label={label} href={href} prefetch>
      {children}
    </Link>
  ) : (
    <Button variant="outline" size="icon" aria-label={label} disabled>
      {children}
    </Button>
  );
}

export default function CallDetailView({
  call,
  operator,
  autoPlay = false,
  navigation = { back: `/workspaces/${call.workspace.id}/calls`, previous: null, next: null },
}: {
  call: CallDetail;
  operator: boolean;
  autoPlay?: boolean;
  navigation?: CallDetailNavigation;
}) {
  const timeZone = call.workspace.reportingTimezone;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Link className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2.5" })} href={navigation.back} prefetch>
            <ChevronLeftIcon data-icon="inline-start" aria-hidden />
            Back to Calls
          </Link>
          <ButtonGroup aria-label="Call navigation">
            <StepCall label="Previous Call" href={navigation.previous}>
              <ChevronUpIcon aria-hidden />
            </StepCall>
            <StepCall label="Next Call" href={navigation.next}>
              <ChevronDownIcon aria-hidden />
            </StepCall>
          </ButtonGroup>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight tabular-nums">{call.callerNumber ?? "Unknown caller"}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {call.mp3RecordingId ? (
              <a className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/workspaces/${call.workspace.id}/recordings/${call.mp3RecordingId}/mp3`} download>
                <DownloadIcon data-icon="inline-start" aria-hidden />
                Download MP3
              </a>
            ) : null}
            <ExportCallButton workspaceId={call.workspace.id} callId={call.id} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <CallOutcomeBadge outcome={call.outcome} />
          {call.effectiveLeadClassification ? (
            <LeadClassificationBadge classification={call.effectiveLeadClassification.classification} automated={call.effectiveLeadClassification.source === "assessment"} />
          ) : null}
          <Link href={`/workspaces/${call.workspace.id}`} prefetch className="text-foreground transition-colors hover:text-muted-foreground">
            {call.workspace.name}
          </Link>
          <span>
            Tracking Number <span className="text-foreground tabular-nums">{call.trackingNumber}</span>
          </span>
        </div>
      </header>
      <PlaybackProvider>
        <section aria-labelledby="call-recording-title" className="sticky top-0 z-10">
          <Frame variant="inverse">
            <FrameHeader>
              <FrameTitle><h2 id="call-recording-title">Recording</h2></FrameTitle>
            </FrameHeader>
            <FramePanel>
              <RecordingPlayer workspaceId={call.workspace.id} recording={call.recording} autoPlay={autoPlay} />
            </FramePanel>
          </Frame>
        </section>
        <CallAnalysis call={call} operator={operator} />
      </PlaybackProvider>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-labelledby="call-facts-title">
          <Frame>
            <FrameHeader>
              <FrameTitle><h2 id="call-facts-title">Call facts</h2></FrameTitle>
            </FrameHeader>
            <FramePanel className="flex flex-col gap-4">
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
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
            </FramePanel>
          </Frame>
        </section>
        <ProcessingTimeline call={call} />
      </div>
    </div>
  );
}
