/**
 * -------------------------------------------------------------------------
 * @file   lead-classification-badge.tsx
 * @brief  Renders a Lead classification as a semantic Badge.
 *
 * @description
 *  Maps Good Lead, Not Good Lead, and Uncertain to light Badge variants.
 *  An automated classification is labeled as automated so a Lead
 *  Assessment never reads as a final result.
 *
 * @see
 *  data/lead-classification.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { Badge } from "@/components/reui/badge";
import type { LeadClassification } from "@/data/lead-classification";

const variants = {
  "Good Lead": "success-light",
  "Not Good Lead": "destructive-light",
  Uncertain: "warning-light",
} as const satisfies Record<LeadClassification, string>;

export default function LeadClassificationBadge({ classification, automated = false }: { classification: LeadClassification; automated?: boolean }) {
  return <Badge variant={variants[classification]}>{automated ? `${classification} (automated)` : classification}</Badge>;
}
