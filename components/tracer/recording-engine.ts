"use client";

/**
 * -------------------------------------------------------------------------
 * @file   recording-engine.ts
 * @brief  Owns a ready Recording's media element, peaks, and controls.
 *
 * @description
 *  useRecordingEngine streams the Recording through its media path in a
 *  media element, loads its precomputed peaks, and exposes every playback
 *  fact and action a player chrome needs: play and pause, seek and skip,
 *  elapsed and total time, playback speed, volume, mute, audio and peaks
 *  retry, and the keyboard shortcut handler. The chrome renders the media
 *  element from `audioProps`, draws the peaks however it likes, and lays
 *  the controls out as it sees fit.
 *
 * @remarks
 *  React owns the media element and every control, so playback still works
 *  when peaks are missing. Shortcuts ignore text fields, sliders, and select
 *  menus, so they never hijack typing. The engine connects its position and
 *  seek to an enclosing PlaybackProvider, so the Transcript can follow and
 *  seek playback without owning the media element. Auto play starts
 *  playback once on open for the Calls Play Recording action; a browser
 *  that blocks it leaves the player paused.
 *
 * @see
 *  components/tracer/recording-player.tsx
 *  components/tracer/mirror-waveform.tsx
 *  components/tracer/playback.tsx
 *  data/recording-waveform.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { useCallback, useEffect, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";

import { useConnectPlayback } from "@/components/tracer/playback";
import type { RecordingAvailability } from "@/data/call-details";
import type { WaveformPeaks } from "@/data/recording-waveform";

export type ReadyRecording = Extract<RecordingAvailability, { state: "Ready" }>;
export type PeaksStatus = "loading" | "ready" | "unavailable" | "error";
type PeaksState = { status: "loading" } | { status: "ready"; peaks: WaveformPeaks } | { status: "unavailable" } | { status: "error" };

export const playbackRates = ["0.75", "1", "1.25", "1.5", "2"];
export const seekStepSeconds = 5;
export const longSeekStepSeconds = 10;
const shortcutExemptTargets = "input, textarea, select, [contenteditable='true'], [role='slider'], [role='combobox'], [role='listbox'], [role='option']";

export interface RecordingEngine {
  /** Spread onto the one `<audio>` element the chrome renders. */
  audioProps: ComponentProps<"audio">;
  peaks: PeaksStatus;
  /** The loaded peaks, for the chrome to draw. */
  peaksData: WaveformPeaks | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  rate: string;
  volume: number;
  muted: boolean;
  audioError: boolean;
  togglePlay(): void;
  seek(seconds: number): void;
  skip(seconds: number): void;
  changeRate(value: string | null): void;
  changeVolume(percent: number): void;
  toggleMute(): void;
  retryAudio(): void;
  retryPeaks(): void;
  handleShortcut(event: KeyboardEvent<HTMLElement>): void;
}

function isWaveformPeaks(value: unknown): value is WaveformPeaks {
  const peaks = value as WaveformPeaks | null;
  return Boolean(peaks) && Array.isArray(peaks?.lanes) && Array.isArray(peaks?.peaks) && peaks.lanes.length === peaks.peaks.length && typeof peaks.durationSeconds === "number";
}

export function recordingMediaPath(workspaceId: string, recordingId: string): string {
  return `/api/workspaces/${workspaceId}/recordings/${recordingId}`;
}

export function useRecordingEngine({ mediaPath, recording, autoPlay = false }: { mediaPath: string; recording: ReadyRecording; autoPlay?: boolean }): RecordingEngine {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [peaks, setPeaks] = useState<PeaksState>(recording.waveform ? { status: "loading" } : { status: "unavailable" });
  const [peaksAttempt, setPeaksAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [rate, setRate] = useState("1");
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [audioError, setAudioError] = useState(false);

  const duration = peaks.status === "ready" ? peaks.peaks.durationSeconds : (recording.durationSeconds ?? mediaDuration ?? 0);

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
    if (autoPlay) void audioRef.current?.play().catch(() => setPlaying(false));
  }, [autoPlay]);

  const seek = useCallback(
    (seconds: number) => {
      const media = audioRef.current;
      if (!media) return;
      const next = Math.min(Math.max(seconds, 0), duration || seconds);
      media.currentTime = next;
      setCurrentTime(next);
    },
    [duration],
  );

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

  const skip = useCallback((seconds: number) => seek(currentTime + seconds), [seek, currentTime]);

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

  function handleShortcut(event: KeyboardEvent<HTMLElement>) {
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
    };
    if (!onButton) actions[" "] = togglePlay;
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  const audioProps: ComponentProps<"audio"> = {
    ref: audioRef,
    src: `${mediaPath}/audio`,
    preload: "metadata",
    className: "hidden",
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onTimeUpdate: (event) => setCurrentTime(event.currentTarget.currentTime),
    onLoadedMetadata: (event) => setMediaDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : null),
    onRateChange: (event) => setRate(String(event.currentTarget.playbackRate)),
    onVolumeChange: (event) => {
      setVolume(event.currentTarget.volume);
      setMuted(event.currentTarget.muted);
    },
    onError: () => {
      setAudioError(true);
      setPlaying(false);
    },
  };

  return {
    audioProps,
    peaks: peaks.status,
    peaksData: peaks.status === "ready" ? peaks.peaks : null,
    playing,
    currentTime,
    duration,
    rate,
    volume,
    muted,
    audioError,
    togglePlay,
    seek,
    skip,
    changeRate,
    changeVolume,
    toggleMute,
    retryAudio,
    retryPeaks,
    handleShortcut,
  };
}
