/**
 * -------------------------------------------------------------------------
 * @file   search-visibility.ts
 * @brief  Computes the Search Visibility score from Keyword positions.
 *
 * @description
 *  Maps a Google organic position to a click-through score (1 is 100, 2
 *  is 60, 3 is 45, 4 is 35, 5 is 25, 6 to 10 taper from 22 to 10, 11 to
 *  20 are 3, beyond 20 and Not Ranking are 0) and averages those scores
 *  over a Keyword set weighted by each Keyword's weight.
 *
 * @remarks
 *  A Keyword whose position is undefined has never been checked and is
 *  left out of the average, so a Site with no checked Keyword has no
 *  score rather than zero. A Not Ranking Keyword (null position) counts
 *  as zero because it was checked and found absent.
 *
 * @see
 *  data/site-search.ts
 *  docs/IMPLEMENTATION_ROADMAP.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export interface WeightedPosition {
  weight: number;
  position: number | null | undefined;
}

const topTenScores = [100, 60, 45, 35, 25, 22, 19, 16, 13, 10];

export function positionScore(position: number | null): number {
  if (position === null || position < 1) return 0;
  if (position <= 10) return topTenScores[position - 1];
  if (position <= 20) return 3;
  return 0;
}

export function searchVisibility(keywords: WeightedPosition[]): number | null {
  let totalWeight = 0;
  let total = 0;
  for (const keyword of keywords) {
    if (keyword.position === undefined) continue;
    totalWeight += keyword.weight;
    total += positionScore(keyword.position) * keyword.weight;
  }
  if (totalWeight === 0) return null;
  return Math.round(total / totalWeight);
}
