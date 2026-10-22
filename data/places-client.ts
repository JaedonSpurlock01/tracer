/**
 * -------------------------------------------------------------------------
 * @file   places-client.ts
 * @brief  Looks up cities through the Photon geocoder.
 *
 * @description
 *  Searches Photon, komoot's free OpenStreetMap geocoder, for cities,
 *  towns, and villages matching typed text and returns each with a
 *  readable label and its point, for the Business city field.
 *
 * @remarks
 *  Photon needs no credential and is used under its fair-use terms:
 *  the Business form asks only after a short pause in typing and for at
 *  most five results. The client takes fetch and the base URL so a
 *  contract test runs against a recorded response.
 *
 * @see
 *  data/business.ts
 *  https://photon.komoot.io
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export interface PlaceRecord {
  /** The city, region, and country joined for display and storage. */
  label: string;
  latitude: number;
  longitude: number;
}

export interface PlacesClient {
  searchCities(query: string): Promise<PlaceRecord[]>;
}

export class PlacesClientError extends Error {
  constructor(public readonly status: number | null) {
    super(status === null ? "City lookup is unavailable" : `City lookup failed (HTTP ${status})`);
    this.name = "PlacesClientError";
  }
}

export const placesBaseUrl = "https://photon.komoot.io";

type PhotonFeature = { properties?: { name?: unknown; state?: unknown; country?: unknown }; geometry?: { coordinates?: unknown } };

export function createPlacesClient(options: { fetch?: typeof fetch; baseUrl?: string } = {}): PlacesClient {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl ?? placesBaseUrl;
  return {
    async searchCities(query) {
      const trimmed = query.trim();
      if (trimmed.length < 2) return [];
      const url = `${baseUrl}/api/?q=${encodeURIComponent(trimmed)}&limit=5&lang=en&layer=city`;
      let response: Response;
      try {
        response = await fetchImpl(url, { headers: { accept: "application/json" } });
      } catch {
        throw new PlacesClientError(null);
      }
      if (!response.ok) throw new PlacesClientError(response.status);
      const body = (await response.json().catch(() => null)) as { features?: unknown } | null;
      if (!body || !Array.isArray(body.features)) throw new PlacesClientError(response.status);
      const places: PlaceRecord[] = [];
      for (const feature of body.features as PhotonFeature[]) {
        const { name, state, country } = feature.properties ?? {};
        const coordinates = feature.geometry?.coordinates;
        if (typeof name !== "string" || !Array.isArray(coordinates) || typeof coordinates[0] !== "number" || typeof coordinates[1] !== "number") continue;
        const label = [name, typeof state === "string" ? state : null, typeof country === "string" ? country : null].filter(Boolean).join(", ");
        if (!places.some((place) => place.label === label)) places.push({ label, latitude: coordinates[1], longitude: coordinates[0] });
      }
      return places;
    },
  };
}
