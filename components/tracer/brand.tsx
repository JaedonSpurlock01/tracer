/**
 * -------------------------------------------------------------------------
 * @file   brand.tsx
 * -------------------------------------------------------------------------
 * @brief  Renders the Tracer gradient orb and wordmark lockup.
 *
 * @description
 *  BrandMark draws the orb at a given size. BrandLockup pairs it with the
 *  Tracer wordmark for authentication screens.
 *
 * @remarks
 *  The orb is a radial highlight from zinc-50 through zinc-400 to zinc-700,
 *  so it stays neutral on the zinc palette. It is decorative beside its
 *  wordmark or the account name and is hidden from assistive technology.
 *  The favicon in app/icon.svg draws the same gradient.
 *
 * @see
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cn } from "cn";

interface BrandMarkProps {
  size?: number;
  className?: string;
}

export function BrandMark({ size = 24, className }: BrandMarkProps) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn(
        "inline-block shrink-0 rounded-full bg-[radial-gradient(circle_at_30%_30%,var(--color-zinc-50),var(--color-zinc-400)_45%,var(--color-zinc-700))]",
        className,
      )}
    />
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
