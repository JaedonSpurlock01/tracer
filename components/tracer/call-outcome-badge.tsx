/**
 * -------------------------------------------------------------------------
 * @file   call-outcome-badge.tsx
 * @brief  Shows a Call's canonical Call Outcome as a semantic Badge.
 *
 * @description
 *  Maps each Call Outcome to one ReUI light Badge variant and labels a Call
 *  that has not finished yet as In Progress.
 *
 * @remarks
 *  The same mapping serves Recent Calls and Call Detail so an outcome reads
 *  the same everywhere.
 *
 * @see
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { Badge } from "@/components/reui/badge";
import type { OutcomeKind } from "@/data/call-flow";

const outcomeVariants = {
  Answered: "success-light",
  Voicemail: "info-light",
  Missed: "warning-light",
  Abandoned: "warning-light",
  Blocked: "destructive-light",
  Failed: "destructive-light",
} as const satisfies Record<OutcomeKind, string>;

export default function CallOutcomeBadge({ outcome }: { outcome: OutcomeKind | null }) {
  return <Badge variant={outcome ? outcomeVariants[outcome] : "primary-light"}>{outcome ?? "In Progress"}</Badge>;
}
