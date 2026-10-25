/**
 * -------------------------------------------------------------------------
 * @file   brand.tsx
 * @brief  Renders the Spurlock Labs ibex mark and the Tracer wordmark lockup.
 *
 * @description
 *  BrandMark draws the ibex shield at a given size. BrandLockup pairs it
 *  with the Tracer wordmark for authentication screens.
 *
 * @remarks
 *  The mark is a monochrome alpha mask (public/brand-mark.png) painted with
 *  currentColor through CSS masking, so one asset reads correctly on every
 *  theme: dark strokes on light surfaces, light strokes on dark ones, and
 *  the constellation lines keep their lighter weight through partial alpha.
 *  It is decorative beside its wordmark or the account name and is hidden
 *  from assistive technology. The favicon in app/icon.png is the same mark
 *  in white on the zinc-950 shield ground.
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

const maskStyle = {
  maskImage: "url(/brand-mark.png)",
  WebkitMaskImage: "url(/brand-mark.png)",
  maskSize: "contain",
  WebkitMaskSize: "contain",
  maskRepeat: "no-repeat",
  WebkitMaskRepeat: "no-repeat",
  maskPosition: "center",
  WebkitMaskPosition: "center",
} as const;

export function BrandMark({ size = 24, className }: BrandMarkProps) {
  return <span aria-hidden="true" style={{ width: size, height: size, ...maskStyle }} className={cn("inline-block shrink-0 bg-current", className)} />;
}

export function BrandLockup({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <BrandMark size={28} />
      <span className="font-semibold tracking-tight">Tracer</span>
    </div>
  );
}
