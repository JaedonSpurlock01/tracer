"use client";

/**
 * -------------------------------------------------------------------------
 * @file   recording-player.tsx
 * @brief  Plays a Call's Recording over an interactive waveform.
 *
 * @description
 *  Streams the Recording through the Workspace-authorized audio route in a
 *  media element and draws its precomputed peaks with wavesurfer.js as
 *  aligned Caller and Business lanes, or one Mixed audio lane. Offers play
 *  and pause, click and keyboard seek, an accessible seek slider, elapsed
 *  and total time, zoom, playback speed, volume, and mute. Shows the
 *  processing, failed, unavailable, purged, and expired Recording states
 *  instead of the player.
 *
 * @remarks
 *  One wavesurfer instance renders both channels with splitChannels, so the
 *  lanes share one media element, playhead, time scale, scroll, and zoom by
 *  construction instead of syncing two players. React owns the media element
 *  and every control, so playback still works when peaks are missing.
 *  Shortcuts listen only inside the player and ignore text fields, sliders,
 *  and select menus, so they never hijack typing. Reduced motion turns off
 *  playhead auto-centering. The ready player connects its position and
 *  seek to an enclosing PlaybackProvider, so the Transcript can follow and
 *  seek playback without owning the media element. Auto play starts
 *  playback once on open for the Calls Play Recording action; a browser
 *  that blocks it leaves the player paused.
 *
 * @see
 *  data/call-details.ts
 *  data/recording-media.ts
 *  components/tracer/playback.tsx
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PauseIcon, PlayIcon, Volume2Icon, VolumeXIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { formatClock } from "@/components/tracer/call-format";
import { useConnectPlayback } from "@/components/tracer/playback";
import type { RecordingAvailability } from "@/data/call-details";
import type { WaveformPeaks } from "@/data/recording-waveform";

type ReadyRecording = Extract<RecordingAvailability, { state: "Ready" }>;
type PeaksState = { status: "loading" } | { status: "ready"; peaks: WaveformPeaks } | { status: "unavailable" } | { status: "error" };

const zoomLevels = [0, 25, 50, 100, 200];
const playbackRates = ["0.75", "1", "1.25", "1.5", "2"];
const seekStepSeconds = 5;
const longSeekStepSeconds = 10;
const laneHeight = 56;
const laneLabels = { Caller: "Caller", Business: "Business", Mixed: "Mixed audio" } as const;
const shortcutExemptTargets = "input, textarea, select, [contenteditable='true'], [role='slider'], [role='combobox'], [role='listbox'], [role='option']";
const fallbackMessage = "Waveform unavailable. Use the seek control or keyboard shortcuts to move through the audio.";

function sliderNumber(value: number | readonly number[]): number {
  return typeof value === "number" ? value : value[0];
}

function isWaveformPeaks(value: unknown): value is WaveformPeaks {
  const peaks = value as WaveformPeaks | null;
  return Boolean(peaks) && Array.isArray(peaks?.lanes) && Array.isArray(peaks?.peaks) && peaks.lanes.length === peaks.peaks.length && typeof peaks.durationSeconds === "number";
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

function ReadyPlayer({ workspaceId, recording, autoPlay }: { workspaceId: string; recording: ReadyRecording; autoPlay: boolean }) {
  const mediaPath = `/api/workspaces/${workspaceId}/recordings/${recording.id}`;
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<{ zoom(minPxPerSec: number): void; destroy(): void } | null>(null);
  const [peaks, setPeaks] = useState<PeaksState>(recording.waveform ? { status: "loading" } : { status: "unavailable" });
  const [peaksAttempt, setPeaksAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [rate, setRate] = useState("1");
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [audioError, setAudioError] = useState(false);
  const seekLabelId = useId();
  const volumeLabelId = useId();

  const duration = peaks.status === "ready" ? peaks.peaks.durationSeconds : (recording.durationSeconds ?? mediaDuration ?? 0);
  const lanes = peaks.status === "ready" ? peaks.peaks.lanes : recording.lanes;
  const waveformReady = peaks.status === "ready";

  useEffect(() => {
    if (!recording.waveform) return;
    const controller = new AbortController();
    fetch(`${mediaPath}/peaks`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body: unknown = response.ok ? await response.json() : null;
        if (!isWaveformPeaks(body)) throw new Error("Waveform peaks unavailable");
        setPeaks({ status: "ready", peaks: body });
      })
      .catch(() => {
        if (!controller.signal.aborted) setPeaks({ status: "error" });
      });
    return () => controller.abort();
  }, [mediaPath, recording.waveform, peaksAttempt]);

  useEffect(() => {
    const container = waveformRef.current;
    const media = audioRef.current;
    if (peaks.status !== "ready" || !container || !media) return;
    let disposed = false;
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
    const waveColor = token("--muted-foreground", "#9db4c0");
    const progressColor = token("--foreground", "#e0fbfc");
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const split = peaks.peaks.lanes.length > 1;
    void Promise.all([import("wavesurfer.js"), import("wavesurfer.js/plugins/timeline")]).then(([{ default: WaveSurfer }, { default: TimelinePlugin }]) => {
      if (disposed) return;
      wavesurferRef.current = WaveSurfer.create({
        container,
        media,
        peaks: peaks.peaks.peaks,
        duration: peaks.peaks.durationSeconds,
        height: laneHeight,
        waveColor,
        progressColor,
        cursorColor: token("--primary", "#c2dfe3"),
        cursorWidth: 2,
        barWidth: 2,
        barGap: 1,
        barRadius: 1,
        normalize: false,
        interact: true,
        dragToSeek: true,
        autoScroll: true,
        autoCenter: !reduceMotion,
        splitChannels: split ? peaks.peaks.lanes.map(() => ({ height: laneHeight, waveColor, progressColor })) : undefined,
        plugins: [TimelinePlugin.create({ height: 20, style: { fontSize: "12px", color: waveColor } })],
      });
    });
    return () => {
      disposed = true;
      wavesurferRef.current?.destroy();
      wavesurferRef.current = null;
    };
  }, [peaks]);

  useEffect(() => {
    wavesurferRef.current?.zoom(zoomLevels[zoomIndex]);
  }, [zoomIndex]);

  useEffect(() => {
    if (autoPlay) void audioRef.current?.play().catch(() => setPlaying(false));
  }, [autoPlay]);

  const seek = useCallback((seconds: number) => {
    const media = audioRef.current;
    if (!media) return;
    const next = Math.min(Math.max(seconds, 0), duration || seconds);
    media.currentTime = next;
    setCurrentTime(next);
  }, [duration]);

  useConnectPlayback({ currentTime, playing, seek });

  const togglePlay = useCallback(() => {
    const media = audioRef.current;
    if (!media) return;
    if (playing) media.pause();
    else void media.play().catch(() => setPlaying(false));
  }, [playing]);

  const toggleMute = useCallback(() => {
    const media = audioRef.current;
    if (media) media.muted = !media.muted;
  }, []);

  const zoomBy = useCallback((direction: 1 | -1) => {
    if (!waveformReady) return;
    setZoomIndex((index) => Math.min(Math.max(index + direction, 0), zoomLevels.length - 1));
  }, [waveformReady]);

  function changeRate(value: string | null) {
    const media = audioRef.current;
    if (!value || !media) return;
    media.playbackRate = Number(value);
    setRate(value);
  }

  function changeVolume(percent: number) {
    const media = audioRef.current;
    if (!media) return;
    media.volume = percent / 100;
    if (percent > 0 && media.muted) media.muted = false;
  }

  function retryAudio() {
    setAudioError(false);
    audioRef.current?.load();
  }

  function retryPeaks() {
    setPeaks({ status: "loading" });
    setPeaksAttempt((attempt) => attempt + 1);
  }

  function handleShortcut(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (event.altKey || event.ctrlKey || event.metaKey || target.closest(shortcutExemptTargets)) return;
    const onButton = Boolean(target.closest("button, a"));
    const actions: Record<string, () => void> = {
      k: togglePlay,
      K: togglePlay,
      ArrowLeft: () => seek(currentTime - seekStepSeconds),
      ArrowRight: () => seek(currentTime + seekStepSeconds),
      j: () => seek(currentTime - longSeekStepSeconds),
      J: () => seek(currentTime - longSeekStepSeconds),
      l: () => seek(currentTime + longSeekStepSeconds),
      L: () => seek(currentTime + longSeekStepSeconds),
      Home: () => seek(0),
      End: () => seek(duration),
      m: toggleMute,
      M: toggleMute,
      "+": () => zoomBy(1),
      "=": () => zoomBy(1),
      "-": () => zoomBy(-1),
    };
    if (!onButton) actions[" "] = togglePlay;
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  return (
    <div className="flex flex-col gap-3" onKeyDown={handleShortcut}>
      <audio
        ref={audioRef}
        src={`${mediaPath}/audio`}
        preload="metadata"
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setMediaDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null)}
        onRateChange={(event) => setRate(String(event.currentTarget.playbackRate))}
        onVolumeChange={(event) => {
          setVolume(event.currentTarget.volume);
          setMuted(event.currentTarget.muted);
        }}
        onError={() => {
          setAudioError(true);
          setPlaying(false);
        }}
      />
      <div role="group" aria-label="Waveform" tabIndex={0} className="flex flex-col gap-1 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        {peaks.status === "loading" ? (
          <Skeleton className="w-full" style={{ height: laneHeight * recording.lanes.length + 20 }} />
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
            {peaks.status === "error" ? (
              <Button type="button" variant="outline" size="sm" onClick={retryPeaks}>
                Retry
              </Button>
            ) : null}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span id={seekLabelId} className="sr-only">Seek</span>
        <Slider
          aria-labelledby={seekLabelId}
          value={[Math.min(currentTime, duration)]}
          min={0}
          max={Math.max(duration, 1)}
          step={1}
          largeStep={longSeekStepSeconds}
          onValueChange={(value) => seek(sliderNumber(value))}
          getAriaValueText={(_formatted, value) => `${formatClock(value)} of ${formatClock(duration)}`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="icon-sm" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">{formatClock(currentTime)} / {formatClock(duration)}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="icon-sm" aria-label="Zoom out" disabled={!waveformReady || zoomIndex === 0} onClick={() => zoomBy(-1)}>
            <ZoomOutIcon />
          </Button>
          <Button type="button" variant="outline" size="icon-sm" aria-label="Zoom in" disabled={!waveformReady || zoomIndex === zoomLevels.length - 1} onClick={() => zoomBy(1)}>
            <ZoomInIcon />
          </Button>
          <Select value={rate} onValueChange={changeRate}>
            <SelectTrigger size="sm" aria-label="Playback speed">
              <SelectValue>{(value: string) => `${value}x`}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {playbackRates.map((value) => (
                <SelectItem key={value} value={value}>{`${value}x`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="icon-sm" aria-label={muted ? "Unmute" : "Mute"} onClick={toggleMute}>
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
            onValueChange={(value) => changeVolume(sliderNumber(value))}
            getAriaValueText={(_formatted, value) => `${Math.round(value)}%`}
          />
        </div>
      </div>
      {audioError ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm">Recording audio could not be loaded.</p>
          <Button type="button" variant="outline" size="sm" onClick={retryAudio}>
            Retry
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">Shortcuts: Space or K play and pause, arrows move 5 seconds, J and L move 10 seconds, M mutes, plus and minus zoom.</p>
    </div>
  );
}

export default function RecordingPlayer({ workspaceId, recording, autoPlay = false }: { workspaceId: string; recording: RecordingAvailability; autoPlay?: boolean }) {
  switch (recording.state) {
    case "Ready":
      return <ReadyPlayer workspaceId={workspaceId} recording={recording} autoPlay={autoPlay} />;
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
