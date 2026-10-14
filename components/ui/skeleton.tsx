/**
 * -------------------------------------------------------------------------
 * @file   skeleton.tsx
 * @brief  Provides a semantic loading placeholder for settings regions.
 *
 * @description
 *  Renders a muted block that preserves the final region layout while data
 *  loads.
 *
 * @remarks
 *  The primitive has no data or interaction behavior.
 *
 * @see
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { CSSProperties } from "react";

import { cn } from "cn";

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cn("animate-pulse bg-muted", className)} style={style} aria-hidden="true" />;
}
