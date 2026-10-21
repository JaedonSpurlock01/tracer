"use client";

/**
 * -------------------------------------------------------------------------
 * @file   recording-player.tsx
 * @brief  Plays a Call's Recording as a now-playing bar.
 *
 * @description
 *  Renders the Recording engine as the Call Detail now-playing bar: the
 *  mirrored Caller-over-Business waveform, a seek control with elapsed and
 *  total time at its ends, and a centered transport of back ten seconds,
 *  play or pause, and forward ten seconds, with who is speaking on the
 *  left and playback speed, mute, and volume on the right. Shows the
 *  processing, failed, unavailable, purged, and expired Recording states
 *  instead of the player.
 *
 * @remarks
 *  The media element, peaks, playback state, and shortcuts live in
 *  useRecordingEngine; this file is only chrome. The seek control is the
 *  accessible way through the audio, so the waveform never has to load for
 *  playback to work. The engine connects to an enclosing PlaybackProvider
 *  so the Transcript can follow and seek. Who is speaking comes from the
 *  Transcript turns when there are any.
 *
 * @see
 *  components/tracer/recording-engine.ts
 *  components/tracer/mirror-waveform.tsx
 *  components/tracer/playback.tsx
 *  data/call-details.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cn } from "cn";
import { AudioLinesIcon, PauseIcon, PlayIcon, RotateCcwIcon, RotateCwIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { formatClock } from "@/components/tracer/call-format";
import MirrorWaveform, { mirrorWaveformGutter } from "@/components/tracer/mirror-waveform";
import { longSeekStepSeconds, playbackRates, recordingMediaPath, useRecordingEngine, type ReadyRecording } from "@/components/tracer/recording-engine";
import type { RecordingAvailability } from "@/data/call-details";
import { speakerAt, type TranscriptTurn } from "@/data/transcript";

function sliderNumber(value: number | readonly number[]): number {
  return typeof value === "number" ? value : value[0];
}

function RecordingNotice({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function ProcessingPlayer({ stage }: { stage: "transfer" | "waveform" }) {
  return (
    <div className="flex flex-col gap-3">
      <div role="status" className="flex flex-col gap-0.5">
        <p className="text-sm font-medium">Recording processing</p>
        <p className="text-sm text-muted-foreground">{stage === "transfer" ? "The Recording is being stored." : "The waveform is being generated."}</p>
      </div>
      <Skeleton className="h-14 w-full" />
      <div className="flex items-center justify-center gap-2">
        <Skeleton className="size-9 rounded-full" />
        <Skeleton className="size-12 rounded-full" />
        <Skeleton className="size-9 rounded-full" />
      </div>
    </div>
  );
}

/** The non-ready Recording states. */
export function RecordingState({ recording }: { recording: Exclude<RecordingAvailability, ReadyRecording> }) {
  switch (recording.state) {
    case "Processing":
      return <ProcessingPlayer stage={recording.stage} />;
    case "Failed":
      return <RecordingNotice title="Recording unavailable" detail="The Recording could not be stored." />;
    case "Unavailable":
      return <RecordingNotice title="Recording unavailable" detail={recording.reason === "disabled" ? "Recording was disabled for this Call." : "No Recording was captured for this Call."} />;
    case "Purged":
      return <RecordingNotice title="Recording purged" detail="An Operator purged this Recording's audio and waveform." />;
    case "Expired":
      return <RecordingNotice title="Recording expired" detail="Recording media is removed 12 months after the Call." />;
  }
}

function SkipButton({ direction, onClick }: { direction: -1 | 1; onClick(): void }) {
  const Icon = direction < 0 ? RotateCcwIcon : RotateCwIcon;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      aria-label={direction < 0 ? `Back ${longSeekStepSeconds} seconds` : `Forward ${longSeekStepSeconds} seconds`}
      onClick={onClick}
      className="relative [&_svg:not([class*='size-'])]:size-6"
    >
      <Icon strokeWidth={1.75} />
      <span aria-hidden className="absolute inset-0 flex items-center justify-center pt-0.5 text-[0.5rem] leading-none font-semibold tabular-nums">
        {longSeekStepSeconds}
      </span>
    </Button>
  );
}

function ReadyPlayer({ workspaceId, recording, autoPlay, turns }: { workspaceId: string; recording: ReadyRecording; autoPlay: boolean; turns?: TranscriptTurn[] }) {
  const engine = useRecordingEngine({ mediaPath: recordingMediaPath(workspaceId, recording.id), recording, autoPlay });
  const seekLabelId = useId();
  const volumeLabelId = useId();
  const { currentTime, duration, playing, muted, volume, rate } = engine;
  const speaker = turns ? speakerAt(turns, currentTime * 1000) : null;
  const status = !playing ? "Paused" : speaker ? `${speaker} speaking` : "Silence";

  return (
    <div className="flex flex-col gap-2" onKeyDown={engine.handleShortcut}>
      <audio {...engine.audioProps} />
      <MirrorWaveform engine={engine} turns={turns} />
      <div className="flex items-center gap-3">
        <span className={cn("shrink-0 text-right text-xs tabular-nums text-muted-foreground", mirrorWaveformGutter)}>{formatClock(currentTime)}</span>
        <span id={seekLabelId} className="sr-only">Seek</span>
        <div className="min-w-0 flex-1">
          <Slider
            aria-labelledby={seekLabelId}
            value={[Math.min(currentTime, duration)]}
            min={0}
            max={Math.max(duration, 1)}
            step={1}
            largeStep={longSeekStepSeconds}
            onValueChange={(value) => engine.seek(sliderNumber(value))}
            getAriaValueText={(_formatted, value) => `${formatClock(value)} of ${formatClock(duration)}`}
          />
        </div>
        <span className={cn("shrink-0 text-xs tabular-nums text-muted-foreground", mirrorWaveformGutter)}>{formatClock(duration)}</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <AudioLinesIcon className={cn("size-4 shrink-0", playing ? "text-foreground" : "")} aria-hidden />
          <span role="status" className="truncate">{status}</span>
          <span className="hidden sm:inline">&middot; {recording.channels === 2 ? "Dual-channel" : "Mixed audio"}</span>
        </div>
        <div className="flex items-center justify-center gap-1">
          <SkipButton direction={-1} onClick={() => engine.skip(-longSeekStepSeconds)} />
          <Button type="button" size="icon-lg" aria-label={playing ? "Pause" : "Play"} onClick={engine.togglePlay} className="mx-1 size-10 rounded-full [&_svg:not([class*='size-'])]:size-4">
            {playing ? <PauseIcon className="fill-current" /> : <PlayIcon className="fill-current" />}
          </Button>
          <SkipButton direction={1} onClick={() => engine.skip(longSeekStepSeconds)} />
        </div>
        <div className="flex items-center justify-end gap-2">
          <Select value={rate} onValueChange={engine.changeRate}>
            <SelectTrigger size="sm" aria-label="Playback speed" className="w-20">
              <SelectValue>{(value: string) => `${value}x`}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {playbackRates.map((value) => (
                <SelectItem key={value} value={value}>{`${value}x`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={muted ? "Unmute" : "Mute"} onClick={engine.toggleMute}>
            {muted ? <VolumeXIcon /> : <Volume2Icon />}
          </Button>
          <span id={volumeLabelId} className="sr-only">Volume</span>
          <div className="hidden w-20 sm:block">
            <Slider
              aria-labelledby={volumeLabelId}
              value={[muted ? 0 : Math.round(volume * 100)]}
              min={0}
              max={100}
              step={10}
              onValueChange={(value) => engine.changeVolume(sliderNumber(value))}
              getAriaValueText={(_formatted, value) => `${Math.round(value)}%`}
            />
          </div>
        </div>
      </div>
      {engine.audioError ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <p role="alert" className="text-sm">Recording audio could not be loaded.</p>
          <Button type="button" variant="outline" size="sm" onClick={engine.retryAudio}>
            Retry
          </Button>
        </div>
      ) : null}
      {engine.peaks === "error" ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <p className="text-xs text-muted-foreground">Waveform unavailable. Use the seek control or keyboard shortcuts to move through the audio.</p>
          <Button type="button" variant="outline" size="xs" onClick={engine.retryPeaks}>
            Retry
          </Button>
        </div>
      ) : null}
      <p className="sr-only">Shortcuts: Space or K play and pause, arrows move 5 seconds, J and L move 10 seconds, M mutes.</p>
    </div>
  );
}

export default function RecordingPlayer({ workspaceId, recording, autoPlay = false, turns }: { workspaceId: string; recording: RecordingAvailability; autoPlay?: boolean; turns?: TranscriptTurn[] }) {
  if (recording.state === "Ready") return <ReadyPlayer workspaceId={workspaceId} recording={recording} autoPlay={autoPlay} turns={turns} />;
  return <RecordingState recording={recording} />;
}
