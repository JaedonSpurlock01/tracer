/**
 * -------------------------------------------------------------------------
 * @file   lead-classification.test.ts
 * @brief  Verifies effective lead classification and Lead Review input.
 *
 * @description
 *  Covers Lead Review precedence over the Lead Assessment, the absence of
 *  any classification when neither exists, and the classification and note
 *  rules an Operator's Lead Review must satisfy.
 *
 * @remarks
 *  Pending, Skipped, and Failed processing states are never passed in as
 *  classifications, so they can only ever produce no classification.
 *
 * @see
 *  data/lead-classification.ts
 *  CONTEXT.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { effectiveLeadClassification, leadReviewNoteMaxLength, parseLeadReviewInput } from "@/data/lead-classification";

describe("effective lead classification", () => {
  it("takes the Lead Review over a disagreeing Lead Assessment", () => {
    expect(effectiveLeadClassification({ review: "Not Good Lead", assessment: "Good Lead" })).toEqual({ classification: "Not Good Lead", source: "review" });
  });

  it("takes the Lead Review when there is no Lead Assessment", () => {
    expect(effectiveLeadClassification({ review: "Uncertain", assessment: null })).toEqual({ classification: "Uncertain", source: "review" });
  });

  it("falls back to the Lead Assessment when there is no Lead Review", () => {
    expect(effectiveLeadClassification({ review: null, assessment: "Good Lead" })).toEqual({ classification: "Good Lead", source: "assessment" });
  });

  it("has no classification without a Lead Review or a Lead Assessment", () => {
    expect(effectiveLeadClassification({ review: null, assessment: null })).toBeNull();
  });
});

describe("Lead Review input", () => {
  it("accepts each Lead classification with a trimmed note", () => {
    for (const classification of ["Good Lead", "Not Good Lead", "Uncertain"]) {
      expect(parseLeadReviewInput({ classification, note: "  Booked a visit.  " })).toEqual({ classification, note: "Booked a visit." });
    }
  });

  it("stores a missing, null, or blank note as no note", () => {
    expect(parseLeadReviewInput({ classification: "Good Lead" })).toEqual({ classification: "Good Lead", note: null });
    expect(parseLeadReviewInput({ classification: "Good Lead", note: null })).toEqual({ classification: "Good Lead", note: null });
    expect(parseLeadReviewInput({ classification: "Good Lead", note: "   " })).toEqual({ classification: "Good Lead", note: null });
  });

  it("rejects a classification outside Good Lead, Not Good Lead, and Uncertain", () => {
    for (const classification of ["good lead", "Spam", "Pending", "", null, undefined, 1]) {
      expect(parseLeadReviewInput({ classification })).toBeNull();
    }
  });

  it("rejects a note that is not text or is longer than the limit after trimming", () => {
    expect(parseLeadReviewInput({ classification: "Good Lead", note: 5 })).toBeNull();
    expect(parseLeadReviewInput({ classification: "Good Lead", note: "x".repeat(leadReviewNoteMaxLength + 1) })).toBeNull();
    expect(parseLeadReviewInput({ classification: "Good Lead", note: ` ${"x".repeat(leadReviewNoteMaxLength)} ` })).toEqual({ classification: "Good Lead", note: "x".repeat(leadReviewNoteMaxLength) });
  });
});
