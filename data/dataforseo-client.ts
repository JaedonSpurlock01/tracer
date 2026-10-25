/**
 * -------------------------------------------------------------------------
 * @file   dataforseo-client.ts
 * @brief  Provides a narrow DataForSEO provider boundary.
 *
 * @description
 *  Verifies an API login and password against the user data endpoint,
 *  runs one Google organic live advanced SERP task per Keyword, returning
 *  the organic, featured snippet, local pack, and map items with their
 *  type and absolute position, and lists a country's SERP locations, all
 *  without exposing provider response bodies or the credential through
 *  errors.
 *
 * @remarks
 *  DataForSEO answers HTTP 200 with a 401xx status code for a bad
 *  credential as often as it answers HTTP 401, so both read as
 *  authentication_failed. A task the envelope accepted but DataForSEO
 *  refused (an unknown location, for example) is task_failed and carries
 *  the task's status message, so the Operator reads why instead of a
 *  generic outage. The advanced endpoint costs the same as regular and is
 *  the only one that returns local pack and map items, which is where a
 *  local lead-generation Site most often ranks. The absolute rank counts
 *  every SERP feature above an item, which is the position a searcher
 *  sees.
 *
 * @see
 *  data/dataforseo-connection.ts
 *  tests/contracts/dataforseo-client.test.ts
 *  https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/
 *  https://docs.dataforseo.com/v3/serp/google/locations/
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export interface DataForSeoCredential {
  login: string;
  password: string;
}

/** One of locationCode or locationName names the searcher's location; the code is the DataForSEO location the Service Area picked. */
export interface DataForSeoSerpQuery {
  keyword: string;
  locationCode?: number;
  locationName?: string;
  languageCode: "en";
  depth: 100;
}

export type DataForSeoSerpItemType = "organic" | "featured_snippet" | "local_pack" | "map";

export interface DataForSeoSerpItem {
  position: number;
  type: DataForSeoSerpItemType;
  domain: string;
  url: string;
  title: string;
}

export interface DataForSeoLocation {
  code: number;
  name: string;
  kind: string;
}

export type DataForSeoClientErrorCode = "authentication_failed" | "provider_unavailable" | "invalid_response" | "task_failed";

export class DataForSeoClientError extends Error {
  constructor(public readonly code: DataForSeoClientErrorCode, public readonly status: number | null, taskMessage?: string) {
    super(code === "authentication_failed"
      ? `DataForSEO rejected the credential (HTTP ${status ?? "unknown"})`
      : code === "invalid_response"
        ? `DataForSEO returned an unexpected response (HTTP ${status ?? "unknown"})`
        : code === "task_failed"
          ? `DataForSEO rejected the task${status === null ? "" : ` (${status})`}: ${taskMessage ?? "no reason given"}`
          : status === null ? "DataForSEO is unavailable" : `DataForSEO request failed (HTTP ${status})`);
    this.name = "DataForSeoClientError";
  }
}

export interface DataForSeoClient {
  verify(credential: DataForSeoCredential): Promise<{ login: string }>;
  serp(credential: DataForSeoCredential, query: DataForSeoSerpQuery): Promise<{ items: DataForSeoSerpItem[] }>;
  /** Every Google SERP location DataForSEO knows for a country (ISO 3166-1 alpha-2, lower case). */
  listLocations(credential: DataForSeoCredential, countryIso: string): Promise<DataForSeoLocation[]>;
}

interface Envelope<T> {
  status_code?: number;
  tasks?: { status_code?: number; status_message?: string; result?: T[] | null }[];
}

interface UserDataResult {
  login?: string;
}

interface SerpResult {
  items?: { type?: string; rank_absolute?: number; domain?: string | null; url?: string | null; title?: string | null }[] | null;
}

interface LocationResult {
  location_code?: number;
  location_name?: string;
  location_type?: string;
}

const serpItemTypes: readonly DataForSeoSerpItemType[] = ["organic", "featured_snippet", "local_pack", "map"];

function isSerpItemType(value: unknown): value is DataForSeoSerpItemType {
  return typeof value === "string" && (serpItemTypes as readonly string[]).includes(value);
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isAuthenticationStatus(statusCode: number | undefined): boolean {
  return typeof statusCode === "number" && statusCode >= 40100 && statusCode < 40200;
}

export function createDataForSeoClient(options: { fetch?: typeof fetch; baseUrl?: string } = {}): DataForSeoClient {
  const request = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? "https://api.dataforseo.com/v3").replace(/\/$/, "");

  /** Sends one request and returns the first task's result list; a task DataForSEO refused reports its status and message. */
  async function sendAll<T>(path: string, credential: DataForSeoCredential, init: RequestInit = {}): Promise<T[]> {
    const authorization = `Basic ${Buffer.from(`${credential.login}:${credential.password}`).toString("base64")}`;
    let response: Response;
    try {
      response = await request(`${baseUrl}${path}`, { ...init, headers: { Authorization: authorization, ...(init.headers as Record<string, string> | undefined) } });
    } catch {
      throw new DataForSeoClientError("provider_unavailable", null);
    }
    if (response.status === 401 || response.status === 403) throw new DataForSeoClientError("authentication_failed", response.status);
    if (!response.ok) throw new DataForSeoClientError("provider_unavailable", response.status);
    let envelope: Envelope<T>;
    try {
      envelope = await response.json() as Envelope<T>;
    } catch {
      throw new DataForSeoClientError("invalid_response", response.status);
    }
    if (isAuthenticationStatus(envelope.status_code)) throw new DataForSeoClientError("authentication_failed", response.status);
    const task = envelope.tasks?.[0];
    if (envelope.status_code !== 20000 || !task) throw new DataForSeoClientError("invalid_response", response.status);
    if (isAuthenticationStatus(task.status_code)) throw new DataForSeoClientError("authentication_failed", response.status);
    if (task.status_code !== 20000) throw new DataForSeoClientError("task_failed", task.status_code ?? null, task.status_message);
    if (!Array.isArray(task.result)) throw new DataForSeoClientError("invalid_response", response.status);
    return task.result;
  }

  async function send<T>(path: string, credential: DataForSeoCredential, init: RequestInit = {}): Promise<T> {
    const [result] = await sendAll<T>(path, credential, init);
    if (result === undefined || result === null) throw new DataForSeoClientError("invalid_response", 200);
    return result;
  }

  return {
    async verify(credential) {
      const result = await send<UserDataResult>("/appendix/user_data", credential);
      if (typeof result.login !== "string") throw new DataForSeoClientError("invalid_response", 200);
      return { login: result.login };
    },

    async serp(credential, query) {
      const location = query.locationCode !== undefined ? { location_code: query.locationCode } : { location_name: query.locationName };
      const result = await send<SerpResult>("/serp/google/organic/live/advanced", credential, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ keyword: query.keyword, ...location, language_code: query.languageCode, depth: query.depth }]),
      });
      const items = (result.items ?? []).flatMap((item): DataForSeoSerpItem[] => {
        if (!isSerpItemType(item.type) || typeof item.rank_absolute !== "number" || !item.url) return [];
        const domain = item.domain ?? hostnameOf(item.url);
        if (!domain) return [];
        return [{ position: item.rank_absolute, type: item.type, domain, url: item.url, title: item.title ?? "" }];
      });
      return { items };
    },

    async listLocations(credential, countryIso) {
      const rows = await sendAll<LocationResult>(`/serp/google/locations/${encodeURIComponent(countryIso.toLowerCase())}`, credential);
      return rows.flatMap((row): DataForSeoLocation[] =>
        typeof row.location_code === "number" && typeof row.location_name === "string" ? [{ code: row.location_code, name: row.location_name, kind: row.location_type ?? "Unknown" }] : [],
      );
    },
  };
}
