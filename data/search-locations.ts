/**
 * -------------------------------------------------------------------------
 * @file   search-locations.ts
 * @brief  Keeps DataForSEO's SERP locations for a country and searches them.
 *
 * @description
 *  The Service Area picker needs DataForSEO's own location names and
 *  codes, because a rank check sent with a name DataForSEO does not know
 *  fails for every Keyword. The country list is tens of thousands of rows,
 *  so it is imported once into `search_location` through the
 *  Organization's DataForSEO credential the first time a picker asks for
 *  that country, and every later keystroke searches the table.
 *
 * @remarks
 *  Rows are shared across Organizations: a location is a fact about
 *  Google, not about a tenant. The import replaces the country's rows in
 *  one transaction and inserts in batches through unnest so the Worker
 *  issues a few statements rather than one per location. DataForSEO's
 *  United States list repeats some location codes, and a batch that
 *  updates the same row twice is a PostgreSQL error, so codes are deduped
 *  before the insert (the Production picker failed on this on
 *  2026-10-25). Matching is a
 *  case-insensitive contains on the name with the shortest names first,
 *  so "poca" finds Pocatello before Pocatello Regional Airport.
 *
 * @see
 *  data/dataforseo-client.ts
 *  data/site-keywords.ts
 *  data/workspaces-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import type { DataForSeoClient, DataForSeoCredential, DataForSeoLocation } from "@/data/dataforseo-client";
import { withTransaction } from "@/data/provider-credential";

export const searchLocationLimit = 8;
export const searchLocationMinimumQuery = 2;
const importBatchSize = 1000;

export interface SearchLocations {
  /** Imports the country's locations when none are stored yet, then returns how many rows the country has. */
  ensure(countryIso: string, dataforseo: DataForSeoClient, credential: DataForSeoCredential, now: Date): Promise<number>;
  search(countryIso: string, query: string, limit?: number): Promise<DataForSeoLocation[]>;
}

export function createSearchLocations(pool: Pool): SearchLocations {
  async function countFor(countryIso: string): Promise<number> {
    const result = await pool.query<{ count: string }>("select count(*) from search_location where country_iso = $1", [countryIso]);
    return Number(result.rows[0]?.count ?? 0);
  }

  return {
    async ensure(countryIso, dataforseo, credential, now) {
      const iso = countryIso.toLowerCase();
      const existing = await countFor(iso);
      if (existing > 0) return existing;
      const locations = [...new Map((await dataforseo.listLocations(credential, iso)).map((location) => [location.code, location])).values()];
      await withTransaction(pool, async (client) => {
        await client.query("delete from search_location where country_iso = $1", [iso]);
        for (let start = 0; start < locations.length; start += importBatchSize) {
          const batch = locations.slice(start, start + importBatchSize);
          await client.query(
            `insert into search_location (code, country_iso, name, kind, imported_at)
             select * from unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::timestamptz[])
             on conflict (code) do update set country_iso = excluded.country_iso, name = excluded.name, kind = excluded.kind, imported_at = excluded.imported_at`,
            [batch.map((location) => location.code), batch.map(() => iso), batch.map((location) => location.name), batch.map((location) => location.kind), batch.map(() => now)],
          );
        }
      });
      return locations.length;
    },

    async search(countryIso, query, limit = searchLocationLimit) {
      const needle = query.trim().toLowerCase();
      if (needle.length < searchLocationMinimumQuery) return [];
      const result = await pool.query<{ code: number; name: string; kind: string }>(
        `select code, name, kind from search_location
          where country_iso = $1 and lower(name) like '%' || $2 || '%'
          order by position($2 in lower(name)), length(name), name
          limit $3`,
        [countryIso.toLowerCase(), needle.replace(/[%_\\]/g, (character) => `\\${character}`), limit],
      );
      return result.rows;
    },
  };
}
