"use client";

/**
 * -------------------------------------------------------------------------
 * @file   mirror-waveform.tsx
 * @brief  Draws a Recording as one mirrored Caller-over-Business lane.
 *
 * @description
 *  Buckets the Recording engine's peaks to one bar per few pixels of the
 *  available width and draws them as SVG: Caller bars rise above the
 *  center line in the first chart color and Business bars fall below it in
 *  the second, the way a two-party call reads at a glance. Played bars are
 *  full strength, a playhead marks the position, and a click or drag
 *  anywhere on the lane seeks. The lane labels in the left gutter carry
 *  each party's share of the spoken time when a Transcript exists. A Mixed
 *  audio Recording mirrors its one lane on both halves.
 *
 * @remarks
 *  The SVG is sized from a ResizeObserver so it redraws on resize without
 *  a second media element or a waveform library. While peaks load it shows
 *  a Skeleton of the same height; when peaks are unavailable it renders
 *  nothing, so the player's seek control remains the way through the
 *  audio. The lane is a focusable group so the player's keyboard
 *  shortcuts reach it, and it never owns playback state.
 *
 * @see
 *  components/tracer/recording-engine.ts
 *  components/tracer/recording-player.tsx
 *  data/transcript.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import type { RecordingEngine } from "@/components/tracer/recording-engine";
import { speakerShares, type TranscriptTurn } from "@/data/transcript";

const barWidth = 2;
const barGap = 1;
export const mirrorWaveformHeight = 56;
export const mirrorWaveformGutter = "w-20";

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

export default function MirrorWaveform({ engine, turns }: { engine: RecordingEngine; turns?: TranscriptTurn[] }) {
  const { peaksData, peaks, currentTime, duration, seek } = engine;
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const dragging = useRef(false);
  const shares = useMemo(() => (turns?.length ? speakerShares(turns) : null), [turns]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [peaks]); // the lane mounts only once peaks are ready

  const bars = Math.max(1, Math.floor(width / (barWidth + barGap)));
  const halves = useMemo(() => {
    if (!peaksData) return null;
    const mixed = peaksData.lanes.length === 1;
    const [top, bottom] = mixed ? [peaksData.peaks[0], peaksData.peaks[0]] : peaksData.peaks;
    return { top: bucketMax(top, bars), bottom: bucketMax(bottom, bars), labels: mixed ? (["Mixed audio", "Mixed audio"] as const) : (["Caller", "Business"] as const) };
  }, [peaksData, bars]);

  function seekFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    seek(ratio * duration);
  }

  if (peaks === "loading") return <Skeleton className="w-full" style={{ height: mirrorWaveformHeight }} />;
  if (!halves) return null;
  const height = mirrorWaveformHeight;
  const progress = duration ? Math.min(currentTime / duration, 1) : 0;
  const playedBars = Math.round(progress * bars);
  const mid = height / 2;
  const half = mid - 1;
  const label = (index: 0 | 1) => {
    const name = halves.labels[index];
    const share = shares && name !== "Mixed audio" ? ` (${shares[name]}%)` : "";
    return `${name}${share}`;
  };
  return (
    <div className="flex items-stretch gap-3" style={{ height }}>
      <div className={`flex ${mirrorWaveformGutter} shrink-0 flex-col justify-between text-right text-[0.65rem] leading-none font-medium tabular-nums`}>
        <span style={{ color: "var(--chart-1)" }}>{label(0)}</span>
        <span style={{ color: "var(--chart-2)" }}>{label(1)}</span>
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
          event.currentTarget.setPointerCapture?.(event.pointerId);
          seekFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current) seekFromPointer(event);
        }}
        onPointerUp={(event) => {
          dragging.current = false;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
      >
        <svg width={width} height={height} className="block" aria-hidden>
          <line x1={0} x2={width} y1={mid} y2={mid} className="stroke-border" strokeWidth={1} />
          {halves.top.map((value, index) => {
            const x = index * (barWidth + barGap);
            const up = Math.max(1, value * half);
            const down = Math.max(1, halves.bottom[index] * half);
            return (
              <g key={index} opacity={index < playedBars ? 1 : 0.4}>
                <rect x={x} y={mid - up} width={barWidth} height={up} rx={1} fill="var(--chart-1)" />
                <rect x={x} y={mid + 1} width={barWidth} height={down} rx={1} fill="var(--chart-2)" />
              </g>
            );
          })}
          <line x1={progress * width} x2={progress * width} y1={0} y2={height} className="stroke-primary" strokeWidth={2} />
        </svg>
      </div>
      <div className={`${mirrorWaveformGutter} shrink-0`} aria-hidden />
    </div>
  );
}
