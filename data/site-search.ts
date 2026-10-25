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
 *  Each trend day uses every Keyword's most recent stored position on or
 *  before that day inside the window, so a Keyword counts from its first
 *  check onward and a missed day keeps the last known position rather
 *  than opening a gap. The 7-day change is the position seven days before
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
import type { Pool } from "pg";

import { addCalendarDays, calendarDateInTimeZone } from "@/data/analytics-range";
import { searchVisibility } from "@/data/search-visibility";
import { defaultServiceAreaCountry, type ServiceArea } from "@/data/site-keywords";

export interface SearchTopResult {
  position: number;
  domain: string;
  url: string;
  title: string;
}

export interface SearchKeyword {
  id: string;
  phrase: string;
  weight: number;
  position: number | null;
  change7d: number | null;
  rankingUrl: string | null;
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
type RankRow = { site_keyword_id: string; day: string; position: number | null; ranking_url: string | null; top_results: SearchTopResult[]; checked_at: Date };
type ServiceAreaRow = { service_area_city: string | null; service_area_region: string | null; service_area_country: string | null };

export async function siteSearch(pool: Pool, siteId: string, _timeZone: string, now: Date = new Date()): Promise<SiteSearch | null> {
  const today = calendarDateInTimeZone(now, rankDayTimeZone);
  const firstDay = addCalendarDays(today, -(searchTrendDays - 1));
  const [site, keywords, ranks] = await Promise.all([
    pool.query<ServiceAreaRow>("select service_area_city, service_area_region, service_area_country from site where id = $1", [siteId]),
    pool.query<KeywordRow>("select id, phrase, weight from site_keyword where site_id = $1 and removed_at is null order by created_at, id", [siteId]),
    pool.query<RankRow>(
      `select r.site_keyword_id, r.day::text as day, r.position, r.ranking_url, r.top_results, r.checked_at
         from keyword_rank_day r join site_keyword k on k.id = r.site_keyword_id
        where k.site_id = $1 and k.removed_at is null and r.day >= $2::date and r.day <= $3::date
        order by r.day`,
      [siteId, firstDay, today],
    ),
  ]);
  if (!site.rows[0]) return null;
  const byKeyword = new Map<string, RankRow[]>();
  for (const row of ranks.rows) {
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
    if (!latest) return { id: keyword.id, phrase: keyword.phrase, weight: keyword.weight, position: null, change7d: null, rankingUrl: null, topResults: [], checkedAt: null };
    if (!checkedAt || latest.checked_at > checkedAt) checkedAt = latest.checked_at;
    const previous = positionOn(keyword.id, addCalendarDays(latest.day, -7));
    const change7d = latest.position !== null && typeof previous === "number" ? previous - latest.position : null;
    return {
      id: keyword.id,
      phrase: keyword.phrase,
      weight: keyword.weight,
      position: latest.position,
      change7d,
      rankingUrl: latest.ranking_url,
      topResults: latest.top_results,
      checkedAt: latest.checked_at.toISOString(),
    };
  });

  const row = site.rows[0];
  return {
    score: trend.at(-1)?.score ?? null,
    trend,
    keywords: searchKeywords,
    serviceArea: { city: row.service_area_city, region: row.service_area_region, country: row.service_area_country ?? defaultServiceAreaCountry },
    checkedAt: checkedAt ? (checkedAt as Date).toISOString() : null,
  };
}
