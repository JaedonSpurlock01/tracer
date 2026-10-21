/**
 * PROTOTYPE - throwaway. Three Call Detail layouts on the live route,
 * switchable via ?variant=A|B|C. Each variant composes the real Recording
 * engine, Transcript, Lead Review, Lead Assessment, Call facts, and
 * timeline bodies under its own chrome, so what differs is structure, not
 * data. All three center the transport controls the way music players do.
 *
 *  A  Studio   waveform hero, centered transport, analysis in a side rail
 *  B  Reader   the Transcript is the page; a sticky now-playing bar below
 *  C  Dossier  verdict scorecard, a talk track built from the Transcript,
 *              one tabbed Frame for the rest
 *
 * Variants are read-only: Purge Media and Export Call are wired to the real
 * confirmations but a purge result is ignored, and Download MP3 points at
 * the fixture's id in demo mode.
 */
"use client";

import { cn } from "cn";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  AudioLinesIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronUpIcon,
  DownloadIcon,
  EllipsisIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  RotateCwIcon,
  Volume2Icon,
  VolumeXIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";

import { Badge } from "@/components/reui/badge";
import { Frame, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ButtonGroup } from "@/components/ui/button-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { BreadcrumbLabel } from "@/components/tracer/breadcrumbs";
import { AssessmentBody, LeadReviewBody, TranscriptBody, useCallAnalysis } from "@/components/tracer/call-analysis";
import { CallFacts, ProcessingTimeline, type CallDetailNavigation } from "@/components/tracer/call-detail-view";
import { ExportCallButton } from "@/components/tracer/call-export";
import { formatCallTime, formatClock } from "@/components/tracer/call-format";
import CallOutcomeBadge from "@/components/tracer/call-outcome-badge";
import LeadClassificationBadge from "@/components/tracer/lead-classification-badge";
import { PlaybackProvider, usePlayback } from "@/components/tracer/playback";
import PurgeMediaButton, { canPurgeMedia } from "@/components/tracer/purge-media";
import { longSeekStepSeconds, playbackRates, useRecordingEngine, zoomLevels, type ReadyRecording, type RecordingEngine } from "@/components/tracer/recording-engine";
import { RecordingState, RecordingWaveform, sliderNumber } from "@/components/tracer/recording-player";
import type { CallDetail } from "@/data/call-details";
import type { TranscriptTurn } from "@/data/transcript";

export interface VariantProps {
  call: CallDetail;
  operator: boolean;
  autoPlay: boolean;
  navigation: CallDetailNavigation;
  mediaPath: string;
}

/* ----------------------------------------------------------------------- */
/* Shared player pieces: every variant centers these the same way.          */
/* ----------------------------------------------------------------------- */

function Transport({ engine, size = "lg" }: { engine: RecordingEngine; size?: "lg" | "md" }) {
  const play = size === "lg" ? "size-12 rounded-full [&_svg:not([class*='size-'])]:size-5" : "size-10 rounded-full [&_svg:not([class*='size-'])]:size-4";
  return (
    <div className="flex items-center justify-center gap-1">
      <Button type="button" variant="ghost" size="icon-lg" aria-label="Back 10 seconds" onClick={() => engine.skip(-longSeekStepSeconds)} className="relative [&_svg:not([class*='size-'])]:size-6">
        <RotateCcwIcon strokeWidth={1.75} />
        <span aria-hidden className="absolute inset-0 flex items-center justify-center pt-0.5 text-[0.5rem] leading-none font-semibold tabular-nums">10</span>
      </Button>
      <Button type="button" size="icon-lg" aria-label={engine.playing ? "Pause" : "Play"} onClick={engine.togglePlay} className={cn("mx-1", play)}>
        {engine.playing ? <PauseIcon className="fill-current" /> : <PlayIcon className="fill-current" />}
      </Button>
      <Button type="button" variant="ghost" size="icon-lg" aria-label="Forward 10 seconds" onClick={() => engine.skip(longSeekStepSeconds)} className="relative [&_svg:not([class*='size-'])]:size-6">
        <RotateCwIcon strokeWidth={1.75} />
        <span aria-hidden className="absolute inset-0 flex items-center justify-center pt-0.5 text-[0.5rem] leading-none font-semibold tabular-nums">10</span>
      </Button>
    </div>
  );
}

function Scrubber({ engine, id }: { engine: RecordingEngine; id: string }) {
  const { currentTime, duration } = engine;
  return (
    <div className="flex items-center gap-3">
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{formatClock(currentTime)}</span>
      <span id={id} className="sr-only">Seek</span>
      <div className="min-w-0 flex-1">
        <Slider
          aria-labelledby={id}
          value={[Math.min(currentTime, duration)]}
          min={0}
          max={Math.max(duration, 1)}
          step={1}
          largeStep={longSeekStepSeconds}
          onValueChange={(value) => engine.seek(sliderNumber(value))}
          getAriaValueText={(_formatted, value) => `${formatClock(value)} of ${formatClock(duration)}`}
        />
      </div>
      <span className="w-10 shrink-0 text-xs tabular-nums text-muted-foreground">{formatClock(duration)}</span>
    </div>
  );
}

function RateSelect({ engine }: { engine: RecordingEngine }) {
  return (
    <Select value={engine.rate} onValueChange={engine.changeRate}>
      <SelectTrigger size="sm" aria-label="Playback speed" className="w-20">
        <SelectValue>{(value: string) => `${value}x`}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {playbackRates.map((value) => (
          <SelectItem key={value} value={value}>{`${value}x`}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function VolumeControl({ engine, id, compact = false }: { engine: RecordingEngine; id: string; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="ghost" size="icon-sm" aria-label={engine.muted ? "Unmute" : "Mute"} onClick={engine.toggleMute}>
        {engine.muted ? <VolumeXIcon /> : <Volume2Icon />}
      </Button>
      <span id={id} className="sr-only">Volume</span>
      <div className={compact ? "hidden w-20 sm:block" : "w-24"}>
      <Slider
        aria-labelledby={id}
        value={[engine.muted ? 0 : Math.round(engine.volume * 100)]}
        min={0}
        max={100}
        step={10}
        onValueChange={(value) => engine.changeVolume(sliderNumber(value))}
        getAriaValueText={(_formatted, value) => `${Math.round(value)}%`}
      />
      </div>
    </div>
  );
}

function ZoomControls({ engine }: { engine: RecordingEngine }) {
  return (
    <ButtonGroup aria-label="Waveform zoom">
      <Button type="button" variant="outline" size="icon-sm" aria-label="Zoom out" disabled={!engine.waveformReady || engine.zoomIndex === 0} onClick={() => engine.zoomBy(-1)}>
        <ZoomOutIcon />
      </Button>
      <Button type="button" variant="outline" size="icon-sm" aria-label="Zoom in" disabled={!engine.waveformReady || engine.zoomIndex === zoomLevels.length - 1} onClick={() => engine.zoomBy(1)}>
        <ZoomInIcon />
      </Button>
    </ButtonGroup>
  );
}

function AudioError({ engine }: { engine: RecordingEngine }) {
  if (!engine.audioError) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <p role="alert" className="text-sm">Recording audio could not be loaded.</p>
      <Button type="button" variant="outline" size="sm" onClick={engine.retryAudio}>Retry</Button>
    </div>
  );
}


/* ----------------------------------------------------------------------- */
/* Mirrored waveform: one lane, Caller above the center line, Business      */
/* below, the way CallRail draws a two-party call. Drawn from the engine's  */
/* peaks as SVG bars so it needs no wavesurfer instance.                    */
/* ----------------------------------------------------------------------- */

const mirrorBarWidth = 2;
const mirrorBarGap = 1;

function bucketMax(lane: number[], buckets: number): number[] {
  const size = lane.length / buckets;
  return Array.from({ length: buckets }, (_, index) => {
    const start = Math.floor(index * size);
    const end = Math.max(start + 1, Math.floor((index + 1) * size));
    let max = 0;
    for (let point = start; point < end; point += 1) max = Math.max(max, lane[point] ?? 0);
    return max;
  });
}

function MirrorWaveform({ engine, height = 56 }: { engine: RecordingEngine; height?: number }) {
  const { peaksData, peaks, currentTime, duration, seek } = engine;
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const dragging = useRef(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [peaks]); // the container mounts only once peaks are ready

  const bars = Math.max(1, Math.floor(width / (mirrorBarWidth + mirrorBarGap)));
  const halves = useMemo(() => {
    if (!peaksData) return null;
    const [top, bottom] = peaksData.lanes.length > 1 ? peaksData.peaks : [peaksData.peaks[0], peaksData.peaks[0]];
    return { top: bucketMax(top, bars), bottom: bucketMax(bottom, bars), labels: peaksData.lanes.length > 1 ? peaksData.lanes : ["Mixed", "Mixed"] };
  }, [peaksData, bars]);

  function seekFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    seek(ratio * duration);
  }

  if (peaks === "loading") return <Skeleton className="w-full" style={{ height }} />;
  if (!halves) return null;
  const progress = duration ? Math.min(currentTime / duration, 1) : 0;
  const playedBars = Math.round(progress * bars);
  const mid = height / 2;
  const half = mid - 1;
  return (
    <div className="flex items-stretch gap-3" style={{ height }}>
      <div className="flex w-10 shrink-0 flex-col justify-between text-right text-[0.65rem] leading-none font-medium text-muted-foreground">
        <span>{halves.labels[0]}</span>
        <span>{halves.labels[1]}</span>
      </div>
    <div
      ref={containerRef}
      role="group"
      aria-label="Waveform"
      tabIndex={0}
      className="relative min-w-0 flex-1 cursor-pointer touch-none select-none rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      style={{ height }}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        seekFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) seekFromPointer(event);
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    >
      <svg width={width} height={height} className="block" aria-hidden>
        <line x1={0} x2={width} y1={mid} y2={mid} className="stroke-border" strokeWidth={1} />
        {halves.top.map((value, index) => {
          const x = index * (mirrorBarWidth + mirrorBarGap);
          const up = Math.max(1, value * half);
          const down = Math.max(1, halves.bottom[index] * half);
          const played = index < playedBars;
          return (
            <g key={index} className={played ? "fill-foreground" : "fill-muted-foreground/60"}>
              <rect x={x} y={mid - up} width={mirrorBarWidth} height={up} rx={1} />
              <rect x={x} y={mid + 1} width={mirrorBarWidth} height={down} rx={1} />
            </g>
          );
        })}
        <line x1={progress * width} x2={progress * width} y1={0} y2={height} className="stroke-primary" strokeWidth={2} />
      </svg>
    </div>
      <div className="w-10 shrink-0" aria-hidden />
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Shared header pieces.                                                     */
/* ----------------------------------------------------------------------- */

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

function NavRow({ navigation, compact = false }: { navigation: CallDetailNavigation; compact?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Link className={buttonVariants({ variant: "ghost", size: compact ? "icon" : "sm", className: "-ml-2.5" })} href={navigation.back} prefetch aria-label={compact ? "Back to Calls" : undefined}>
        <ChevronLeftIcon data-icon={compact ? undefined : "inline-start"} aria-hidden />
        {compact ? null : "Back to Calls"}
      </Link>
      <ButtonGroup aria-label="Call navigation">
        <StepCall label="Previous Call" href={navigation.previous}><ChevronUpIcon aria-hidden /></StepCall>
        <StepCall label="Next Call" href={navigation.next}><ChevronDownIcon aria-hidden /></StepCall>
      </ButtonGroup>
    </div>
  );
}

function Actions({ call, operator }: { call: CallDetail; operator: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {call.mp3RecordingId ? (
        <a className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/workspaces/${call.workspace.id}/recordings/${call.mp3RecordingId}/mp3`} download>
          <DownloadIcon data-icon="inline-start" aria-hidden />
          Download MP3
        </a>
      ) : null}
      <ExportCallButton workspaceId={call.workspace.id} callId={call.id} />
      {operator && canPurgeMedia(call.recording) ? <PurgeMediaButton workspaceId={call.workspace.id} callId={call.id} onPurged={() => undefined} /> : null}
    </div>
  );
}

function Badges({ call }: { call: CallDetail }) {
  return (
    <>
      <CallOutcomeBadge outcome={call.outcome} />
      {call.effectiveLeadClassification ? (
        <LeadClassificationBadge classification={call.effectiveLeadClassification.classification} automated={call.effectiveLeadClassification.source === "assessment"} />
      ) : null}
    </>
  );
}

function MetaLine({ call }: { call: CallDetail }) {
  const timeZone = call.workspace.reportingTimezone;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <Link href={`/workspaces/${call.workspace.id}`} prefetch className="text-foreground transition-colors hover:text-muted-foreground">{call.workspace.name}</Link>
      <span>Tracking Number <span className="text-foreground tabular-nums">{call.trackingNumber}</span></span>
      <span className="tabular-nums">{formatCallTime(call.startedAt, timeZone)}</span>
      {call.connectedDurationSeconds !== null ? <span className="tabular-nums">{formatClock(call.connectedDurationSeconds)} connected</span> : null}
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Variant A: Studio.                                                        */
/* ----------------------------------------------------------------------- */

function StudioPlayer({ recording, mediaPath, autoPlay }: { recording: ReadyRecording; mediaPath: string; autoPlay: boolean }) {
  const engine = useRecordingEngine({ mediaPath, recording, autoPlay });
  return (
    <div className="flex flex-col gap-3" onKeyDown={engine.handleShortcut}>
      <audio {...engine.audioProps} />
      <RecordingWaveform engine={engine} laneCount={recording.lanes.length} />
      <Scrubber engine={engine} id="studio-seek" />
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex items-center gap-2">
          <RateSelect engine={engine} />
          <ZoomControls engine={engine} />
        </div>
        <Transport engine={engine} />
        <div className="flex justify-end">
          <VolumeControl engine={engine} id="studio-volume" compact />
        </div>
      </div>
      <AudioError engine={engine} />
    </div>
  );
}

export function VariantA({ call, operator, autoPlay, navigation, mediaPath }: VariantProps) {
  const analysis = useCallAnalysis(call);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <NavRow navigation={navigation} />
        <BreadcrumbLabel segment={call.id} label={call.callerNumber ?? "Unknown caller"} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight tabular-nums">{call.callerNumber ?? "Unknown caller"}</h1>
            <div className="flex items-center gap-2"><Badges call={call} /></div>
          </div>
          <Actions call={call} operator={operator} />
        </div>
        <MetaLine call={call} />
      </header>
      <PlaybackProvider>
        <section aria-labelledby="call-recording-title" className="sticky top-0 z-10">
          <Frame variant="inverse">
            <FrameHeader>
              <FrameTitle><h2 id="call-recording-title">Recording</h2></FrameTitle>
            </FrameHeader>
            <FramePanel>
              {call.recording.state === "Ready" ? <StudioPlayer recording={call.recording} mediaPath={mediaPath} autoPlay={autoPlay} /> : <RecordingState recording={call.recording} />}
            </FramePanel>
          </Frame>
        </section>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section aria-labelledby="call-transcript-title">
            <Frame>
              <FrameHeader>
                <FrameTitle><h2 id="call-transcript-title">Transcript</h2></FrameTitle>
              </FrameHeader>
              <FramePanel>
                <TranscriptBody transcript={analysis.transcript} operator={operator} retry={analysis.retry} emphasis={analysis.emphasis} listClassName="max-h-[60vh]" />
              </FramePanel>
            </Frame>
          </section>
          <div className="flex flex-col gap-6">
            <section aria-labelledby="call-lead-title">
              <Frame stacked>
                <FrameHeader>
                  <FrameTitle><h2 id="call-lead-title">Lead</h2></FrameTitle>
                </FrameHeader>
                {call.leadReview || operator ? (
                  <FramePanel>
                    <h3 className="mb-2 text-xs font-medium text-muted-foreground">Lead Review</h3>
                    <LeadReviewBody call={call} operator={operator} />
                  </FramePanel>
                ) : null}
                <FramePanel>
                  <h3 className="mb-2 text-xs font-medium text-muted-foreground">Lead Assessment</h3>
                  <AssessmentBody
                    assessment={analysis.assessment}
                    operator={operator}
                    retry={analysis.retry}
                    timeZone={call.workspace.reportingTimezone}
                    reviewed={call.leadReview !== null}
                    contentRemoval={analysis.contentRemoval}
                    onEvidence={analysis.selectEvidence}
                  />
                </FramePanel>
              </Frame>
            </section>
            <section aria-labelledby="call-facts-title">
              <Frame>
                <FrameHeader>
                  <FrameTitle><h2 id="call-facts-title">Call facts</h2></FrameTitle>
                </FrameHeader>
                <FramePanel className="flex flex-col gap-4">
                  <CallFacts call={call} />
                  <p className="text-xs text-muted-foreground">Times are shown in {call.workspace.reportingTimezone}.</p>
                </FramePanel>
              </Frame>
            </section>
            <ProcessingTimeline call={call} />
          </div>
        </div>
      </PlaybackProvider>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Variant B: Reader.                                                        */
/* ----------------------------------------------------------------------- */

function speakingNow(turns: TranscriptTurn[] | undefined, seconds: number): TranscriptTurn["speaker"] | null {
  const ms = seconds * 1000;
  return turns?.find((turn) => ms >= turn.startMs && ms < turn.endMs)?.speaker ?? null;
}

function NowPlayingBar({ recording, mediaPath, autoPlay, turns }: { recording: ReadyRecording; mediaPath: string; autoPlay: boolean; turns: TranscriptTurn[] | undefined }) {
  const engine = useRecordingEngine({ mediaPath, recording, autoPlay });
  const speaker = speakingNow(turns, engine.currentTime);
  return (
    <div className="flex flex-col gap-2" onKeyDown={engine.handleShortcut}>
      <audio {...engine.audioProps} />
      <MirrorWaveform engine={engine} />
      <Scrubber engine={engine} id="reader-seek" />
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <AudioLinesIcon className={cn("size-4 shrink-0", engine.playing ? "text-foreground" : "")} aria-hidden />
          <span className="truncate">{engine.playing ? (speaker ? `${speaker} speaking` : "Silence") : "Paused"}</span>
          <span className="hidden sm:inline">&middot; {recording.channels === 2 ? "Dual-channel" : "Mixed audio"}</span>
        </div>
        <Transport engine={engine} size="md" />
        <div className="flex items-center justify-end gap-2">
          <RateSelect engine={engine} />
          <VolumeControl engine={engine} id="reader-volume" compact />
        </div>
      </div>
      <AudioError engine={engine} />
    </div>
  );
}

function Verdict({ call, operator, analysis }: { call: CallDetail; operator: boolean; analysis: ReturnType<typeof useCallAnalysis> }) {
  const [open, setOpen] = useState(false);
  const assessment = analysis.assessment;
  const effective = call.effectiveLeadClassification;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Frame>
        <FramePanel className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              {effective ? <LeadClassificationBadge classification={effective.classification} automated={effective.source === "assessment"} /> : <Badge variant="outline">No classification</Badge>}
              {assessment.state === "Completed" && assessment.score !== undefined ? <span className="text-sm font-medium tabular-nums">{assessment.score} / 100</span> : null}
            </div>
            {assessment.state === "Completed" && assessment.summary ? <p className="w-full text-sm md:w-auto md:min-w-0 md:flex-1">{assessment.summary}</p> : <p className="text-sm text-muted-foreground">No automated summary yet.</p>}
            <CollapsibleTrigger
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              {open ? "Hide details" : "Details"}
              <ChevronDownIcon data-icon="inline-end" aria-hidden className={cn("transition-transform", open ? "rotate-180" : "")} />
            </CollapsibleTrigger>
          </div>
          {call.leadReview ? (
            <p className="text-xs text-muted-foreground tabular-nums">
              Reporting result reviewed by {call.leadReview.reviewerName ?? "a former Operator"} on {formatCallTime(call.leadReview.reviewedAt, call.workspace.reportingTimezone)}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Automated estimate, not yet reviewed.</p>
          )}
          <CollapsibleContent className="grid gap-6 border-t border-border pt-3 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">Lead Assessment</h3>
              <AssessmentBody
                assessment={assessment}
                operator={operator}
                retry={analysis.retry}
                timeZone={call.workspace.reportingTimezone}
                reviewed={call.leadReview !== null}
                contentRemoval={analysis.contentRemoval}
                onEvidence={analysis.selectEvidence}
              />
            </div>
            {call.leadReview || operator ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">Lead Review</h3>
                <LeadReviewBody call={call} operator={operator} />
              </div>
            ) : null}
          </CollapsibleContent>
        </FramePanel>
      </Frame>
    </Collapsible>
  );
}

function RailSection({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Frame>
        <div className="flex items-center justify-between px-(--frame-panel-header-px) py-(--frame-panel-header-py)">
          <FrameTitle><h2>{title}</h2></FrameTitle>
          <CollapsibleTrigger className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label={open ? `Collapse ${title}` : `Expand ${title}`}>
            <ChevronDownIcon aria-hidden className={cn("transition-transform", open ? "rotate-180" : "")} />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <FramePanel>{children}</FramePanel>
        </CollapsibleContent>
      </Frame>
    </Collapsible>
  );
}

export function VariantB({ call, operator, autoPlay, navigation, mediaPath }: VariantProps) {
  const analysis = useCallAnalysis(call);
  return (
    <div className="flex min-h-[calc(100vh-6rem)] flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <Link className={buttonVariants({ variant: "ghost", size: "icon", className: "-ml-2" })} href={navigation.back} prefetch aria-label="Back to Calls">
          <ChevronLeftIcon aria-hidden />
        </Link>
        <BreadcrumbLabel segment={call.id} label={call.callerNumber ?? "Unknown caller"} />
        <h1 className="text-xl font-semibold tracking-tight tabular-nums">{call.callerNumber ?? "Unknown caller"}</h1>
        <div className="flex items-center gap-2"><Badges call={call} /></div>
        <span className="hidden text-sm text-muted-foreground sm:inline">
          {call.workspace.name} &middot; <span className="tabular-nums">{formatCallTime(call.startedAt, call.workspace.reportingTimezone)}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <ButtonGroup aria-label="Call navigation">
            <StepCall label="Previous Call" href={navigation.previous}><ChevronUpIcon aria-hidden /></StepCall>
            <StepCall label="Next Call" href={navigation.next}><ChevronDownIcon aria-hidden /></StepCall>
          </ButtonGroup>
          <DropdownMenu>
            <DropdownMenuTrigger className={buttonVariants({ variant: "outline", size: "icon" })} aria-label="More actions">
              <EllipsisIcon aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {call.mp3RecordingId ? (
                <DropdownMenuItem render={<a href={`/api/workspaces/${call.workspace.id}/recordings/${call.mp3RecordingId}/mp3`} download />}>
                  <DownloadIcon aria-hidden /> Download MP3
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem>Export Call (stub)</DropdownMenuItem>
              {operator && canPurgeMedia(call.recording) ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive">Purge Media (stub)</DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <PlaybackProvider>
        <Verdict call={call} operator={operator} analysis={analysis} />
        <div className="grid flex-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section aria-labelledby="call-transcript-title">
            <Frame>
              <FrameHeader>
                <FrameTitle><h2 id="call-transcript-title">Transcript</h2></FrameTitle>
              </FrameHeader>
              <FramePanel>
                <TranscriptBody transcript={analysis.transcript} operator={operator} retry={analysis.retry} emphasis={analysis.emphasis} listClassName="max-h-[calc(100vh-24rem)]" />
              </FramePanel>
            </Frame>
          </section>
          <div className="flex flex-col gap-4">
            <RailSection title="Call facts" defaultOpen>
              <CallFacts call={call} className="sm:grid-cols-1" />
            </RailSection>
            <RailSection title="Processing timeline">
              <ProcessingTimelineBody call={call} />
            </RailSection>
          </div>
        </div>
        <section aria-labelledby="call-recording-title" className="sticky bottom-0 z-10 -mx-6 -mb-6 border-t border-border bg-background px-6 py-3">
          <h2 id="call-recording-title" className="sr-only">Recording</h2>
          {call.recording.state === "Ready" ? (
            <NowPlayingBar recording={call.recording} mediaPath={mediaPath} autoPlay={autoPlay} turns={call.transcript.turns} />
          ) : (
            <RecordingState recording={call.recording} />
          )}
        </section>
      </PlaybackProvider>
    </div>
  );
}

/** ProcessingTimeline without its own Frame, for a rail or a tab. */
function ProcessingTimelineBody({ call }: { call: CallDetail }) {
  // The real ProcessingTimeline owns its Frame; for the prototype, lift the
  // chrome off by rendering it inside a ghost Frame so the panel is flat.
  return (
    <div className="[&_[data-slot=frame-panel]]:border-0 [&_[data-slot=frame-panel]]:bg-transparent [&_[data-slot=frame-panel]]:p-0 [&_[data-slot=frame-header]]:hidden">
      <ProcessingTimeline call={call} />
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Variant C: Dossier.                                                       */
/* ----------------------------------------------------------------------- */

function talkStats(turns: TranscriptTurn[]) {
  const totals = { Caller: 0, Business: 0 };
  let longest: TranscriptTurn | null = null;
  for (const turn of turns) {
    const length = turn.endMs - turn.startMs;
    totals[turn.speaker] += length;
    if (!longest || length > longest.endMs - longest.startMs) longest = turn;
  }
  const spoken = totals.Caller + totals.Business || 1;
  return { callerShare: Math.round((totals.Caller / spoken) * 100), businessShare: Math.round((totals.Business / spoken) * 100), turns: turns.length, longest };
}

function TalkTrack({ turns, engine }: { turns: TranscriptTurn[]; engine: RecordingEngine }) {
  const playback = usePlayback();
  const duration = Math.max(engine.duration, 1);
  const lanes: TranscriptTurn["speaker"][] = ["Caller", "Business"];
  const activeIndex = turns.findIndex((turn) => playback.currentTime * 1000 >= turn.startMs && playback.currentTime * 1000 < turn.endMs);
  return (
    <div
      role="group"
      aria-label="Talk track"
      tabIndex={0}
      className="relative flex flex-col gap-1 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={(event) => {
        const track = event.currentTarget.querySelector<HTMLElement>("[data-track]");
        if (!track) return;
        const rect = track.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right) return;
        engine.seek(((event.clientX - rect.left) / rect.width) * duration);
      }}
    >
      {lanes.map((lane) => (
        <div key={lane} className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground">{lane}</span>
          <div data-track className="relative h-5 flex-1 cursor-pointer overflow-hidden rounded-sm bg-muted">
            {turns.map((turn, index) =>
              turn.speaker === lane ? (
                <span
                  key={index}
                  title={`${formatClock(turn.startMs / 1000)} ${turn.speaker}`}
                  className={cn("absolute inset-y-0 rounded-[2px] transition-colors", lane === "Caller" ? "bg-info/70" : "bg-primary/60", index === activeIndex ? "bg-foreground" : "")}
                  style={{ left: `${(turn.startMs / 1000 / duration) * 100}%`, width: `${Math.max(((turn.endMs - turn.startMs) / 1000 / duration) * 100, 0.4)}%` }}
                />
              ) : null,
            )}
          </div>
        </div>
      ))}
      <div className="pointer-events-none absolute inset-y-0 left-[calc(4rem+0.5rem)] right-0">
        <span className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${(Math.min(engine.currentTime, duration) / duration) * 100}%` }} aria-hidden />
      </div>
    </div>
  );
}

function DossierPlayer({ recording, mediaPath, autoPlay, turns }: { recording: ReadyRecording; mediaPath: string; autoPlay: boolean; turns: TranscriptTurn[] | undefined }) {
  const engine = useRecordingEngine({ mediaPath, recording, autoPlay });
  const stats = useMemo(() => (turns ? talkStats(turns) : null), [turns]);
  return (
    <div className="flex flex-col gap-3" onKeyDown={engine.handleShortcut}>
      <audio {...engine.audioProps} />
      {turns && turns.length ? (
        <TalkTrack turns={turns} engine={engine} />
      ) : (
        <p className="text-sm text-muted-foreground">No Transcript, so no talk track. Use the seek control below.</p>
      )}
      {stats ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          Caller {stats.callerShare}% &middot; Business {stats.businessShare}% &middot; {stats.turns} turns
          {stats.longest ? <> &middot; longest turn {formatClock(Math.round((stats.longest.endMs - stats.longest.startMs) / 1000))} ({stats.longest.speaker})</> : null}
        </p>
      ) : null}
      <Scrubber engine={engine} id="dossier-seek" />
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <RateSelect engine={engine} />
        <Transport engine={engine} />
        <div className="flex justify-end">
          <VolumeControl engine={engine} id="dossier-volume" compact />
        </div>
      </div>
      <AudioError engine={engine} />
    </div>
  );
}

function Scorecard({ call, operator, analysis }: { call: CallDetail; operator: boolean; analysis: ReturnType<typeof useCallAnalysis> }) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const assessment = analysis.assessment;
  const effective = call.effectiveLeadClassification;
  const score = assessment.state === "Completed" ? assessment.score : undefined;
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight tabular-nums">{call.callerNumber ?? "Unknown caller"}</h1>
        <div className="flex flex-wrap items-center gap-2"><Badges call={call} /></div>
        <MetaLine call={call} />
        <Actions call={call} operator={operator} />
      </div>
      <div className="flex shrink-0 flex-col gap-2 md:max-w-sm md:items-end md:text-right">
        <div className="flex items-baseline gap-2 md:justify-end">
          <span className="text-5xl font-semibold tabular-nums tracking-tight">{score ?? "–"}</span>
          <span className="text-sm text-muted-foreground">/ 100</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          {effective ? <LeadClassificationBadge classification={effective.classification} automated={effective.source === "assessment"} /> : <Badge variant="outline">No classification</Badge>}
          <Badge variant="outline">{call.leadReview ? "Reporting result" : "Automated estimate"}</Badge>
        </div>
        {assessment.state === "Completed" && assessment.summary ? <p className="text-sm">{assessment.summary}</p> : null}
        {call.leadReview ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            Reviewed by {call.leadReview.reviewerName ?? "a former Operator"} on {formatCallTime(call.leadReview.reviewedAt, call.workspace.reportingTimezone)}
            {call.leadReview.note ? <> &middot; &ldquo;{call.leadReview.note}&rdquo;</> : null}
          </p>
        ) : null}
        {operator ? (
          <Collapsible open={reviewOpen} onOpenChange={setReviewOpen} className="w-full">
            <CollapsibleTrigger className={buttonVariants({ variant: "outline", size: "sm" })}>
              {call.leadReview ? "Update Lead Review" : "Add Lead Review"}
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 text-left">
              <LeadReviewBody call={call} operator={operator} actionClassName="hidden" />
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </div>
    </div>
  );
}

const dossierTabs = [
  { key: "transcript", label: "Transcript" },
  { key: "assessment", label: "Lead Assessment" },
  { key: "facts", label: "Call facts" },
  { key: "timeline", label: "Timeline" },
] as const;
type DossierTab = (typeof dossierTabs)[number]["key"];

export function VariantC({ call, operator, autoPlay, navigation, mediaPath }: VariantProps) {
  const analysis = useCallAnalysis(call);
  const [tab, setTab] = useState<DossierTab>("transcript");
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <NavRow navigation={navigation} />
        <BreadcrumbLabel segment={call.id} label={call.callerNumber ?? "Unknown caller"} />
        <Frame>
          <FramePanel>
            <Scorecard call={call} operator={operator} analysis={analysis} />
          </FramePanel>
        </Frame>
      </header>
      <PlaybackProvider>
        <section aria-labelledby="call-recording-title" className="sticky top-0 z-10">
          <Frame variant="inverse">
            <FrameHeader>
              <FrameTitle><h2 id="call-recording-title">Recording</h2></FrameTitle>
            </FrameHeader>
            <FramePanel>
              {call.recording.state === "Ready" ? <DossierPlayer recording={call.recording} mediaPath={mediaPath} autoPlay={autoPlay} turns={call.transcript.turns} /> : <RecordingState recording={call.recording} />}
            </FramePanel>
          </Frame>
        </section>
        <Frame>
          <FrameHeader>
            <div role="tablist" aria-label="Call details" className="flex flex-wrap gap-1">
              {dossierTabs.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.key}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    tab === item.key ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setTab(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </FrameHeader>
          <FramePanel>
            <div role="tabpanel" hidden={tab !== "transcript"}>
              <TranscriptBody transcript={analysis.transcript} operator={operator} retry={analysis.retry} emphasis={analysis.emphasis} listClassName="max-h-[60vh]" />
            </div>
            <div role="tabpanel" hidden={tab !== "assessment"}>
              <AssessmentBody
                assessment={analysis.assessment}
                operator={operator}
                retry={analysis.retry}
                timeZone={call.workspace.reportingTimezone}
                reviewed={call.leadReview !== null}
                contentRemoval={analysis.contentRemoval}
                onEvidence={(item) => {
                  analysis.selectEvidence(item);
                  setTab("transcript");
                }}
              />
            </div>
            <div role="tabpanel" hidden={tab !== "facts"} className="flex flex-col gap-4">
              <CallFacts call={call} className="md:grid-cols-3" />
              <p className="text-xs text-muted-foreground">Times are shown in {call.workspace.reportingTimezone}.</p>
            </div>
            <div role="tabpanel" hidden={tab !== "timeline"}>
              <ProcessingTimelineBody call={call} />
            </div>
          </FramePanel>
        </Frame>
      </PlaybackProvider>
    </div>
  );
}
