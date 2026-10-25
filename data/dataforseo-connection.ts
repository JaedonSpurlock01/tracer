/**
 * -------------------------------------------------------------------------
 * @file   dataforseo-connection.ts
 * @brief  Provides the Organization-scoped DataForSEO connection operations.
 *
 * @description
 *  Stores the encrypted DataForSEO API password beside its login, verifies
 *  the credential on connect, Test, and rotate, counts the Organization's
 *  live Keywords and this month's lookups for the Integrations card (Rank
 *  Check and Keyword Discovery each record theirs here), and removes the
 *  credential on disconnect. Keywords and stored positions
 *  stay when the provider is disconnected.
 *
 * @remarks
 *  Lookups this month read as zero whenever the stored month is not the
 *  current month, so the counter resets without a scheduled job. A
 *  PostgreSQL advisory lock serializes credential mutations like the
 *  Twilio and Cloudflare connections.
 *
 * @see
 *  data/dataforseo-client.ts
 *  data/integrations.ts
 *  data/rank-check.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Database, Queryable, Transaction } from "@/data/database";

import { DataForSeoClientError, type DataForSeoClient, type DataForSeoCredential } from "@/data/dataforseo-client";
import { IntegrationsError } from "@/data/integrations-error";
import { credentialReadability, openSecret, recordConnectionFailure, recordConnectionVerified, sealSecret, type CredentialState } from "@/data/provider-credential";

export interface DataForSeoConnectionRecord {
  /** Whether the deployment's master key can open the stored secret; Unreadable needs Re-enter credential or Disconnect. */
  credentialState: CredentialState;
  login: string;
  connectedAt: string;
  connectedBy: { id: string; name: string } | null;
  lastVerifiedAt: string | null;
  lastFailureAt: string | null;
  lastFailureDetail: string | null;
  lastCheckedAt: string | null;
  lookupsThisMonth: number;
  keywordCount: number;
}

export interface DataForSeoConnection {
  getDataForSeoConnection(client?: Queryable): Promise<DataForSeoConnectionRecord | null>;
  withDataForSeoCredential<T>(operation: (credential: DataForSeoCredential) => Promise<T>): Promise<T>;
  connectDataForSeo(input: { login: string; password: string; actorUserId: string }): Promise<DataForSeoConnectionRecord>;
  testDataForSeo(): Promise<DataForSeoConnectionRecord>;
  rotateDataForSeoPassword(input: { password: string }): Promise<DataForSeoConnectionRecord>;
  disconnectDataForSeo(): Promise<void>;
}

export interface DataForSeoConnectionOptions {
  database: Database;
  organizationId: string;
  dataforseo: DataForSeoClient;
  masterKey: string | undefined;
}

type ConnectionRow = {
  login: string;
  password_ciphertext: string;
  master_key_fingerprint: string | null;
  connected_at: Date;
  connected_by_id: string | null;
  connected_by_name: string | null;
  last_verified_at: Date | null;
  last_failure_at: Date | null;
  last_failure_detail: string | null;
  last_checked_at: Date | null;
  lookups_this_month: number;
  keyword_count: number;
};

const connectionQuery = `
  select c.login, c.password_ciphertext, c.master_key_fingerprint, c.connected_at, c.connected_by_user_id as connected_by_id, u.name as connected_by_name,
         c.last_verified_at, c.last_failure_at, c.last_failure_detail, c.last_checked_at,
         case when c.lookups_month = date_trunc('month', current_date)::date then c.lookups_this_month else 0 end as lookups_this_month,
         (select count(*) from site_keyword k join site s on s.id = k.site_id
           where s.organization_id = c.organization_id and s.removed_at is null and k.removed_at is null)::int as keyword_count
    from dataforseo_connection c
    left join "user" u on u.id = c.connected_by_user_id
   where c.organization_id = $1
`;

function toConnectionRecord(row: ConnectionRow, credentialState: CredentialState): DataForSeoConnectionRecord {
  return {
    credentialState,
    login: row.login,
    connectedAt: row.connected_at.toISOString(),
    connectedBy: row.connected_by_id && row.connected_by_name ? { id: row.connected_by_id, name: row.connected_by_name } : null,
    lastVerifiedAt: row.last_verified_at?.toISOString() ?? null,
    lastFailureAt: row.last_failure_at?.toISOString() ?? null,
    lastFailureDetail: row.last_failure_detail,
    lastCheckedAt: row.last_checked_at?.toISOString() ?? null,
    lookupsThisMonth: Number(row.lookups_this_month),
    keywordCount: Number(row.keyword_count),
  };
}

/** Counts one billed DataForSEO request on the Organization's connection for the current UTC month; the counter resets when the month changes. */
export async function recordDataForSeoLookup(client: Queryable, organizationId: string, now: Date): Promise<void> {
  const month = `${now.toISOString().slice(0, 7)}-01`;
  await client.query(
    `update dataforseo_connection
        set lookups_this_month = case when lookups_month = $2::date then lookups_this_month + 1 else 1 end,
            lookups_month = $2::date, updated_at = $3
      where organization_id = $1`,
    [organizationId, month, now],
  );
}

function providerFailure(error: unknown): IntegrationsError {
  if (error instanceof DataForSeoClientError && error.code === "authentication_failed") {
    return new IntegrationsError("authentication_failed", error.message);
  }
  return new IntegrationsError("provider_unavailable", error instanceof DataForSeoClientError ? error.message : "DataForSEO is unavailable");
}

export function createDataForSeoConnection(options: DataForSeoConnectionOptions): DataForSeoConnection {
  const lock = "tracer:dataforseo:" + options.organizationId;
  const transaction = <T>(operation: (client: Transaction) => Promise<T>) => options.database.transaction(operation, { lock });

  async function selectConnection(client: Queryable): Promise<ConnectionRow | null> {
    const result = await client.query<ConnectionRow>(connectionQuery, [options.organizationId]);
    return result.rows[0] ?? null;
  }


  async function recordFailure(error: IntegrationsError): Promise<void> {
    await recordConnectionFailure(options.database, "dataforseo_connection", lock, options.organizationId, error);
  }

  async function recordOf(row: ConnectionRow): Promise<DataForSeoConnectionRecord> {
    const readability = await credentialReadability({ fingerprint: row.master_key_fingerprint, masterKey: options.masterKey });
    return toConnectionRecord(row, readability === "readable" ? "readable" : "unreadable");
  }

  /** Opens the stored password; an Unreadable credential is recorded on the connection before it is reported. */
  async function decryptConnection(row: ConnectionRow): Promise<DataForSeoCredential> {
    try {
      return { login: row.login, password: await openSecret(options.masterKey, { ciphertext: row.password_ciphertext, fingerprint: row.master_key_fingerprint }) };
    } catch (error) {
      if (error instanceof IntegrationsError && error.code === "credential_unreadable") await recordFailure(error);
      throw error;
    }
  }

  async function verifyCredential(credential: DataForSeoCredential): Promise<void> {
    try {
      await options.dataforseo.verify(credential);
    } catch (error) {
      throw providerFailure(error);
    }
  }

  async function requireConnection(client: Queryable): Promise<ConnectionRow> {
    const row = await selectConnection(client);
    if (!row) throw new IntegrationsError("not_connected");
    return row;
  }

  async function recordVerified(client: Queryable, now: Date): Promise<DataForSeoConnectionRecord> {
    await recordConnectionVerified(client, "dataforseo_connection", options.organizationId, now);
    return recordOf(await requireConnection(client));
  }

  return {
    async getDataForSeoConnection(client) {
      const row = await selectConnection(client ?? options.database);
      return row ? recordOf(row) : null;
    },

    async withDataForSeoCredential(operation) {
      const credential = await decryptConnection(await requireConnection(options.database));
      try {
        return await operation(credential);
      } catch (error) {
        if (!(error instanceof DataForSeoClientError)) throw error;
        const failure = providerFailure(error);
        await recordFailure(failure);
        throw failure;
      }
    },

    async connectDataForSeo(input) {
      const login = input.login.trim();
      const password = input.password.trim();
      if (!login || !password) throw new IntegrationsError("invalid_input");
      const masterKey = options.masterKey;
      if (!masterKey) throw new IntegrationsError("master_key_missing");
      return transaction(async (client) => {
        if (await selectConnection(client)) throw new IntegrationsError("already_connected");
        await verifyCredential({ login, password });
        const now = new Date();
        const sealed = await sealSecret(masterKey, password);
        await client.query(
          `insert into dataforseo_connection
             (id, organization_id, login, password_ciphertext, master_key_fingerprint, connected_by_user_id, connected_at, last_verified_at, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $7, $7, $7)`,
          [randomUUID(), options.organizationId, login, sealed.ciphertext, sealed.fingerprint, input.actorUserId, now],
        );
        return recordOf(await requireConnection(client));
      });
    },

    async testDataForSeo() {
      const credential = await decryptConnection(await requireConnection(options.database));
      try {
        await verifyCredential(credential);
      } catch (error) {
        const failure = error instanceof IntegrationsError ? error : providerFailure(error);
        await recordFailure(failure);
        throw failure;
      }
      return transaction(async (client) => {
        return recordVerified(client, new Date());
      });
    },

    async rotateDataForSeoPassword(input) {
      const password = input.password.trim();
      if (!password) throw new IntegrationsError("invalid_input");
      const masterKey = options.masterKey;
      if (!masterKey) throw new IntegrationsError("master_key_missing");
      return transaction(async (client) => {
        const current = await requireConnection(client);
        await verifyCredential({ login: current.login, password });
        const now = new Date();
        const sealed = await sealSecret(masterKey, password);
        await client.query(
          "update dataforseo_connection set password_ciphertext = $2, master_key_fingerprint = $3, updated_at = $4 where organization_id = $1",
          [options.organizationId, sealed.ciphertext, sealed.fingerprint, now],
        );
        return recordVerified(client, now);
      });
    },

    async disconnectDataForSeo() {
      await transaction(async (client) => {
        await requireConnection(client);
        await client.query("delete from dataforseo_connection where organization_id = $1", [options.organizationId]);
      });
    },
  };
}
