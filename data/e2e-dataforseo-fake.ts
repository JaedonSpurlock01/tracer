/**
 * -------------------------------------------------------------------------
 * @file   e2e-dataforseo-fake.ts
 * @brief  Provides the non-production E2E DataForSEO fake boundary.
 *
 * @description
 *  Accepts any login and password and answers each SERP lookup with a
 *  deterministic page of organic results: the phrase decides the position
 *  of the Site whose hostname appears in the phrase's location, so a
 *  Playwright journey can set Keywords, run a check, and read a stable
 *  Search Visibility score without contacting DataForSEO.
 *
 * @remarks
 *  Runtime selection is separately gated by E2E_DATAFORSEO_FAKE and
 *  production mode. The ranking hostname is derived from the location
 *  name's city so every fake Site ranks for its own city: a phrase whose
 *  length is a multiple of three ranks first, otherwise the position is
 *  the phrase length modulo 12 plus 2, and a phrase containing "missing"
 *  never ranks.
 *
 * @see
 *  data/dataforseo-runtime.ts
 *  data/e2e-cloudflare-fake.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { DataForSeoClient, DataForSeoLocation, DataForSeoSerpItem } from "@/data/dataforseo-client";

function cityHostname(locationName: string): string {
  const city = locationName.split(",")[0]?.trim().toLowerCase().replace(/[^a-z]/g, "") ?? "";
  return `${city}asphaltpaving.com`;
}

export function fakePosition(phrase: string): number | null {
  if (phrase.toLowerCase().includes("missing")) return null;
  if (phrase.length % 3 === 0) return 1;
  return (phrase.length % 12) + 2;
}

export const fakeLocations: DataForSeoLocation[] = [
  { code: 2840, name: "United States", kind: "Country" },
  { code: 21146, name: "Idaho,United States", kind: "State" },
  { code: 1016141, name: "Pocatello,Idaho,United States", kind: "City" },
  { code: 1016142, name: "Pocatello Regional Airport,Idaho,United States", kind: "Airport" },
  { code: 1026339, name: "St. George,Utah,United States", kind: "City" },
];

export function createE2eDataForSeoFake(): DataForSeoClient {
  return {
    async listLocations() {
      return fakeLocations;
    },
    async keywordOverview(_credential, query) {
      return query.keywords.map((phrase) => ({ phrase, monthlyVolume: (phrase.length % 7) * 40, difficulty: phrase.length % 50, intent: "commercial" as const }));
    },
    async verify(credential) {
      return { login: credential.login };
    },
    async serp(_credential, query) {
      const position = fakePosition(query.keyword);
      const items: DataForSeoSerpItem[] = [];
      for (let rank = 1; rank <= 20; rank += 1) {
        if (rank === position) {
          const hostname = cityHostname(query.locationName ?? fakeLocations.find((location) => location.code === query.locationCode)?.name ?? "");
          items.push({ position: rank, type: rank === 1 ? "local_pack" : "organic", domain: hostname, url: `https://${hostname}/`, title: `${query.keyword} | ${hostname}` });
        } else {
          items.push({ position: rank, type: "organic", domain: `competitor-${rank}.example`, url: `https://competitor-${rank}.example/`, title: `Competitor ${rank}` });
        }
      }
      return { items };
    },
  };
}
