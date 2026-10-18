/**
 * -------------------------------------------------------------------------
 * @file   lead-classification.ts
 * @brief  Defines Lead classifications, their reporting precedence, and Lead Review input.
 *
 * @description
 *  A Call's effective Lead classification is its Lead Review when one
 *  exists, otherwise its Lead Assessment, otherwise none. Also validates the
 *  classification and optional note an Operator submits as a Lead Review.
 *
 * @remarks
 *  Pending, Skipped, Failed, and unavailable are processing states, never
 *  classifications, so a Call still processing has no effective
 *  classification. Reporting reuses this precedence rather than restating it.
 *
 * @see
 *  CONTEXT.md
 *  data/lead-reviews.ts
 *  data/call-details.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export const leadClassifications = ["Good Lead", "Not Good Lead", "Uncertain"] as const;

export type LeadClassification = (typeof leadClassifications)[number];

export type EffectiveLeadClassification = { classification: LeadClassification; source: "review" | "assessment" } | null;

export const leadReviewNoteMaxLength = 2000;

export interface LeadReviewInput {
  classification: LeadClassification;
  note: string | null;
}

export function isLeadClassification(value: unknown): value is LeadClassification {
  return leadClassifications.includes(value as LeadClassification);
}

export function effectiveLeadClassification(input: { review: LeadClassification | null; assessment: LeadClassification | null }): EffectiveLeadClassification {
  if (input.review) return { classification: input.review, source: "review" };
  if (input.assessment) return { classification: input.assessment, source: "assessment" };
  return null;
}

export function parseLeadReviewInput(body: Record<string, unknown>): LeadReviewInput | null {
  if (!isLeadClassification(body.classification)) return null;
  if (body.note !== undefined && body.note !== null && typeof body.note !== "string") return null;
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > leadReviewNoteMaxLength) return null;
  return { classification: body.classification, note: note === "" ? null : note };
}
