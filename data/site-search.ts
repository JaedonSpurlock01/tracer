/**
 * -------------------------------------------------------------------------
 * @file   site-search.ts
 * @brief  Reads a Site's Search Visibility, trend, and Keyword positions.
 *
 * @description
 *  Builds the Search panel's read model from stored rank days: the
 *  current Search Visibility score, a 30-day trend recomputed per day,
 *  each live Keyword with its latest position, 7-day change, ranking URL,
 *  and top results, the Service Area, and the newest check time.
 *
 * @remarks
 *  Each trend day uses every Keyword's most recent successful position on
 *  or before that day inside the window, so a Keyword counts from its first
 *  check onward and a missed or failed day keeps the last known position
 *  rather than opening a gap. A failed check newer than the last success
 *  shows as Check failed with the provider's reason, apart from Not
 *  ranking, which means a successful check found the Site nowhere in the
 *  top 100; the matched SERP feature says whether a position came from the
 *  organic list or the local pack. The 7-day change is the position seven days before
 *  the latest check minus the latest position, so a positive number is an
 *  improvement; it is absent when either side is missing or Not Ranking.
 *  Days are UTC calendar days, the day the rank check stores, so a
 *  check made just after UTC midnight is read at once in every Workspace
 *  timezone; the timezone argument is kept for callers but unused.
 *
 * @see
 *  data/search-visibility.ts
 *  data/site-keywords.ts
 *  data/rank-check.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Database } from "@/data/database";

import { addCalendarDays, calendarDateInTimeZone } from "@/data/analytics-range";
import { searchVisibility } from "@/data/search-visibility";
import { serviceAreaColumns, toServiceArea, type ServiceArea } from "@/data/site-keywords";

export interface SearchTopResult {
  position: number;
  type?: string;
  domain: string;
  url: string;
  title: string;
}

export type SearchKeywordStatus = "unchecked" | "ranking" | "not_ranking" | "check_failed";

export interface SearchKeyword {
  id: string;
  phrase: string;
  weight: number;
  /** What the newest rank day says: never checked, ranking, checked and absent from the top 100, or the check itself failed. */
  status: SearchKeywordStatus;
  position: number | null;
  change7d: number | null;
  rankingUrl: string | null;
  /** The SERP feature the Site ranked in on the newest successful check: organic, local_pack, map, or featured_snippet. */
  matchedType: string | null;
  failureReason: string | null;
  topResults: SearchTopResult[];
  checkedAt: string | null;
}

export interface SiteSearch {
  score: number | null;
  trend: { day: string; score: number | null }[];
  keywords: SearchKeyword[];
  serviceArea: ServiceArea;
  checkedAt: string | null;
}

export const searchTrendDays = 30;
const rankDayTimeZone = "UTC";

type KeywordRow = { id: string; phrase: string; weight: number };
type RankRow = { site_keyword_id: string; day: string; position: number | null; ranking_url: string | null; top_results: SearchTopResult[]; checked_at: Date; check_status: "checked" | "failed"; failure_reason: string | null; matched_type: string | null };

export async function siteSearch(database: Database, siteId: string, _timeZone: string, now: Date = new Date()): Promise<SiteSearch | null> {
  const today = calendarDateInTimeZone(now, rankDayTimeZone);
  const firstDay = addCalendarDays(today, -(searchTrendDays - 1));
  const [site, keywords, ranks] = await Promise.all([
    database.query<Parameters<typeof toServiceArea>[0]>(`select ${serviceAreaColumns} from site where id = $1`, [siteId]),
    database.query<KeywordRow>("select id, phrase, weight from site_keyword where site_id = $1 and removed_at is null order by created_at, id", [siteId]),
    database.query<RankRow>(
      `select r.site_keyword_id, r.day::text as day, r.position, r.ranking_url, r.top_results, r.checked_at, r.check_status, r.failure_reason, r.matched_type
         from keyword_rank_day r join site_keyword k on k.id = r.site_keyword_id
        where k.site_id = $1 and k.removed_at is null and r.day >= $2::date and r.day <= $3::date
        order by r.day`,
      [siteId, firstDay, today],
    ),
  ]);
  if (!site.rows[0]) return null;
  const byKeyword = new Map<string, RankRow[]>();
  const failedByKeyword = new Map<string, RankRow>();
  for (const row of ranks.rows) {
    if (row.check_status === "failed") {
      failedByKeyword.set(row.site_keyword_id, row);
      continue;
    }
    const rows = byKeyword.get(row.site_keyword_id) ?? [];
    rows.push(row);
    byKeyword.set(row.site_keyword_id, rows);
  }

  function positionOn(keywordId: string, day: string): number | null | undefined {
    const rows = byKeyword.get(keywordId) ?? [];
    let latest: RankRow | undefined;
    for (const row of rows) {
      if (row.day > day) break;
      latest = row;
    }
    return latest ? latest.position : undefined;
  }

  const trend: SiteSearch["trend"] = [];
  for (let day = firstDay; day <= today; day = addCalendarDays(day, 1)) {
    trend.push({ day, score: searchVisibility(keywords.rows.map((keyword) => ({ weight: keyword.weight, position: positionOn(keyword.id, day) }))) });
  }

  let checkedAt: Date | null = null;
  const searchKeywords = keywords.rows.map((keyword): SearchKeyword => {
    const rows = byKeyword.get(keyword.id) ?? [];
    const latest = rows.at(-1);
    const failed = failedByKeyword.get(keyword.id);
    const failedAfterLatest = failed && (!latest || failed.day > latest.day);
    const newest = failedAfterLatest ? failed : latest;
    if (!newest) return { id: keyword.id, phrase: keyword.phrase, weight: keyword.weight, status: "unchecked", position: null, change7d: null, rankingUrl: null, matchedType: null, failureReason: null, topResults: [], checkedAt: null };
    if (!checkedAt || newest.checked_at > checkedAt) checkedAt = newest.checked_at;
    const previous = latest ? positionOn(keyword.id, addCalendarDays(latest.day, -7)) : undefined;
    const change7d = latest && latest.position !== null && typeof previous === "number" ? previous - latest.position : null;
    return {
      id: keyword.id,
      phrase: keyword.phrase,
      weight: keyword.weight,
      status: failedAfterLatest ? "check_failed" : latest?.position === null ? "not_ranking" : "ranking",
      position: latest?.position ?? null,
      change7d,
      rankingUrl: latest?.ranking_url ?? null,
      matchedType: latest?.matched_type ?? null,
      failureReason: failedAfterLatest ? failed.failure_reason : null,
      topResults: latest?.top_results ?? [],
      checkedAt: newest.checked_at.toISOString(),
    };
  });

  const row = site.rows[0];
  return {
    score: trend.at(-1)?.score ?? null,
    trend,
    keywords: searchKeywords,
    serviceArea: toServiceArea(row),
    checkedAt: checkedAt ? (checkedAt as Date).toISOString() : null,
  };
}
