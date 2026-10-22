/**
 * -------------------------------------------------------------------------
 * @file   places-client.test.ts
 * @brief  Proves the Photon city lookup request and response mapping.
 *
 * @description
 *  Runs the Places client against a recorded Photon city search and
 *  checks the request shape, the label and point mapping, the handling
 *  of a feature without a name and of a duplicate label, and the
 *  failure modes for a short query, an HTTP error, and a network error.
 *
 * @see
 *  data/places-client.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it, vi } from "vitest";

import { createPlacesClient, PlacesClientError } from "@/data/places-client";

import austin from "./fixtures/photon/austin.json";

const baseUrl = "https://photon.test";

describe("Places client", () => {
  it("asks Photon's city layer for five English results and maps name, state, and country to a label with the point", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(austin), { status: 200, headers: { "content-type": "application/json" } }));
    const client = createPlacesClient({ fetch, baseUrl });

    const places = await client.searchCities(" austin ");

    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/?q=austin&limit=5&lang=en&layer=city`, { headers: { accept: "application/json" } });
    expect(places).toEqual([
      { label: "Austin, Texas, United States", latitude: 30.2649261, longitude: -97.7474086 },
      { label: "Austin, Minnesota, United States", latitude: 43.6679992, longitude: -92.9746498 },
      { label: "Austin, Nevada, United States", latitude: 39.4929853, longitude: -117.0714484 },
    ]);
  });

  it("answers a query under two characters without calling Photon", async () => {
    const fetch = vi.fn();
    await expect(createPlacesClient({ fetch, baseUrl }).searchCities("a")).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports an HTTP error with its status and a network error without one", async () => {
    await expect(createPlacesClient({ fetch: vi.fn().mockResolvedValue(new Response("busy", { status: 429 })), baseUrl }).searchCities("austin")).rejects.toMatchObject({ status: 429 });
    await expect(createPlacesClient({ fetch: vi.fn().mockRejectedValue(new TypeError("fetch failed")), baseUrl }).searchCities("austin")).rejects.toBeInstanceOf(PlacesClientError);
    await expect(createPlacesClient({ fetch: vi.fn().mockResolvedValue(new Response("{}", { status: 200 })), baseUrl }).searchCities("austin")).rejects.toMatchObject({ status: 200 });
  });
});
