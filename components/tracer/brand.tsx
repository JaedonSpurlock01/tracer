/**
 * -------------------------------------------------------------------------
 * @file   brand.tsx
 * @brief  Renders the Tracer Waveform mark and the Tracer wordmark lockup.
 *
 * @description
 *  BrandMark draws the Waveform mark, a T made of five call audio bars, at
 *  a given size. BrandLockup pairs it with the Tracer wordmark for
 *  authentication screens.
 *
 * @remarks
 *  The mark is drawn inline and filled with currentColor, so one drawing
 *  reads correctly on every theme and needs no image request. The bars use
 *  the geometry of docs/brand/tracer-symbol.svg. It is decorative beside
 *  its wordmark or the account name and is hidden from assistive
 *  technology. The favicon in app/icon.png is the three-bar cut of the same
 *  mark in white on the zinc-950 ground.
 *
 * @see
 *  DESIGN.md
 *  docs/brand/README.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cn } from "cn";

interface BrandMarkProps {
  size?: number;
  className?: string;
}

const bars = [
  { x: 24, height: 52 },
  { x: 68, height: 76 },
  { x: 112, height: 184 },
  { x: 156, height: 76 },
  { x: 200, height: 52 },
];

export function BrandMark({ size = 24, className }: BrandMarkProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 256 256" width={size} height={size} fill="currentColor" className={cn("inline-block shrink-0", className)}>
      {bars.map((bar) => (
        <rect key={bar.x} x={bar.x} y={36} width={32} height={bar.height} rx={6} />
      ))}
    </svg>
  );
}

export function BrandLockup({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <BrandMark size={28} />
      <span className="font-semibold tracking-tight">Tracer</span>
    </div>
  );
}
