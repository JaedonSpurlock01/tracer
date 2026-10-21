/**
 * -------------------------------------------------------------------------
 * @file   cloudflare-client.ts
 * @brief  Provides a narrow Cloudflare REST and GraphQL provider boundary.
 *
 * @description
 *  Verifies API tokens, discovers Sites from Workers scripts joined with
 *  their custom domains and Web Analytics site tags, lists Worker
 *  deployments, pulls per-day traffic from the GraphQL Analytics API, and
 *  captures Browser Rendering screenshots, without exposing provider
 *  response bodies or the token through errors.
 *
 * @remarks
 *  A Site is a Worker with at least one custom domain; its primary hostname
 *  is the apex (shortest, no `www.`). Web Vitals arrive in microseconds and
 *  `-1` means no sample, so they are converted to milliseconds or null here.
 *  Worker invocation rows are summed per date because the API returns one
 *  row per status.
 *
 * @see
 *  data/integrations.ts
 *  tests/contracts/cloudflare-client.test.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export interface CloudflareCredential {
  accountId: string;
  apiToken: string;
}

export interface CloudflareSiteHostname {
  hostname: string;
  zoneId: string;
  certificateId: string | null;
  enabled: boolean;
}

export interface CloudflareSite {
  scriptName: string;
  primaryHostname: string;
  zoneId: string;
  rumSiteTag: string | null;
  hostnames: CloudflareSiteHostname[];
}

export interface CloudflareDeployment {
  versionId: string;
  source: string;
  authorEmail: string | null;
  deployedAt: string;
}

export type CountedDimension = [string, number];

export interface CloudflareDailyTraffic {
  day: string;
  visits: number;
  pageViews: number;
  requests: number;
  errors: number;
  topPaths: CountedDimension[];
  referrers: CountedDimension[];
  devices: CountedDimension[];
  vitals: { lcpMs: number | null; inpMs: number | null; cls: number | null };
}

export interface CloudflareTrafficQuery {
  siteTag: string;
  scriptName: string;
  fromDate: string;
  toDate: string;
}

export type CloudflareClientErrorCode = "authentication_failed" | "provider_unavailable" | "invalid_response";

export class CloudflareClientError extends Error {
  constructor(public readonly code: CloudflareClientErrorCode, public readonly status: number | null) {
    super(code === "authentication_failed"
      ? `Cloudflare rejected the token (HTTP ${status ?? "unknown"})`
      : code === "invalid_response"
        ? `Cloudflare returned an unexpected response (HTTP ${status ?? "unknown"})`
        : status === null ? "Cloudflare is unavailable" : `Cloudflare request failed (HTTP ${status})`);
    this.name = "CloudflareClientError";
  }
}

export interface CloudflareClient {
  verifyToken(credential: CloudflareCredential): Promise<{ status: string }>;
  listSites(credential: CloudflareCredential): Promise<CloudflareSite[]>;
  listDeployments(credential: CloudflareCredential, scriptName: string, limit: number): Promise<CloudflareDeployment[]>;
  fetchDailyTraffic(credential: CloudflareCredential, query: CloudflareTrafficQuery): Promise<CloudflareDailyTraffic[]>;
  captureScreenshot(credential: CloudflareCredential, url: string): Promise<Uint8Array>;
}

interface Envelope<T> {
  success?: boolean;
  result?: T;
}

interface ScriptPayload {
  id: string;
}

interface DomainPayload {
  zone_id: string;
  hostname: string;
  service: string;
  cert_id?: string | null;
  enabled?: boolean;
}

interface RumSitePayload {
  site_tag: string;
  ruleset?: { zone_tag?: string };
}

interface DeploymentsPayload {
  deployments?: { source?: string; author_email?: string | null; created_on: string; versions?: { version_id: string }[] }[];
}

interface DatedCount<D extends Record<string, string>> {
  count?: number;
  sum?: { visits?: number; requests?: number; errors?: number };
  quantiles?: { largestContentfulPaintP75?: number; cumulativeLayoutShiftP75?: number; interactionToNextPaintP75?: number };
  dimensions: D & { date: string };
}

interface TrafficPayload {
  data?: {
    viewer?: {
      accounts?: {
        traffic?: DatedCount<Record<string, string>>[];
        paths?: DatedCount<{ requestPath: string }>[];
        referrers?: DatedCount<{ refererHost: string }>[];
        devices?: DatedCount<{ deviceType: string }>[];
        vitals?: DatedCount<Record<string, string>>[];
        workers?: DatedCount<Record<string, string>>[];
      }[];
    };
  } | null;
  errors?: { message: string }[] | null;
}

export const topPathLimit = 8;

const trafficQuery = `
query SiteDailyTraffic($accountTag: string!, $siteTag: string!, $scriptName: string!, $from: Time!, $to: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      traffic: rumPageloadEventsAdaptiveGroups(limit: 400, filter: { siteTag: $siteTag, datetime_geq: $from, datetime_leq: $to }, orderBy: [date_ASC]) {
        count
        sum { visits }
        dimensions { date }
      }
      paths: rumPageloadEventsAdaptiveGroups(limit: 2000, filter: { siteTag: $siteTag, datetime_geq: $from, datetime_leq: $to }, orderBy: [count_DESC]) {
        count
        dimensions { date requestPath }
      }
      referrers: rumPageloadEventsAdaptiveGroups(limit: 2000, filter: { siteTag: $siteTag, datetime_geq: $from, datetime_leq: $to }, orderBy: [count_DESC]) {
        count
        dimensions { date refererHost }
      }
      devices: rumPageloadEventsAdaptiveGroups(limit: 400, filter: { siteTag: $siteTag, datetime_geq: $from, datetime_leq: $to }, orderBy: [count_DESC]) {
        count
        dimensions { date deviceType }
      }
      vitals: rumWebVitalsEventsAdaptiveGroups(limit: 400, filter: { siteTag: $siteTag, datetime_geq: $from, datetime_leq: $to }) {
        count
        quantiles { largestContentfulPaintP75 cumulativeLayoutShiftP75 interactionToNextPaintP75 }
        dimensions { date }
      }
      workers: workersInvocationsAdaptive(limit: 2000, filter: { scriptName: $scriptName, datetime_geq: $from, datetime_leq: $to }) {
        sum { requests errors }
        dimensions { date }
      }
    }
  }
}`;

function isApex(hostname: string): boolean {
  return !hostname.startsWith("www.");
}

function compareHostnames(a: string, b: string): number {
  if (isApex(a) !== isApex(b)) return isApex(a) ? -1 : 1;
  return a.length - b.length || a.localeCompare(b);
}

function microsecondsToMs(value: number | undefined): number | null {
  return typeof value === "number" && value >= 0 ? Math.round(value / 1000) : null;
}

function countedDimensions<D extends Record<string, string>>(rows: DatedCount<D>[] | undefined, day: string, dimension: keyof D, limit?: number): CountedDimension[] {
  const counted = (rows ?? [])
    .filter((row) => row.dimensions.date === day)
    .map((row): CountedDimension => [row.dimensions[dimension], row.count ?? 0])
    .sort((a, b) => b[1] - a[1]);
  return limit === undefined ? counted : counted.slice(0, limit);
}

export function mapDailyTraffic(payload: TrafficPayload): CloudflareDailyTraffic[] {
  const account = payload.data?.viewer?.accounts?.[0] ?? {};
  const days = new Set<string>();
  for (const rows of [account.traffic, account.paths, account.referrers, account.devices, account.vitals, account.workers]) {
    for (const row of rows ?? []) days.add(row.dimensions.date);
  }
  return [...days].sort().map((day) => {
    const traffic = (account.traffic ?? []).filter((row) => row.dimensions.date === day);
    const workers = (account.workers ?? []).filter((row) => row.dimensions.date === day);
    const vitals = (account.vitals ?? []).find((row) => row.dimensions.date === day)?.quantiles;
    const cls = vitals?.cumulativeLayoutShiftP75;
    return {
      day,
      visits: traffic.reduce((total, row) => total + (row.sum?.visits ?? 0), 0),
      pageViews: traffic.reduce((total, row) => total + (row.count ?? 0), 0),
      requests: workers.reduce((total, row) => total + (row.sum?.requests ?? 0), 0),
      errors: workers.reduce((total, row) => total + (row.sum?.errors ?? 0), 0),
      topPaths: countedDimensions(account.paths, day, "requestPath", topPathLimit),
      referrers: countedDimensions(account.referrers, day, "refererHost"),
      devices: countedDimensions(account.devices, day, "deviceType"),
      vitals: {
        lcpMs: microsecondsToMs(vitals?.largestContentfulPaintP75),
        inpMs: microsecondsToMs(vitals?.interactionToNextPaintP75),
        cls: typeof cls === "number" && cls >= 0 ? cls : null,
      },
    };
  });
}

export function createCloudflareClient(options: { fetch?: typeof fetch; baseUrl?: string } = {}): CloudflareClient {
  const request = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? "https://api.cloudflare.com/client/v4").replace(/\/$/, "");

  async function send(path: string, credential: CloudflareCredential, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await request(`${baseUrl}${path}`, { ...init, headers: { Authorization: `Bearer ${credential.apiToken}`, ...(init.headers as Record<string, string> | undefined) } });
    } catch {
      throw new CloudflareClientError("provider_unavailable", null);
    }
    if (response.status === 401 || response.status === 403) {
      throw new CloudflareClientError("authentication_failed", response.status);
    }
    if (!response.ok) {
      throw new CloudflareClientError("provider_unavailable", response.status);
    }
    return response;
  }

  async function json<T>(response: Response): Promise<T> {
    try {
      return await response.json() as T;
    } catch {
      throw new CloudflareClientError("invalid_response", response.status);
    }
  }

  async function get<T>(path: string, credential: CloudflareCredential): Promise<T> {
    const response = await send(path, credential);
    const envelope = await json<Envelope<T>>(response);
    if (envelope.success === false || envelope.result === undefined || envelope.result === null) {
      throw new CloudflareClientError("invalid_response", response.status);
    }
    return envelope.result;
  }

  return {
    async verifyToken(credential) {
      const result = await get<{ status?: string }>("/user/tokens/verify", credential);
      if (result.status !== "active") throw new CloudflareClientError("authentication_failed", 200);
      return { status: result.status };
    },

    async listSites(credential) {
      const [scripts, domains, rumSites] = await Promise.all([
        get<ScriptPayload[]>(`/accounts/${credential.accountId}/workers/scripts`, credential),
        get<DomainPayload[]>(`/accounts/${credential.accountId}/workers/domains`, credential),
        get<RumSitePayload[]>(`/accounts/${credential.accountId}/rum/site_info/list`, credential),
      ]);
      const siteTags = new Map(rumSites.flatMap((site) => (site.ruleset?.zone_tag ? [[site.ruleset.zone_tag, site.site_tag] as const] : [])));
      return scripts
        .map((script) => script.id)
        .sort()
        .flatMap((scriptName) => {
          const hostnames = domains
            .filter((domain) => domain.service === scriptName)
            .map((domain): CloudflareSiteHostname => ({ hostname: domain.hostname, zoneId: domain.zone_id, certificateId: domain.cert_id ?? null, enabled: domain.enabled !== false }))
            .sort((a, b) => compareHostnames(a.hostname, b.hostname));
          if (!hostnames.length) return [];
          const primary = hostnames[0];
          return [{ scriptName, primaryHostname: primary.hostname, zoneId: primary.zoneId, rumSiteTag: siteTags.get(primary.zoneId) ?? null, hostnames }];
        });
    },

    async listDeployments(credential, scriptName, limit) {
      const result = await get<DeploymentsPayload>(`/accounts/${credential.accountId}/workers/scripts/${encodeURIComponent(scriptName)}/deployments`, credential);
      return (result.deployments ?? [])
        .flatMap((deployment) => {
          const versionId = deployment.versions?.[0]?.version_id;
          const deployedAt = Date.parse(deployment.created_on);
          if (!versionId || Number.isNaN(deployedAt)) return [];
          return [{ versionId, source: deployment.source ?? "unknown", authorEmail: deployment.author_email ?? null, deployedAt: new Date(deployedAt).toISOString() }];
        })
        .sort((a, b) => b.deployedAt.localeCompare(a.deployedAt))
        .slice(0, limit);
    },

    async fetchDailyTraffic(credential, query) {
      const response = await send("/graphql", credential, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: trafficQuery,
          variables: { accountTag: credential.accountId, siteTag: query.siteTag, scriptName: query.scriptName, from: `${query.fromDate}T00:00:00Z`, to: `${query.toDate}T23:59:59Z` },
        }),
      });
      const payload = await json<TrafficPayload>(response);
      if (payload.errors?.length || !payload.data) throw new CloudflareClientError("invalid_response", response.status);
      return mapDailyTraffic(payload);
    },

    async captureScreenshot(credential, url) {
      const response = await send(`/accounts/${credential.accountId}/browser-rendering/screenshot`, credential, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, viewport: { width: 1280, height: 800 }, screenshotOptions: { type: "jpeg", quality: 80 } }),
      });
      try {
        return new Uint8Array(await response.arrayBuffer());
      } catch {
        throw new CloudflareClientError("provider_unavailable", null);
      }
    },
  };
}
