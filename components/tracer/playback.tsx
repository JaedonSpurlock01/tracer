"use client";

/**
 * -------------------------------------------------------------------------
 * @file   playback.tsx
 * @brief  Shares the Recording player's position and seek with Call Detail.
 *
 * @description
 *  PlaybackProvider wraps the Recording player and the regions that follow
 *  it. The ready player connects its current time, playing state, and seek
 *  function, and the Transcript and Lead Assessment read them through
 *  usePlayback to highlight the active turn and seek from a turn or an
 *  evidence snippet.
 *
 * @remarks
 *  The player stays the single owner of its media element; this context
 *  only mirrors what it reports. Outside a provider, or before the player
 *  is ready, usePlayback reports playback as unavailable and seek does
 *  nothing, so the player still works on its own.
 *
 * @see
 *  components/tracer/recording-player.tsx
 *  components/tracer/call-analysis.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export interface PlaybackSource {
  currentTime: number;
  playing: boolean;
  seek(seconds: number): void;
}

export interface Playback extends PlaybackSource {
  available: boolean;
}

const unavailable: Playback = { available: false, currentTime: 0, playing: false, seek: () => undefined };

const PlaybackContext = createContext<{ playback: Playback; connect(source: PlaybackSource | null): void } | null>(null);

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<PlaybackSource | null>(null);
  const value = useMemo(() => ({ playback: source ? { ...source, available: true } : unavailable, connect: setSource }), [source]);
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export function usePlayback(): Playback {
  return useContext(PlaybackContext)?.playback ?? unavailable;
}

export function useConnectPlayback({ currentTime, playing, seek }: PlaybackSource): void {
  const connect = useContext(PlaybackContext)?.connect;
  useEffect(() => {
    connect?.({ currentTime, playing, seek });
  }, [connect, currentTime, playing, seek]);
  useEffect(() => () => connect?.(null), [connect]);
}
