/**
 * -------------------------------------------------------------------------
 * @file   flow-tones.ts
 * @brief  Maps Call Flow tones to Badge variants and theme colors.
 *
 * @description
 *  The domain names a branch or Outcome tone (success, warning,
 *  destructive, neutral); this file is the one place that turns a tone
 *  into a Badge variant or a CSS color token for edges and chips.
 *
 * @see
 *  data/call-flow.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { FlowTone } from "@/data/call-flow";

export const toneBadge = {
  neutral: "outline",
  success: "success-light",
  warning: "warning-light",
  destructive: "destructive-light",
} as const satisfies Record<FlowTone, string>;

export const toneColor: Record<FlowTone, string> = {
  neutral: "var(--color-muted-foreground)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  destructive: "var(--color-destructive)",
};
