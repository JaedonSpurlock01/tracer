/**
 * -------------------------------------------------------------------------
 * @file   e2e-cloudflare-fake.ts
 * @brief  Provides the non-production E2E Cloudflare fake boundary.
 *
 * @description
 *  Serves six deterministic Sites with the live hostnames, one deployment
 *  each, 30 days of generated traffic, and a one-pixel JPEG preview for
 *  Playwright journeys without contacting Cloudflare, plus an uptime
 *  fetch that answers 200 so the local full sync never reaches the
 *  live hostnames.
 *
 * @remarks
 *  Runtime selection is separately gated by E2E_CLOUDFLARE_FAKE and
 *  production mode. Any token verifies, so the journey only needs an
 *  Account ID and a non-empty token.
 *
 * @see
 *  data/cloudflare-runtime.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { addCalendarDays } from "@/data/analytics-range";
import type { CloudflareClient, CloudflareDailyTraffic, CloudflareDeployment, CloudflareSite } from "@/data/cloudflare-client";

const onePixelJpeg = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

const fakeSites: { scriptName: string; apex: string; www: boolean; siteTag: string; zoneId: string }[] = [
  { scriptName: "asphalt-paving-blackfoot", apex: "asphaltpavingblackfoot.com", www: true, siteTag: "e2e00000000000000000000000000003", zoneId: "e2ezone0000000000000000000000003" },
  { scriptName: "asphalt-paving-pocatello", apex: "pocatelloasphaltpaving.com", www: true, siteTag: "e2e00000000000000000000000000001", zoneId: "e2ezone0000000000000000000000001" },
  { scriptName: "asphalt-paving-st-george", apex: "asphaltpavingstgeorge.com", www: true, siteTag: "e2e00000000000000000000000000002", zoneId: "e2ezone0000000000000000000000002" },
  { scriptName: "dumpster-rental-haines-city", apex: "dumpsterrentalhainescity.com", www: true, siteTag: "e2e00000000000000000000000000004", zoneId: "e2ezone0000000000000000000000004" },
  { scriptName: "idaho-falls-solar-installation", apex: "idahofallssolarinstallation.com", www: false, siteTag: "e2e00000000000000000000000000006", zoneId: "e2ezone0000000000000000000000006" },
  { scriptName: "solar-panel-sites", apex: "carsoncitysolarinstallation.com", www: false, siteTag: "e2e00000000000000000000000000005", zoneId: "e2ezone0000000000000000000000005" },
];

function sites(): CloudflareSite[] {
  return fakeSites.map((site) => ({
    scriptName: site.scriptName,
    primaryHostname: site.apex,
    zoneId: site.zoneId,
    rumSiteTag: site.siteTag,
    hostnames: [
      { hostname: site.apex, zoneId: site.zoneId, certificateId: `${site.zoneId}-apex`, enabled: true },
      ...(site.www ? [{ hostname: `www.${site.apex}`, zoneId: site.zoneId, certificateId: `${site.zoneId}-www`, enabled: true }] : []),
    ],
  }));
}

function deployment(scriptName: string): CloudflareDeployment {
  return { versionId: `e2e-${scriptName}-version-1`, source: "wrangler", authorEmail: "operator@example.com", deployedAt: "2026-10-11T23:12:59.000Z" };
}

function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
}

function traffic(siteTag: string, fromDate: string, toDate: string): CloudflareDailyTraffic[] {
  const seed = fakeSites.findIndex((site) => site.siteTag === siteTag) + 1;
  const rows: CloudflareDailyTraffic[] = [];
  for (let day = fromDate; day <= toDate; day = addCalendarDays(day, 1)) {
    const visits = 20 + seed * 3 + (dayNumber(day) % 7) * 2;
    rows.push({
      day,
      visits,
      pageViews: visits * 2,
      requests: visits * 4,
      errors: dayNumber(day) % 5 === 0 ? 1 : 0,
      topPaths: [["/", visits], ["/services", Math.floor(visits / 2)], ["/contact", Math.floor(visits / 4)]],
      referrers: [["", Math.floor(visits * 0.6)], ["www.google.com", Math.floor(visits * 0.4)]],
      devices: [["mobile", Math.floor(visits * 0.7)], ["desktop", Math.ceil(visits * 0.3)]],
      vitals: { lcpMs: 1200 + seed * 100, inpMs: 80 + seed * 5, cls: 0.02 },
    });
  }
  return rows;
}

export function createE2eSiteCheckFetch(): typeof fetch {
  return async () => new Response(null, { status: 200 });
}

export function createE2eCloudflareFake(): CloudflareClient {
  return {
    async verifyToken() {
      return { status: "active" };
    },
    async listSites() {
      return sites();
    },
    async listDeployments(_credential, scriptName, limit) {
      return [deployment(scriptName)].slice(0, limit);
    },
    async fetchDailyTraffic(_credential, query) {
      return traffic(query.siteTag, query.fromDate, query.toDate);
    },
    async captureScreenshot() {
      return Uint8Array.from(atob(onePixelJpeg), (character) => character.charCodeAt(0));
    },
  };
}
