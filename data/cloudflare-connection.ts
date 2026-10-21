/**
 * -------------------------------------------------------------------------
 * @file   cloudflare-connection.ts
 * @brief  Provides the Organization-scoped Cloudflare connection operations.
 *
 * @description
 *  Stores the encrypted Cloudflare API token, verifies it on connect, Test,
 *  and rotate, discovers Sites (Workers with at least one custom domain)
 *  into `site` and `site_hostname`, lists them with their link state and
 *  30-day visits, and removes the credential on disconnect while any open
 *  Site Link blocks it.
 *
 * @remarks
 *  Discovery is an upsert keyed by Organization and script name: a Worker
 *  that lost every custom domain is marked removed rather than deleted, and
 *  returns when a domain is attached again. Hostnames that disappear are
 *  marked disabled because the runtime role cannot delete them. A
 *  PostgreSQL advisory lock serializes credential and discovery mutations.
 *
 * @see
 *  data/cloudflare-client.ts
 *  data/integrations.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { CloudflareClientError, type CloudflareClient, type CloudflareCredential, type CloudflareSite } from "@/data/cloudflare-client";
import { decryptSecret, encryptSecret } from "@/data/credential-encryption";
import { IntegrationsError } from "@/data/integrations-error";
import { decideCloudflareDisconnect, isCloudflareAccountId } from "@/data/integrations-policy";
import type { SiteHealth } from "@/data/site-health";
import { siteHealthFromRow, siteHealthInputJsonSql, type SiteHealthRow } from "@/data/site-health-query";

export interface CloudflareConnectionRecord {
  accountId: string;
  connectedAt: string;
  connectedBy: { id: string; name: string } | null;
  lastVerifiedAt: string | null;
  lastFailureAt: string | null;
  lastFailureDetail: string | null;
  lastSyncedAt: string | null;
  siteCount: number;
}

export interface CloudflareSiteListEntry {
  id: string;
  scriptName: string;
  primaryHostname: string;
  hostnames: { hostname: string; certificateId: string | null; enabled: boolean }[];
  lastDeployedAt: string | null;
  liveVersionId: string | null;
  linkedWorkspace: { id: string; name: string } | null;
  visits30d: number;
  health: SiteHealth;
  healthReason: string | null;
}

export interface CloudflareConnection {
  getCloudflareConnection(client?: Pool | PoolClient): Promise<CloudflareConnectionRecord | null>;
  withCloudflareCredential<T>(operation: (credential: CloudflareCredential) => Promise<T>): Promise<T>;
  connectCloudflare(input: { accountId: string; apiToken: string; actorUserId: string }): Promise<CloudflareConnectionRecord>;
  testCloudflare(): Promise<CloudflareConnectionRecord>;
  rotateCloudflareToken(input: { apiToken: string }): Promise<CloudflareConnectionRecord>;
  disconnectCloudflare(): Promise<void>;
  syncSites(): Promise<{ siteCount: number; syncedAt: string }>;
  listCloudflareSites(): Promise<CloudflareSiteListEntry[]>;
}

export interface CloudflareConnectionOptions {
  pool: Pool;
  organizationId: string;
  cloudflare: CloudflareClient;
  masterKey: string | undefined;
}

type ConnectionRow = {
  account_id: string;
  api_token_ciphertext: string;
  connected_at: Date;
  connected_by_id: string | null;
  connected_by_name: string | null;
  last_verified_at: Date | null;
  last_failure_at: Date | null;
  last_failure_detail: string | null;
  last_synced_at: Date | null;
  site_count: number;
};

type SiteListRow = SiteHealthRow & {
  id: string;
  script_name: string;
  primary_hostname: string;
  hostnames: { hostname: string; certificateId: string | null; enabled: boolean }[];
  last_deployed_at: Date | null;
  live_version_id: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
  visits_30d: number;
};

const connectionQuery = `
  select c.account_id, c.api_token_ciphertext, c.connected_at, c.connected_by_user_id as connected_by_id,
         u.name as connected_by_name, c.last_verified_at, c.last_failure_at, c.last_failure_detail, c.last_synced_at,
         (select count(*) from site s where s.organization_id = c.organization_id and s.removed_at is null)::int as site_count
    from cloudflare_connection c
    left join "user" u on u.id = c.connected_by_user_id
   where c.organization_id = $1
`;

export const siteHostnamesJsonSql = (siteAlias: string) => `
  coalesce((select json_agg(json_build_object('hostname', h.hostname, 'certificateId', h.certificate_id, 'enabled', h.enabled)
                            order by (h.hostname like 'www.%'), length(h.hostname), h.hostname)
              from site_hostname h where h.site_id = ${siteAlias}.id), '[]'::json)`;

const siteListQuery = `
  select s.id, s.script_name, s.primary_hostname, s.last_deployed_at, s.live_version_id,
         ${siteHostnamesJsonSql("s")} as hostnames,
         w.id as workspace_id, w.name as workspace_name,
         coalesce((select sum(m.visits) from site_metric_day m where m.site_id = s.id and m.day >= current_date - 29), 0)::int as visits_30d,
         c.last_synced_at, ${siteHealthInputJsonSql("s")} as health_input
    from site s
    left join site_link l on l.site_id = s.id and l.ended_at is null
    left join workspace w on w.id = l.workspace_id
    left join cloudflare_connection c on c.organization_id = s.organization_id
   where s.organization_id = $1 and s.removed_at is null
   order by s.primary_hostname, s.id
`;

function toConnectionRecord(row: ConnectionRow): CloudflareConnectionRecord {
  return {
    accountId: row.account_id,
    connectedAt: row.connected_at.toISOString(),
    connectedBy: row.connected_by_id && row.connected_by_name ? { id: row.connected_by_id, name: row.connected_by_name } : null,
    lastVerifiedAt: row.last_verified_at?.toISOString() ?? null,
    lastFailureAt: row.last_failure_at?.toISOString() ?? null,
    lastFailureDetail: row.last_failure_detail,
    lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
    siteCount: Number(row.site_count),
  };
}

function providerFailure(error: unknown): IntegrationsError {
  if (error instanceof CloudflareClientError && error.code === "authentication_failed") {
    return new IntegrationsError("authentication_failed", error.message);
  }
  return new IntegrationsError("provider_unavailable", error instanceof CloudflareClientError ? error.message : "Cloudflare is unavailable");
}

async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertDiscoveredSites(client: PoolClient, organizationId: string, discovered: CloudflareSite[], now: Date): Promise<void> {
  for (const site of discovered) {
    const inserted = await client.query<{ id: string }>(
      `insert into site (id, organization_id, script_name, primary_hostname, zone_id, rum_site_tag, first_seen_at, last_seen_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $7, $7, $7)
       on conflict (organization_id, script_name) do update set
         primary_hostname = excluded.primary_hostname, zone_id = excluded.zone_id, rum_site_tag = excluded.rum_site_tag,
         last_seen_at = excluded.last_seen_at, removed_at = null, updated_at = excluded.updated_at
       returning id`,
      [randomUUID(), organizationId, site.scriptName, site.primaryHostname, site.zoneId, site.rumSiteTag, now],
    );
    const siteId = inserted.rows[0].id;
    for (const hostname of site.hostnames) {
      await client.query(
        `insert into site_hostname (id, site_id, hostname, zone_id, certificate_id, enabled, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $7)
         on conflict (site_id, hostname) do update set
           zone_id = excluded.zone_id, certificate_id = excluded.certificate_id, enabled = excluded.enabled, updated_at = excluded.updated_at`,
        [randomUUID(), siteId, hostname.hostname, hostname.zoneId, hostname.certificateId, hostname.enabled, now],
      );
    }
    await client.query(
      "update site_hostname set enabled = false, updated_at = $3 where site_id = $1 and enabled and not (hostname = any($2::text[]))",
      [siteId, site.hostnames.map((hostname) => hostname.hostname), now],
    );
  }
  await client.query(
    "update site set removed_at = $3, updated_at = $3 where organization_id = $1 and removed_at is null and not (script_name = any($2::text[]))",
    [organizationId, discovered.map((site) => site.scriptName), now],
  );
}

export function createCloudflareConnection(options: CloudflareConnectionOptions): CloudflareConnection {
  const lock = "tracer:cloudflare:" + options.organizationId;

  async function selectConnection(client: Pool | PoolClient): Promise<ConnectionRow | null> {
    const result = await client.query<ConnectionRow>(connectionQuery, [options.organizationId]);
    return result.rows[0] ?? null;
  }

  async function lockOrganization(client: PoolClient): Promise<void> {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [lock]);
  }

  async function recordFailure(error: IntegrationsError): Promise<void> {
    const now = new Date();
    await withTransaction(options.pool, async (client) => {
      await lockOrganization(client);
      await client.query(
        "update cloudflare_connection set last_failure_at = $2, last_failure_detail = $3, updated_at = $2 where organization_id = $1",
        [options.organizationId, now, error.detail ?? error.code],
      );
    });
  }

  async function decryptConnection(row: ConnectionRow): Promise<CloudflareCredential> {
    if (!options.masterKey) throw new IntegrationsError("master_key_missing");
    try {
      return { accountId: row.account_id, apiToken: await decryptSecret(options.masterKey, row.api_token_ciphertext) };
    } catch {
      throw new IntegrationsError("provider_unavailable", "Cloudflare credential could not be decrypted");
    }
  }

  async function verifyCredential(credential: CloudflareCredential): Promise<void> {
    try {
      await options.cloudflare.verifyToken(credential);
    } catch (error) {
      throw providerFailure(error);
    }
  }

  async function discover(credential: CloudflareCredential): Promise<CloudflareSite[]> {
    try {
      return await options.cloudflare.listSites(credential);
    } catch (error) {
      throw providerFailure(error);
    }
  }

  async function requireConnection(client: Pool | PoolClient): Promise<ConnectionRow> {
    const row = await selectConnection(client);
    if (!row) throw new IntegrationsError("not_connected");
    return row;
  }

  async function recordVerified(client: PoolClient, now: Date): Promise<CloudflareConnectionRecord> {
    await client.query(
      "update cloudflare_connection set last_verified_at = $2, last_failure_at = null, last_failure_detail = null, updated_at = $2 where organization_id = $1",
      [options.organizationId, now],
    );
    return toConnectionRecord(await requireConnection(client));
  }

  return {
    async getCloudflareConnection(client) {
      const row = await selectConnection(client ?? options.pool);
      return row ? toConnectionRecord(row) : null;
    },

    async withCloudflareCredential(operation) {
      const credential = await decryptConnection(await requireConnection(options.pool));
      try {
        return await operation(credential);
      } catch (error) {
        if (!(error instanceof CloudflareClientError)) throw error;
        const failure = providerFailure(error);
        await recordFailure(failure);
        throw failure;
      }
    },

    async connectCloudflare(input) {
      const accountId = input.accountId.trim().toLowerCase();
      const apiToken = input.apiToken.trim();
      if (!isCloudflareAccountId(accountId) || !apiToken) throw new IntegrationsError("invalid_input");
      const masterKey = options.masterKey;
      if (!masterKey) throw new IntegrationsError("master_key_missing");
      return withTransaction(options.pool, async (client) => {
        await lockOrganization(client);
        if (await selectConnection(client)) throw new IntegrationsError("already_connected");
        const credential = { accountId, apiToken };
        await verifyCredential(credential);
        const discovered = await discover(credential);
        const now = new Date();
        await client.query(
          `insert into cloudflare_connection
             (id, organization_id, account_id, api_token_ciphertext, connected_by_user_id, connected_at, last_verified_at, last_synced_at, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $6, $6, $6, $6)`,
          [randomUUID(), options.organizationId, accountId, await encryptSecret(masterKey, apiToken), input.actorUserId, now],
        );
        await upsertDiscoveredSites(client, options.organizationId, discovered, now);
        return toConnectionRecord(await requireConnection(client));
      });
    },

    async testCloudflare() {
      const credential = await decryptConnection(await requireConnection(options.pool));
      try {
        await verifyCredential(credential);
      } catch (error) {
        const failure = error instanceof IntegrationsError ? error : providerFailure(error);
        await recordFailure(failure);
        throw failure;
      }
      return withTransaction(options.pool, async (client) => {
        await lockOrganization(client);
        return recordVerified(client, new Date());
      });
    },

    async rotateCloudflareToken(input) {
      const apiToken = input.apiToken.trim();
      if (!apiToken) throw new IntegrationsError("invalid_input");
      const masterKey = options.masterKey;
      if (!masterKey) throw new IntegrationsError("master_key_missing");
      return withTransaction(options.pool, async (client) => {
        await lockOrganization(client);
        const current = await requireConnection(client);
        await verifyCredential({ accountId: current.account_id, apiToken });
        const now = new Date();
        await client.query(
          "update cloudflare_connection set api_token_ciphertext = $2, updated_at = $3 where organization_id = $1",
          [options.organizationId, await encryptSecret(masterKey, apiToken), now],
        );
        return recordVerified(client, now);
      });
    },

    async disconnectCloudflare() {
      await withTransaction(options.pool, async (client) => {
        await lockOrganization(client);
        await requireConnection(client);
        const open = await client.query<{ count: string }>("select count(*) from site_link where organization_id = $1 and ended_at is null", [options.organizationId]);
        const decision = decideCloudflareDisconnect({ openSiteLinkCount: Number(open.rows[0]?.count ?? 0) });
        if (!decision.allowed) throw new IntegrationsError("active_site_links", undefined, undefined, decision.openSiteLinkCount);
        await client.query("delete from cloudflare_connection where organization_id = $1", [options.organizationId]);
      });
    },

    async syncSites() {
      const credential = await decryptConnection(await requireConnection(options.pool));
      let discovered: CloudflareSite[];
      try {
        discovered = await discover(credential);
      } catch (error) {
        const failure = error instanceof IntegrationsError ? error : providerFailure(error);
        await recordFailure(failure);
        throw failure;
      }
      const syncedAt = new Date();
      return withTransaction(options.pool, async (client) => {
        await lockOrganization(client);
        await upsertDiscoveredSites(client, options.organizationId, discovered, syncedAt);
        await client.query("update cloudflare_connection set last_synced_at = $2, updated_at = $2 where organization_id = $1", [options.organizationId, syncedAt]);
        return { siteCount: discovered.length, syncedAt: syncedAt.toISOString() };
      });
    },

    async listCloudflareSites() {
      const result = await options.pool.query<SiteListRow>(siteListQuery, [options.organizationId]);
      return result.rows.map((row) => {
        const health = siteHealthFromRow(row);
        return {
          id: row.id,
          scriptName: row.script_name,
          primaryHostname: row.primary_hostname,
          hostnames: row.hostnames,
          lastDeployedAt: row.last_deployed_at?.toISOString() ?? null,
          liveVersionId: row.live_version_id,
          linkedWorkspace: row.workspace_id && row.workspace_name ? { id: row.workspace_id, name: row.workspace_name } : null,
          visits30d: Number(row.visits_30d),
          health: health.health,
          healthReason: health.reason,
        };
      });
    },
  };
}
