/**
 * -------------------------------------------------------------------------
 * @file   dataforseo-client.test.ts
 * @brief  Verifies the DataForSEO provider contract mapping.
 *
 * @description
 *  Exercises credential verification through the user data endpoint, the
 *  Google organic live SERP request and its mapping to organic items with
 *  absolute positions, and safe provider errors using fake fetch
 *  responses and contract fixtures.
 *
 * @remarks
 *  Fixture identifiers and balances are synthetic; the hostnames match the
 *  live Sites so the E2E fake and Staging read alike.
 *
 * @see
 *  data/dataforseo-client.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it, vi } from "vitest";

import { createDataForSeoClient, DataForSeoClientError } from "@/data/dataforseo-client";

import authenticationError from "./fixtures/dataforseo/authentication-error.json";
import keywordOverview from "./fixtures/dataforseo/labs-keyword-overview.json";
import locationsUs from "./fixtures/dataforseo/locations-us.json";
import serpAdvanced from "./fixtures/dataforseo/serp-organic-live-advanced.json";
import serpTaskError from "./fixtures/dataforseo/serp-task-error.json";
import userData from "./fixtures/dataforseo/user-data.json";

const credential = { login: "operator@example.com", password: "synthetic-dataforseo-password" };
const baseUrl = "https://dataforseo.test/v3";
const basic = `Basic ${Buffer.from(`${credential.login}:${credential.password}`).toString("base64")}`;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("DataForSEO client", () => {
  it("verifies the credential with Basic authorization against the user data endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue(response(userData));
    const client = createDataForSeoClient({ fetch, baseUrl });

    await expect(client.verify(credential)).resolves.toEqual({ login: "operator@example.com" });
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/appendix/user_data`, { headers: { Authorization: basic } });
  });

  it("rejects an HTTP 401 and a 401xx status code as authentication_failed", async () => {
    const rejected = createDataForSeoClient({ fetch: vi.fn().mockResolvedValue(response(authenticationError, 401)), baseUrl });
    await expect(rejected.verify(credential)).rejects.toBeInstanceOf(DataForSeoClientError);
    await expect(rejected.verify(credential)).rejects.toMatchObject({ code: "authentication_failed", status: 401 });
    const bodyRejected = createDataForSeoClient({ fetch: vi.fn().mockResolvedValue(response(authenticationError, 200)), baseUrl });
    await expect(bodyRejected.verify(credential)).rejects.toMatchObject({ code: "authentication_failed" });
  });

  it("posts one live advanced SERP task by location code and maps organic, local pack, and map items with their type and absolute position", async () => {
    const fetch = vi.fn().mockResolvedValue(response(serpAdvanced));
    const client = createDataForSeoClient({ fetch, baseUrl });

    const result = await client.serp(credential, { keyword: "asphalt paving pocatello", locationCode: 1016141, languageCode: "en", depth: 100 });

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/serp/google/organic/live/advanced`, {
      method: "POST",
      headers: { Authorization: basic, "content-type": "application/json" },
      body: JSON.stringify([{ keyword: "asphalt paving pocatello", location_code: 1016141, language_code: "en", depth: 100 }]),
    });
    expect(result).toEqual({
      items: [
        { position: 2, type: "map", domain: "www.google.com", url: "https://www.google.com/maps/search/asphalt+paving+pocatello", title: "Map" },
        { position: 3, type: "local_pack", domain: "pocatelloasphaltpaving.com", url: "https://pocatelloasphaltpaving.com/", title: "Pocatello Asphalt Paving" },
        { position: 5, type: "organic", domain: "www.idahopaving.example", url: "https://www.idahopaving.example/", title: "Idaho Paving Contractors" },
        { position: 6, type: "organic", domain: "pocatelloasphaltpaving.com", url: "https://pocatelloasphaltpaving.com/services", title: "Pocatello Asphalt Paving" },
        { position: 8, type: "organic", domain: "www.yelp.com", url: "https://www.yelp.com/search?find_desc=Asphalt+Paving&find_loc=Pocatello%2C+ID", title: "Top 10 Best Asphalt Paving in Pocatello, ID" },
      ],
    });
  });

  it("posts one Labs keyword overview task and maps each phrase's monthly volume, difficulty, and intent, leaving a phrase without data at zero", async () => {
    const fetch = vi.fn().mockResolvedValue(response(keywordOverview));
    const client = createDataForSeoClient({ fetch, baseUrl });

    const result = await client.keywordOverview(credential, {
      keywords: ["asphalt paving pocatello", "driveway paving pocatello idaho", "parking lot sealcoating pocatello", "pothole repair near me"],
      locationCode: 1016141,
      languageCode: "en",
    });

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/dataforseo_labs/google/keyword_overview/live`, {
      method: "POST",
      headers: { Authorization: basic, "content-type": "application/json" },
      body: JSON.stringify([{ keywords: ["asphalt paving pocatello", "driveway paving pocatello idaho", "parking lot sealcoating pocatello", "pothole repair near me"], location_code: 1016141, language_code: "en" }]),
    });
    expect(result).toEqual([
      { phrase: "asphalt paving pocatello", monthlyVolume: 210, difficulty: 23, intent: "commercial" },
      { phrase: "driveway paving pocatello idaho", monthlyVolume: 480, difficulty: 31, intent: "transactional" },
      { phrase: "parking lot sealcoating pocatello", monthlyVolume: 0, difficulty: null, intent: null },
    ]);
  });

  it("sends a location name when no code is known", async () => {
    const fetch = vi.fn().mockResolvedValue(response(serpAdvanced));
    await createDataForSeoClient({ fetch, baseUrl }).serp(credential, { keyword: "asphalt paving pocatello", locationName: "Pocatello,Idaho,United States", languageCode: "en", depth: 100 });
    expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual([{ keyword: "asphalt paving pocatello", location_name: "Pocatello,Idaho,United States", language_code: "en", depth: 100 }]);
  });

  it("lists a country's locations with their code, name, and kind", async () => {
    const fetch = vi.fn().mockResolvedValue(response(locationsUs));
    const client = createDataForSeoClient({ fetch, baseUrl });
    const locations = await client.listLocations(credential, "us");
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/serp/google/locations/us`, { headers: { Authorization: basic } });
    expect(locations).toEqual([
      { code: 2840, name: "United States", kind: "Country" },
      { code: 21146, name: "Idaho,United States", kind: "State" },
      { code: 1016141, name: "Pocatello,Idaho,United States", kind: "City" },
      { code: 1016142, name: "Pocatello Regional Airport,Idaho,United States", kind: "Airport" },
    ]);
  });

  it("reports a failed task with its status message, a malformed body, and a server error without exposing the response", async () => {
    const taskFailed = createDataForSeoClient({ fetch: vi.fn().mockResolvedValue(response(serpTaskError)), baseUrl });
    await expect(taskFailed.serp(credential, { keyword: "x", locationName: "Nowhere", languageCode: "en", depth: 100 })).rejects.toMatchObject({ code: "task_failed", message: "DataForSEO rejected the task (40501): Invalid Field: 'location_name'." });
    const malformed = createDataForSeoClient({ fetch: vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })), baseUrl });
    await expect(malformed.verify(credential)).rejects.toMatchObject({ code: "invalid_response" });
    const down = createDataForSeoClient({ fetch: vi.fn().mockResolvedValue(response({ status_code: 50000 }, 503)), baseUrl });
    const error = await down.verify(credential).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "provider_unavailable", status: 503 });
    expect(String((error as Error).message)).not.toContain(credential.password);
    const offline = createDataForSeoClient({ fetch: vi.fn().mockRejectedValue(new TypeError("fetch failed")), baseUrl });
    await expect(offline.verify(credential)).rejects.toMatchObject({ code: "provider_unavailable", status: null });
  });
});
