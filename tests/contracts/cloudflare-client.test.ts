/**
 * -------------------------------------------------------------------------
 * @file   cloudflare-client.test.ts
 * @brief  Verifies the Cloudflare REST and GraphQL provider contract mapping.
 *
 * @description
 *  Exercises token verification, Site discovery from Workers scripts,
 *  custom domains, and Web Analytics site tags, deployment listing, per-day
 *  traffic from the GraphQL Analytics API, Browser Rendering screenshots,
 *  and safe provider errors using fake fetch responses and contract
 *  fixtures.
 *
 * @remarks
 *  Fixture identifiers are synthetic; the hostnames match the live Sites so
 *  the E2E fake and Staging read alike.
 *
 * @see
 *  data/cloudflare-client.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it, vi } from "vitest";

import { CloudflareClientError, createCloudflareClient } from "@/data/cloudflare-client";

import authenticationError from "./fixtures/cloudflare/authentication-error.json";
import deployments from "./fixtures/cloudflare/deployments.json";
import graphqlError from "./fixtures/cloudflare/graphql-error.json";
import dailyTraffic from "./fixtures/cloudflare/graphql-daily-traffic.json";
import rumSiteInfo from "./fixtures/cloudflare/rum-site-info.json";
import tokenVerifyInactive from "./fixtures/cloudflare/token-verify-inactive.json";
import tokenVerify from "./fixtures/cloudflare/token-verify.json";
import workersDomains from "./fixtures/cloudflare/workers-domains.json";
import workersScripts from "./fixtures/cloudflare/workers-scripts.json";

const credential = { accountId: "0123456789abcdef0123456789abcdef", apiToken: "synthetic-api-token" };
const baseUrl = "https://cloudflare.test/client/v4";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function routed(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(routes).find((path) => url === `${baseUrl}${path}`);
    if (!key) throw new Error(`Unexpected URL ${url}`);
    return response(routes[key]);
  });
}

describe("Cloudflare client", () => {
  it("verifies the token with Bearer authorization and the token-verify endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue(response(tokenVerify));
    const client = createCloudflareClient({ fetch, baseUrl });

    await expect(client.verifyToken(credential)).resolves.toEqual({ status: "active" });
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/user/tokens/verify`, { headers: { Authorization: `Bearer ${credential.apiToken}` } });
  });

  it("rejects an inactive token and an authentication error as authentication_failed", async () => {
    const inactive = createCloudflareClient({ fetch: vi.fn().mockResolvedValue(response(tokenVerifyInactive)), baseUrl });
    await expect(inactive.verifyToken(credential)).rejects.toMatchObject({ code: "authentication_failed" });
    const rejected = createCloudflareClient({ fetch: vi.fn().mockResolvedValue(response(authenticationError, 401)), baseUrl });
    await expect(rejected.verifyToken(credential)).rejects.toBeInstanceOf(CloudflareClientError);
    await expect(rejected.verifyToken(credential)).rejects.toMatchObject({ code: "authentication_failed", status: 401 });
  });

  it("lists only Workers with a custom domain as Sites, apex first, joined with their Web Analytics site tag", async () => {
    const fetch = routed({
      [`/accounts/${credential.accountId}/workers/scripts`]: workersScripts,
      [`/accounts/${credential.accountId}/workers/domains`]: workersDomains,
      [`/accounts/${credential.accountId}/rum/site_info/list`]: rumSiteInfo,
    });
    const client = createCloudflareClient({ fetch, baseUrl });

    const sites = await client.listSites(credential);

    expect(sites.map((site) => site.scriptName)).toEqual([
      "asphalt-paving-blackfoot",
      "asphalt-paving-pocatello",
      "asphalt-paving-st-george",
      "dumpster-rental-haines-city",
      "idaho-falls-solar-installation",
      "solar-panel-sites",
    ]);
    expect(sites.find((site) => site.scriptName === "asphalt-paving-pocatello")).toEqual({
      scriptName: "asphalt-paving-pocatello",
      primaryHostname: "pocatelloasphaltpaving.com",
      zoneId: "z1000000000000000000000000000001",
      rumSiteTag: "a1000000000000000000000000000001",
      hostnames: [
        { hostname: "pocatelloasphaltpaving.com", zoneId: "z1000000000000000000000000000001", certificateId: "c1000000-0000-4000-8000-000000000001", enabled: true },
        { hostname: "www.pocatelloasphaltpaving.com", zoneId: "z1000000000000000000000000000001", certificateId: "c1000000-0000-4000-8000-000000000002", enabled: true },
      ],
    });
    expect(sites.find((site) => site.scriptName === "asphalt-paving-blackfoot")?.hostnames[1]).toEqual({ hostname: "www.asphaltpavingblackfoot.com", zoneId: "z3000000000000000000000000000003", certificateId: null, enabled: false });
    expect(sites.find((site) => site.scriptName === "idaho-falls-solar-installation")).toMatchObject({ primaryHostname: "idahofallssolarinstallation.com", rumSiteTag: null });
  });

  it("lists deployments newest first with the live version and the requested limit", async () => {
    const fetch = vi.fn().mockResolvedValue(response(deployments));
    const client = createCloudflareClient({ fetch, baseUrl });

    const listed = await client.listDeployments(credential, "asphalt-paving-pocatello", 2);

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/accounts/${credential.accountId}/workers/scripts/asphalt-paving-pocatello/deployments`, expect.anything());
    expect(listed).toEqual([
      { versionId: "9f8e7d6c-5b4a-4321-8765-4321fedcba98", source: "wrangler", authorEmail: "operator@example.com", deployedAt: "2026-10-11T23:12:59.296Z" },
      { versionId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", source: "dash", authorEmail: null, deployedAt: "2026-10-10T18:40:11.000Z" },
    ]);
  });

  it("fetches per-day traffic through GraphQL and maps page views, visits, paths, referrers, devices, vitals, and Worker counts", async () => {
    const fetch = vi.fn().mockResolvedValue(response(dailyTraffic));
    const client = createCloudflareClient({ fetch, baseUrl });

    const days = await client.fetchDailyTraffic(credential, { siteTag: "a1000000000000000000000000000001", scriptName: "asphalt-paving-pocatello", fromDate: "2026-10-18", toDate: "2026-10-19" });

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${baseUrl}/graphql`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${credential.apiToken}`);
    const body = JSON.parse(String(init.body)) as { query: string; variables: Record<string, string> };
    expect(body.query).toContain("rumPageloadEventsAdaptiveGroups");
    expect(body.query).toContain("rumWebVitalsEventsAdaptiveGroups");
    expect(body.query).toContain("workersInvocationsAdaptive");
    expect(body.variables).toEqual({
      accountTag: credential.accountId,
      siteTag: "a1000000000000000000000000000001",
      scriptName: "asphalt-paving-pocatello",
      from: "2026-10-18T00:00:00Z",
      to: "2026-10-19T23:59:59Z",
    });
    expect(days).toEqual([
      {
        day: "2026-10-18",
        visits: 31,
        pageViews: 48,
        requests: 123,
        errors: 3,
        topPaths: [["/", 30], ["/services", 10], ["/contact", 8]],
        referrers: [["", 40], ["www.google.com", 8]],
        devices: [["mobile", 30], ["desktop", 18]],
        vitals: { lcpMs: 256, inpMs: null, cls: 0.012 },
      },
      {
        day: "2026-10-19",
        visits: 40,
        pageViews: 62,
        requests: 150,
        errors: 0,
        topPaths: [["/", 20], ["/services", 9], ["/contact", 8], ["/about", 7], ["/driveways", 6], ["/parking-lots", 5], ["/sealcoating", 3], ["/reviews", 2]],
        referrers: [["", 50], ["www.google.com", 12]],
        devices: [["mobile", 44], ["desktop", 18]],
        vitals: { lcpMs: 1840, inpMs: 96, cls: 0.04 },
      },
    ]);
  });

  it("treats GraphQL errors and malformed JSON as invalid_response", async () => {
    const errored = createCloudflareClient({ fetch: vi.fn().mockResolvedValue(response(graphqlError)), baseUrl });
    await expect(errored.fetchDailyTraffic(credential, { siteTag: "a1", scriptName: "s", fromDate: "2026-10-18", toDate: "2026-10-19" })).rejects.toMatchObject({ code: "invalid_response" });
    const malformed = createCloudflareClient({ fetch: vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })), baseUrl });
    await expect(malformed.verifyToken(credential)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("captures a JPEG screenshot through Browser Rendering and reports unavailable providers", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const fetch = vi.fn().mockResolvedValue(new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } }));
    const client = createCloudflareClient({ fetch, baseUrl });

    await expect(client.captureScreenshot(credential, "https://pocatelloasphaltpaving.com")).resolves.toEqual(jpeg);
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/accounts/${credential.accountId}/browser-rendering/screenshot`, {
      method: "POST",
      headers: { Authorization: `Bearer ${credential.apiToken}`, "content-type": "application/json" },
      body: JSON.stringify({ url: "https://pocatelloasphaltpaving.com", viewport: { width: 1280, height: 800 }, screenshotOptions: { type: "jpeg", quality: 80 } }),
    });

    const failing = createCloudflareClient({ fetch: vi.fn().mockResolvedValue(new Response(null, { status: 503 })), baseUrl });
    await expect(failing.captureScreenshot(credential, "https://pocatelloasphaltpaving.com")).rejects.toMatchObject({ code: "provider_unavailable", status: 503 });
    const offline = createCloudflareClient({ fetch: vi.fn().mockRejectedValue(new TypeError("fetch failed")), baseUrl });
    await expect(offline.verifyToken(credential)).rejects.toMatchObject({ code: "provider_unavailable", status: null });
  });
});
