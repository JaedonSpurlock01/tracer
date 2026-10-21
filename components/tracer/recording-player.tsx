"use client";

/**
 * -------------------------------------------------------------------------
 * @file   recording-player.tsx
 * @brief  Plays a Call's Recording over an interactive waveform.
 *
 * @description
 *  Renders the Recording engine as a player: aligned Caller and Business
 *  waveform lanes, or one Mixed audio lane, with play and pause, click and
 *  keyboard seek, an accessible seek slider, elapsed and total time, zoom,
 *  playback speed, volume, and mute. Shows the processing, failed,
 *  unavailable, purged, and expired Recording states instead of the
 *  player. RecordingWaveform and RecordingState are exported so another
 *  player chrome can reuse the lanes and the non-ready states.
 *
 * @remarks
 *  The media element, waveform, playback state, and shortcuts live in
 *  useRecordingEngine; this file is only chrome, so a different control
 *  layout changes nothing about playback. The engine connects to an
 *  enclosing PlaybackProvider so the Transcript can follow and seek.
 *
 * @see
 *  components/tracer/recording-engine.ts
 *  components/tracer/playback.tsx
 *  data/call-details.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PauseIcon, PlayIcon, Volume2Icon, VolumeXIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { formatClock } from "@/components/tracer/call-format";
import { laneHeight, longSeekStepSeconds, playbackRates, recordingMediaPath, useRecordingEngine, zoomLevels, type ReadyRecording, type RecordingEngine } from "@/components/tracer/recording-engine";
import type { RecordingAvailability } from "@/data/call-details";

const laneLabels = { Caller: "Caller", Business: "Business", Mixed: "Mixed audio" } as const;
const fallbackMessage = "Waveform unavailable. Use the seek control or keyboard shortcuts to move through the audio.";

export function sliderNumber(value: number | readonly number[]): number {
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
      <div className="flex items-center gap-2">
        <Skeleton className="size-8 rounded-full" />
        <Skeleton className="h-2 flex-1" />
        <Skeleton className="h-4 w-20" />
      </div>
      <Skeleton className="h-28 w-full" />
    </div>
  );
}

/** The non-ready Recording states, shared by every player chrome. */
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

/** The waveform lanes with their loading, fallback, and retry states. */
export function RecordingWaveform({ engine, laneCount }: { engine: RecordingEngine; laneCount: number }) {
  const { peaks, waveformReady, lanes, waveformRef, retryPeaks } = engine;
  return (
    <div role="group" aria-label="Waveform" tabIndex={0} className="flex flex-col gap-1 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      {peaks === "loading" ? (
        <Skeleton className="w-full" style={{ height: laneHeight * laneCount + 20 }} />
      ) : waveformReady ? (
        <div className="flex gap-2">
          <div className="flex shrink-0 flex-col">
            {lanes.map((lane) => (
              <span key={lane} className="flex items-center text-xs font-medium text-muted-foreground" style={{ height: laneHeight }}>
                {laneLabels[lane]}
              </span>
            ))}
          </div>
          <div ref={waveformRef} className="min-w-0 flex-1" />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground">{fallbackMessage}</p>
          {peaks === "error" ? (
            <Button type="button" variant="outline" size="sm" onClick={retryPeaks}>
              Retry
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ReadyPlayer({ workspaceId, recording, autoPlay }: { workspaceId: string; recording: ReadyRecording; autoPlay: boolean }) {
  const engine = useRecordingEngine({ mediaPath: recordingMediaPath(workspaceId, recording.id), recording, autoPlay });
  const seekLabelId = useId();
  const volumeLabelId = useId();
  const { currentTime, duration, playing, muted, volume, rate, zoomIndex, waveformReady } = engine;

  return (
    <div className="flex flex-col gap-3" onKeyDown={engine.handleShortcut}>
      <audio {...engine.audioProps} />
      <RecordingWaveform engine={engine} laneCount={recording.lanes.length} />
      <div className="flex flex-col gap-1">
        <span id={seekLabelId} className="sr-only">Seek</span>
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
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="icon-sm" aria-label={playing ? "Pause" : "Play"} onClick={engine.togglePlay}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">{formatClock(currentTime)} / {formatClock(duration)}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="icon-sm" aria-label="Zoom out" disabled={!waveformReady || zoomIndex === 0} onClick={() => engine.zoomBy(-1)}>
            <ZoomOutIcon />
          </Button>
          <Button type="button" variant="outline" size="icon-sm" aria-label="Zoom in" disabled={!waveformReady || zoomIndex === zoomLevels.length - 1} onClick={() => engine.zoomBy(1)}>
            <ZoomInIcon />
          </Button>
          <Select value={rate} onValueChange={engine.changeRate}>
            <SelectTrigger size="sm" aria-label="Playback speed">
              <SelectValue>{(value: string) => `${value}x`}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {playbackRates.map((value) => (
                <SelectItem key={value} value={value}>{`${value}x`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="icon-sm" aria-label={muted ? "Unmute" : "Mute"} onClick={engine.toggleMute}>
            {muted ? <VolumeXIcon /> : <Volume2Icon />}
          </Button>
          <span id={volumeLabelId} className="sr-only">Volume</span>
          <Slider
            className="w-24"
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
      {engine.audioError ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm">Recording audio could not be loaded.</p>
          <Button type="button" variant="outline" size="sm" onClick={engine.retryAudio}>
            Retry
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">Shortcuts: Space or K play and pause, arrows move 5 seconds, J and L move 10 seconds, M mutes, plus and minus zoom.</p>
    </div>
  );
}

export default function RecordingPlayer({ workspaceId, recording, autoPlay = false }: { workspaceId: string; recording: RecordingAvailability; autoPlay?: boolean }) {
  if (recording.state === "Ready") return <ReadyPlayer workspaceId={workspaceId} recording={recording} autoPlay={autoPlay} />;
  return <RecordingState recording={recording} />;
}
