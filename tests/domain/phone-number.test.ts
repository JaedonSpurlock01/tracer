/**
 * -------------------------------------------------------------------------
 * @file   phone-number.test.ts
 * @brief  Verifies Organization phone number normalization.
 *
 * @description
 *  Covers accepted NANP formatting and rejected non-E.164 candidates.
 *
 * @remarks
 *  The first-release inventory accepts only +1 numbers.
 *
 * @see
 *  data/phone-number.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { normalizeE164PhoneNumber } from "@/data/phone-number";

describe("E.164 phone number normalization", () => {
  it("normalizes supported NANP formatting", () => {
    for (const input of [
      "(415) 555-2671",
      "415.555.2671",
      "1 415 555 2671",
      "+1 415-555-2671",
      "+14155552671",
    ]) {
      expect(normalizeE164PhoneNumber(input)).toBe("+14155552671");
    }
  });

  it("rejects non-plus-one, malformed, and invalid NANP numbers", () => {
    for (const input of [
      "+442071234567",
      "",
      "garbage",
      "415555267",
      "141555526710",
      "(015) 555-2671",
      "(415) 055-2671",
    ]) {
      expect(normalizeE164PhoneNumber(input)).toBeNull();
    }
  });
});
