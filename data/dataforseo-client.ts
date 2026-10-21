/**
 * -------------------------------------------------------------------------
 * @file   dataforseo-client.ts
 * @brief  Provides a narrow DataForSEO provider boundary.
 *
 * @description
 *  Verifies an API login and password against the user data endpoint and
 *  runs one Google organic live regular SERP task per Keyword, returning
 *  only the organic items with their absolute position, domain, URL, and
 *  title, without exposing provider response bodies or the credential
 *  through errors.
 *
 * @remarks
 *  DataForSEO answers HTTP 200 with a 401xx status code for a bad
 *  credential as often as it answers HTTP 401, so both read as
 *  authentication_failed. A task-level error inside a successful envelope
 *  is an invalid response because the request itself was accepted. The
 *  absolute rank counts every SERP feature above an organic item, which
 *  is the position a searcher sees.
 *
 * @see
 *  data/dataforseo-connection.ts
 *  tests/contracts/dataforseo-client.test.ts
 *  https://docs.dataforseo.com/v3/serp/google/organic/live/regular/
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export interface DataForSeoCredential {
  login: string;
  password: string;
}

export interface DataForSeoSerpQuery {
  keyword: string;
  locationName: string;
  languageCode: "en";
  depth: 100;
}

export interface DataForSeoSerpItem {
  position: number;
  domain: string;
  url: string;
  title: string;
}

export type DataForSeoClientErrorCode = "authentication_failed" | "provider_unavailable" | "invalid_response";

export class DataForSeoClientError extends Error {
  constructor(public readonly code: DataForSeoClientErrorCode, public readonly status: number | null) {
    super(code === "authentication_failed"
      ? `DataForSEO rejected the credential (HTTP ${status ?? "unknown"})`
      : code === "invalid_response"
        ? `DataForSEO returned an unexpected response (HTTP ${status ?? "unknown"})`
        : status === null ? "DataForSEO is unavailable" : `DataForSEO request failed (HTTP ${status})`);
    this.name = "DataForSeoClientError";
  }
}

export interface DataForSeoClient {
  verify(credential: DataForSeoCredential): Promise<{ login: string }>;
  serp(credential: DataForSeoCredential, query: DataForSeoSerpQuery): Promise<{ items: DataForSeoSerpItem[] }>;
}

interface Envelope<T> {
  status_code?: number;
  tasks?: { status_code?: number; result?: T[] | null }[];
}

interface UserDataResult {
  login?: string;
}

interface SerpResult {
  items?: { type?: string; rank_absolute?: number; domain?: string | null; url?: string | null; title?: string | null }[] | null;
}

function isAuthenticationStatus(statusCode: number | undefined): boolean {
  return typeof statusCode === "number" && statusCode >= 40100 && statusCode < 40200;
}

export function createDataForSeoClient(options: { fetch?: typeof fetch; baseUrl?: string } = {}): DataForSeoClient {
  const request = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? "https://api.dataforseo.com/v3").replace(/\/$/, "");

  async function send<T>(path: string, credential: DataForSeoCredential, init: RequestInit = {}): Promise<T> {
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
    const result = task?.result?.[0];
    if (envelope.status_code !== 20000 || !task || task.status_code !== 20000 || result === undefined || result === null) {
      throw new DataForSeoClientError("invalid_response", response.status);
    }
    return result;
  }

  return {
    async verify(credential) {
      const result = await send<UserDataResult>("/appendix/user_data", credential);
      if (typeof result.login !== "string") throw new DataForSeoClientError("invalid_response", 200);
      return { login: result.login };
    },

    async serp(credential, query) {
      const result = await send<SerpResult>("/serp/google/organic/live/regular", credential, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ keyword: query.keyword, location_name: query.locationName, language_code: query.languageCode, depth: query.depth }]),
      });
      const items = (result.items ?? []).flatMap((item): DataForSeoSerpItem[] => {
        if (item.type !== "organic" || typeof item.rank_absolute !== "number" || !item.domain || !item.url) return [];
        return [{ position: item.rank_absolute, domain: item.domain, url: item.url, title: item.title ?? "" }];
      });
      return { items };
    },
  };
}
