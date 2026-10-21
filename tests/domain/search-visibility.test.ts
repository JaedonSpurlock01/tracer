/**
 * -------------------------------------------------------------------------
 * @file   search-visibility.test.ts
 * @brief  Verifies the Search Visibility click-through curve and weighting.
 *
 * @description
 *  Covers the documented position curve, the weighted average over a
 *  Keyword set, Not Ranking and unchecked Keywords, and the absence of a
 *  score for an empty or never-checked Keyword set.
 *
 * @see
 *  data/search-visibility.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { positionScore, searchVisibility } from "@/data/search-visibility";

describe("positionScore", () => {
  it("follows the documented click-through curve", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(positionScore)).toEqual([100, 60, 45, 35, 25, 22, 19, 16, 13, 10]);
    expect(positionScore(11)).toBe(3);
    expect(positionScore(20)).toBe(3);
    expect(positionScore(21)).toBe(0);
    expect(positionScore(100)).toBe(0);
  });

  it("scores Not Ranking as zero", () => {
    expect(positionScore(null)).toBe(0);
  });
});

describe("searchVisibility", () => {
  it("weights each checked Keyword's position score and rounds to an integer", () => {
    expect(searchVisibility([{ weight: 5, position: 1 }, { weight: 1, position: 3 }])).toBe(91);
    expect(searchVisibility([{ weight: 1, position: 1 }, { weight: 1, position: 2 }])).toBe(80);
    expect(searchVisibility([{ weight: 2, position: 2 }, { weight: 1, position: 4 }])).toBe(52);
  });

  it("counts a Not Ranking Keyword as zero inside the weighted average", () => {
    expect(searchVisibility([{ weight: 1, position: 1 }, { weight: 1, position: null }])).toBe(50);
    expect(searchVisibility([{ weight: 3, position: null }])).toBe(0);
  });

  it("yields no score rather than zero without a checked Keyword", () => {
    expect(searchVisibility([])).toBeNull();
    expect(searchVisibility([{ weight: 2, position: undefined }])).toBeNull();
    expect(searchVisibility([{ weight: 2, position: undefined }, { weight: 1, position: 5 }])).toBe(25);
  });
});
