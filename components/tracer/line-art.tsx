/**
 * -------------------------------------------------------------------------
 * @file   line-art.tsx
 * @brief  Provides the line-art illustrations used by Empty states.
 *
 * @description
 *  Vector scenes drawn in one stroke weight. Most sit on a shared isometric
 *  orbit field: a tracking line waiting for its first event (Activity), a
 *  report page with empty bars (Reports), an empty Workspace slot, and a
 *  search that found nothing. Calls is an empty call log card, and
 *  Transcript is a recording strip at 0:00 with nothing on it.
 *
 * @remarks
 *  Every stroke uses currentColor, so the parent's text color sets the
 *  ink; the default is a dimmed muted foreground. Strokes stay 1px at any
 *  rendered size. The scenes are decorative and hidden from assistive
 *  technology.
 *
 * @see
 *  components/tracer/empty-state.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { ComponentProps } from "react";

import { cn } from "cn";

type LineArtProps = ComponentProps<"svg">;

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  vectorEffect: "non-scaling-stroke",
} as const;

/**
 * Fallback switch. The animations live in globals.css under `.line-art-motion`
 * and only ever move elements the static drawing already contains, so
 * setting this to false restores every scene exactly as drawn. Reduced-motion
 * viewers always get the static scene.
 */
const lineArtMotion = true;

function Scene({ className, children, ...props }: LineArtProps) {
  return (
    <svg
      viewBox="0 0 200 120"
      aria-hidden="true"
      focusable="false"
      className={cn("h-28 w-auto text-muted-foreground/70", lineArtMotion && "line-art-motion", className)}
      {...props}
    >
      <g {...stroke}>{children}</g>
    </svg>
  );
}

/** Three dashed isometric orbits around a center point. */
function Orbits({ cx = 100, cy = 70 }: { cx?: number; cy?: number }) {
  return (
    <>
      <ellipse cx={cx} cy={cy} rx={84} ry={34} strokeDasharray="2 4" />
      <ellipse cx={cx} cy={cy} rx={58} ry={23} strokeDasharray="2 4" />
      <ellipse cx={cx} cy={cy} rx={32} ry={13} strokeDasharray="2 4" />
    </>
  );
}

/** A tracking line listening across its orbits, sweep still clear. */
export function NoActivityArt(props: LineArtProps) {
  return (
    <Scene {...props}>
      <Orbits />
      {/* Ping: the outer orbit, expanding from the center once per sweep. */}
      <ellipse className="line-art-ping" cx={100} cy={70} rx={84} ry={34} />
      {/* Sweep: wedge and line rotate together, staying on the orbit plane. */}
      <g className="line-art-radar">
        {/* The tip sits on the outer orbit at 30 degrees: (100 + 84cos30, 70 - 34sin30). */}
        <path d="M100 70 L172.7 53 A84 34 0 0 1 184 70 Z" fill="currentColor" fillOpacity={0.06} stroke="none" />
        <line x1={100} y1={70} x2={172.7} y2={53} />
      </g>
      <circle cx={158} cy={50} r={1.5} fill="currentColor" stroke="none" />
      <circle cx={132} cy={62} r={1.5} fill="currentColor" stroke="none" />
      {/* Tracking line: a solid cylinder on the orbit plane. The body is
          filled with the panel color so the orbits and sweep pass behind it. */}
      <path d="M92 46 V70 a8 3.2 0 0 0 16 0 V46 Z" fill="var(--color-card)" stroke="none" />
      <path d="M92 70 a8 3.2 0 0 0 16 0" />
      <line x1={92} y1={70} x2={92} y2={46} />
      <line x1={108} y1={70} x2={108} y2={46} />
      <ellipse cx={100} cy={46} rx={8} ry={3.2} fill="var(--color-card)" />
    </Scene>
  );
}

/** An empty call log: a card whose rows are still placeholders. */
export function NoCallsArt(props: LineArtProps) {
  return (
    <Scene {...props}>
      <rect x={44} y={14} width={112} height={92} rx={4} />
      <line x1={54} y1={26} x2={86} y2={26} />
      <line x1={44} y1={36} x2={156} y2={36} />
      {[50, 70, 90].map((y, index) => (
        <g key={y}>
          {/* Each row marker spins once in a while, staggered down the list. */}
          <circle className="line-art-spin" style={{ animationDelay: `${index * 2.6}s` }} cx={58} cy={y} r={5} strokeDasharray="2 2" />
          <line x1={70} y1={y} x2={[118, 108, 124][index]} y2={y} strokeDasharray="3 3" />
          <line x1={132} y1={y} x2={146} y2={y} strokeDasharray="3 3" />
        </g>
      ))}
    </Scene>
  );
}

/** A recording strip at 0:00 with nothing on it. */
export function NoTranscriptArt(props: LineArtProps) {
  return (
    <Scene {...props}>
      <line x1={16} y1={60} x2={184} y2={60} strokeDasharray="3 4" />
      <path d="M100 30 l-5 -8 h10 z" fill="currentColor" stroke="none" />
      <line x1={100} y1={30} x2={100} y2={88} strokeDasharray="2 3" />
      <line x1={16} y1={96} x2={184} y2={96} />
      {/* Time ruler: taller ticks at the start, midpoint, and end. */}
      {[16, 44, 72, 100, 128, 156, 184].map((x) => (
        <line key={x} x1={x} y1={96} x2={x} y2={x === 16 || x === 100 || x === 184 ? 90 : 92} />
      ))}
      <text x={16} y={110} fontFamily="var(--font-mono)" fontSize={7} fill="currentColor" stroke="none">
        0:00
      </text>
      <text x={170} y={110} fontFamily="var(--font-mono)" fontSize={7} fill="currentColor" stroke="none">
        0:00
      </text>
    </Scene>
  );
}

/** A report page on the orbit plane with its bars still outlined. */
export function NoReportsArt(props: LineArtProps) {
  return (
    <Scene {...props}>
      <Orbits cy={80} />
      <circle cx={44} cy={62} r={1.5} fill="currentColor" stroke="none" />
      <circle cx={160} cy={96} r={1.5} fill="currentColor" stroke="none" />
      {/* The page floats as one piece: fold, bars, trend, and title lines. */}
      <g className="line-art-float">
        {/* Page with a folded corner, masking the orbits behind it. */}
        <path d="M82 18 H108 L118 28 V70 H82 Z" fill="var(--color-card)" />
        <path d="M108 18 V28 H118" />
        {/* Bars rising from a baseline, outlined and empty. */}
        <line x1={88} y1={62} x2={112} y2={62} />
        <rect x={90} y={50} width={5} height={12} />
        <rect x={98} y={40} width={5} height={22} />
        <rect x={106} y={46} width={5} height={16} />
        {/* Trend across the bar tops. */}
        <path d="M92 48 L100 36 L108 42" strokeDasharray="2 3" />
        {/* Title lines. */}
        <line x1={88} y1={26} x2={100} y2={26} />
        <line x1={88} y1={31} x2={96} y2={31} strokeDasharray="2 2" />
      </g>
    </Scene>
  );
}

/** An empty Workspace slot waiting on the orbit plane. */
export function NoWorkspacesArt(props: LineArtProps) {
  return (
    <Scene {...props}>
      <Orbits cy={76} />
      {/* Isometric slot: a dashed open box. */}
      <path d="M72 70 L100 56 L128 70 L100 84 Z" strokeDasharray="3 3" />
      <path d="M72 70 L72 50 L100 36 L128 50 L128 70" />
      <path d="M100 56 L100 36" />
      <path d="M72 50 L100 64 L128 50" />
      <path d="M100 64 L100 84" strokeDasharray="3 3" />
      {/* Plus above the open slot. */}
      <line x1={100} y1={18} x2={100} y2={28} />
      <line x1={95} y1={23} x2={105} y2={23} />
      <circle cx={40} cy={58} r={1.5} fill="currentColor" stroke="none" />
      <circle cx={166} cy={92} r={1.5} fill="currentColor" stroke="none" />
    </Scene>
  );
}

/** A lens over the orbit field with nothing inside it. */
export function NoResultsArt(props: LineArtProps) {
  return (
    <Scene {...props}>
      <Orbits cy={78} />
      <circle cx={46} cy={88} r={1.5} fill="currentColor" stroke="none" />
      <circle cx={150} cy={96} r={1.5} fill="currentColor" stroke="none" />
      <circle cx={168} cy={62} r={1.5} fill="currentColor" stroke="none" />
      <circle cx={60} cy={54} r={1.5} fill="currentColor" stroke="none" />
      {/* Lens: clear inside, orbit lines masked by the fill. */}
      <circle cx={100} cy={56} r={22} fill="var(--color-card)" />
      <circle cx={100} cy={56} r={22} />
      <path d="M86 46 a16 16 0 0 1 10 -6" />
      <line x1={116} y1={72} x2={134} y2={92} strokeWidth={3} />
      <line x1={94} y1={50} x2={106} y2={62} strokeDasharray="2 3" />
      <line x1={106} y1={50} x2={94} y2={62} strokeDasharray="2 3" />
    </Scene>
  );
}
