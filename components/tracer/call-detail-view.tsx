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
 *  model provides it, which it does for Operators.
 *
 * @remarks
 *  A PlaybackProvider spans the player and the analysis regions so the
 *  Transcript and evidence can follow and seek playback. Download MP3,
 *  Export Call, Purge Media, and previous and next Call navigation wait for
 *  later milestones, so none of them render here. Times use the Workspace
 *  reporting timezone.
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

import { Badge } from "@/components/reui/badge";
import { Frame, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Timeline, TimelineContent, TimelineDate, TimelineHeader, TimelineIndicator, TimelineItem, TimelineSeparator, TimelineTitle } from "@/components/reui/timeline";
import CallAnalysis from "@/components/tracer/call-analysis";
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

export default function CallDetailView({ call, operator }: { call: CallDetail; operator: boolean }) {
  const timeZone = call.workspace.reportingTimezone;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight tabular-nums">{call.callerNumber ?? "Unknown caller"}</h1>
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
              <RecordingPlayer workspaceId={call.workspace.id} recording={call.recording} />
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
