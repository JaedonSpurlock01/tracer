/**
 * -------------------------------------------------------------------------
 * @file   integrations.ts
 * @brief  Provides Organization-scoped provider integration operations.
 *
 * @description
 *  Stores encrypted Twilio credentials, verifies provider access, syncs
 *  incoming number inventory, and reads Recording transfer, analysis, and
 *  media lifecycle health while isolating every query by Organization. The
 *  Cloudflare connection operations are composed in from
 *  data/cloudflare-connection.ts and the DataForSEO connection operations
 *  from data/dataforseo-connection.ts so one Integrations service serves
 *  the Integrations page.
 *
 * @remarks
 *  PostgreSQL advisory locks serialize credential and inventory mutations.
 *  Media lifecycle health is derived from the Recordings themselves rather
 *  than a stored sweep result: a purged or expired Recording whose
 *  `media_deleted_at` is still empty 26 hours after its purge or expiry is
 *  stuck, because the daily sweep has had one full run plus two hours of
 *  slack to finish it, and one whose Twilio copy is not deleted while the
 *  Organization has no Twilio connection is stuck at once, because the
 *  sweep cannot delete it until Twilio is reconnected.
 *
 * @see
 *  data/credential-encryption.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { CloudflareClientError, type CloudflareClient } from "@/data/cloudflare-client";
import { createCloudflareConnection, type CloudflareConnection } from "@/data/cloudflare-connection";
import { decryptSecret, encryptSecret } from "@/data/credential-encryption";
import { DataForSeoClientError, type DataForSeoClient } from "@/data/dataforseo-client";
import { createDataForSeoConnection, type DataForSeoConnection } from "@/data/dataforseo-connection";
import { IntegrationsError } from "@/data/integrations-error";
import { decideTwilioDisconnect, isTwilioAccountSid, isTwilioApiKeySid } from "@/data/integrations-policy";
import { normalizeE164PhoneNumber } from "@/data/phone-number";
import type { AnalysisProcessingHealth, MediaLifecycleHealth, RecordingTransferHealth } from "@/data/provider-health";
import { recordingMediaExpiredSql, recordingMediaExpiresAtSql } from "@/data/recording-media";
import { authTokenCredential, TwilioClientError, type TwilioClient, type TwilioCredential, type TwilioIncomingPhoneNumber } from "@/data/twilio-client";

export interface TwilioConnectionRecord {
  accountSid: string;
  apiKeySid: string;
  authTokenConfigured: boolean;
  accountFriendlyName: string | null;
  connectedAt: string;
  connectedBy: { id: string; name: string } | null;
  lastVerifiedAt: string | null;
  lastFailureAt: string | null;
  lastFailureDetail: string | null;
  numbersSyncedAt: string | null;
  numberCount: number;
}

export interface TwilioNumberRecord {
  id: string;
  twilioSid: string;
  phoneNumber: string;
  friendlyName: string;
  voiceCapable: boolean;
  voiceUrl: string | null;
  voiceMethod: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  releasedAt: string | null;
}

export { IntegrationsError, type IntegrationsErrorCode } from "@/data/integrations-error";

export interface IntegrationsOptions {
  pool: Pool;
  organizationId: string;
  twilio: TwilioClient;
  cloudflare?: CloudflareClient;
  dataforseo?: DataForSeoClient;
  masterKey: string | undefined;
  activeWorkspaceCount: () => Promise<number>;
}

export interface Integrations extends CloudflareConnection, DataForSeoConnection {
  getTwilioConnection(client?: Pool | PoolClient): Promise<TwilioConnectionRecord | null>;
  withTwilioCredential<T>(
    operation: (credential: TwilioCredential) => Promise<T>,
    context?: { client?: Pool | PoolClient; deferFailureRecording?: boolean },
  ): Promise<T>;
  recordTwilioFailure(error: unknown): Promise<IntegrationsError>;
  connectTwilio(input: {
    accountSid: string;
    apiKeySid: string;
    apiKeySecret: string;
    actorUserId: string;
  }): Promise<TwilioConnectionRecord>;
  testTwilio(): Promise<TwilioConnectionRecord>;
  rotateTwilioKey(input: { apiKeySid: string; apiKeySecret: string }): Promise<TwilioConnectionRecord>;
  setTwilioAuthToken(input: { authToken: string }): Promise<TwilioConnectionRecord>;
  disconnectTwilio(): Promise<void>;
  syncTwilioNumbers(): Promise<{ numbers: TwilioNumberRecord[]; syncedAt: string; skipped: number }>;
  listTwilioNumbers(): Promise<TwilioNumberRecord[]>;
  getRecordingTransferHealth(): Promise<RecordingTransferHealth>;
  getAnalysisProcessingHealth(): Promise<AnalysisProcessingHealth>;
  getMediaLifecycleHealth(): Promise<MediaLifecycleHealth>;
}

type ConnectionRow = {
  account_sid: string;
  api_key_sid: string;
  api_key_secret_ciphertext: string;
  auth_token_ciphertext: string | null;
  account_friendly_name: string | null;
  connected_at: Date;
  connected_by_id: string | null;
  connected_by_name: string | null;
  last_verified_at: Date | null;
  last_failure_at: Date | null;
  last_failure_detail: string | null;
  numbers_synced_at: Date | null;
  number_count: number;
};

type NumberRow = {
  id: string;
  twilio_sid: string;
  phone_number: string;
  friendly_name: string;
  voice_capable: boolean;
  voice_url: string | null;
  voice_method: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
  released_at: Date | null;
};

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

const connectionQuery = `
  select c.account_sid, c.api_key_sid, c.api_key_secret_ciphertext, c.auth_token_ciphertext,
         c.account_friendly_name, c.connected_at, c.connected_by_user_id as connected_by_id,
         u.name as connected_by_name, c.last_verified_at, c.last_failure_at,
         c.last_failure_detail, c.numbers_synced_at, count(n.id)::int as number_count
    from twilio_connection c
    left join "user" u on u.id = c.connected_by_user_id
    left join twilio_number n on n.organization_id = c.organization_id and n.released_at is null
   where c.organization_id = $1
   group by c.account_sid, c.api_key_sid, c.api_key_secret_ciphertext, c.auth_token_ciphertext,
            c.account_friendly_name, c.connected_at, c.connected_by_user_id,
            u.name, c.last_verified_at, c.last_failure_at,
            c.last_failure_detail, c.numbers_synced_at
`;

function toConnectionRecord(row: ConnectionRow): TwilioConnectionRecord {
  return {
    accountSid: row.account_sid,
    apiKeySid: row.api_key_sid,
    authTokenConfigured: row.auth_token_ciphertext !== null,
    accountFriendlyName: row.account_friendly_name,
    connectedAt: row.connected_at.toISOString(),
    connectedBy: row.connected_by_id && row.connected_by_name ? { id: row.connected_by_id, name: row.connected_by_name } : null,
    lastVerifiedAt: row.last_verified_at?.toISOString() ?? null,
    lastFailureAt: row.last_failure_at?.toISOString() ?? null,
    lastFailureDetail: row.last_failure_detail,
    numbersSyncedAt: row.numbers_synced_at?.toISOString() ?? null,
    numberCount: Number(row.number_count),
  };
}

function toNumberRecord(row: NumberRow): TwilioNumberRecord {
  return {
    id: row.id,
    twilioSid: row.twilio_sid,
    phoneNumber: row.phone_number,
    friendlyName: row.friendly_name,
    voiceCapable: row.voice_capable,
    voiceUrl: row.voice_url,
    voiceMethod: row.voice_method,
    firstSeenAt: row.first_seen_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    releasedAt: row.released_at?.toISOString() ?? null,
  };
}

function providerFailure(error: unknown): IntegrationsError {
  if (error instanceof TwilioClientError && error.code === "authentication_failed") {
    return new IntegrationsError("authentication_failed", error.message);
  }
  const detail = error instanceof TwilioClientError ? error.message : "Twilio is unavailable";
  return new IntegrationsError("provider_unavailable", detail);
}

function credentialFromRow(row: ConnectionRow, secret: string): TwilioCredential {
  return { accountSid: row.account_sid, apiKeySid: row.api_key_sid, apiKeySecret: secret };
}

const unavailableCloudflare: CloudflareClient = {
  async verifyToken() { throw new CloudflareClientError("provider_unavailable", null); },
  async listSites() { throw new CloudflareClientError("provider_unavailable", null); },
  async listDeployments() { throw new CloudflareClientError("provider_unavailable", null); },
  async fetchDailyTraffic() { throw new CloudflareClientError("provider_unavailable", null); },
  async captureScreenshot() { throw new CloudflareClientError("provider_unavailable", null); },
};

const unavailableDataForSeo: DataForSeoClient = {
  async verify() { throw new DataForSeoClientError("provider_unavailable", null); },
  async serp() { throw new DataForSeoClientError("provider_unavailable", null); },
};

export function createIntegrations(options: IntegrationsOptions): Integrations {
  const lock = "tracer:integrations:" + options.organizationId;
  const cloudflare = createCloudflareConnection({
    pool: options.pool,
    organizationId: options.organizationId,
    cloudflare: options.cloudflare ?? unavailableCloudflare,
    masterKey: options.masterKey,
  });
  const dataforseo = createDataForSeoConnection({
    pool: options.pool,
    organizationId: options.organizationId,
    dataforseo: options.dataforseo ?? unavailableDataForSeo,
    masterKey: options.masterKey,
  });

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
        `update twilio_connection
            set last_failure_at = $2, last_failure_detail = $3, updated_at = $2
          where organization_id = $1`,
        [options.organizationId, now, error.detail ?? error.code],
      );
    });
  }

  async function decryptConnection(row: ConnectionRow): Promise<TwilioCredential> {
    if (!options.masterKey) {
      throw new IntegrationsError("master_key_missing");
    }
    try {
      return credentialFromRow(row, await decryptSecret(options.masterKey, row.api_key_secret_ciphertext));
    } catch (error) {
      if (error instanceof IntegrationsError) throw error;
      throw new IntegrationsError("provider_unavailable", "Twilio credential could not be decrypted");
    }
  }

  async function verifyCredential(credential: TwilioCredential): Promise<{ sid: string; friendlyName: string }> {
    try {
      const account = await options.twilio.fetchAccount(credential);
      if (account.sid.toLowerCase() !== credential.accountSid.toLowerCase()) {
        throw new IntegrationsError("authentication_failed", "Twilio rejected the credential");
      }
      return { sid: account.sid, friendlyName: account.friendlyName };
    } catch (error) {
      if (error instanceof IntegrationsError) throw error;
      throw providerFailure(error);
    }
  }

  return {
    ...cloudflare,
    ...dataforseo,

    async getTwilioConnection(client) {
      return selectConnection(client ?? options.pool).then((row) => (row ? toConnectionRecord(row) : null));
    },

    async withTwilioCredential<T>(
      operation: (credential: TwilioCredential) => Promise<T>,
      context?: { client?: Pool | PoolClient; deferFailureRecording?: boolean },
    ) {
      const row = await selectConnection(context?.client ?? options.pool);
      if (!row) throw new IntegrationsError("not_connected");
      const credential = await decryptConnection(row);
      try {
        return await operation(credential);
      } catch (error) {
        if (!(error instanceof TwilioClientError)) throw error;
        if (context?.deferFailureRecording) throw error;
        const failure = providerFailure(error);
        await recordFailure(failure);
        throw failure;
      }
    },

    async recordTwilioFailure(error) {
      const failure = error instanceof IntegrationsError ? error : providerFailure(error);
      await recordFailure(failure);
      return failure;
    },

    async connectTwilio(input) {
      const accountSid = input.accountSid.trim();
      const apiKeySid = input.apiKeySid.trim();
      const apiKeySecret = input.apiKeySecret.trim();
      if (!isTwilioAccountSid(accountSid) || !isTwilioApiKeySid(apiKeySid) || !apiKeySecret) {
        throw new IntegrationsError("invalid_input");
      }
      const masterKey = options.masterKey;
      if (!masterKey) {
        throw new IntegrationsError("master_key_missing");
      }
      return withTransaction(options.pool, async (client) => {
        await lockOrganization(client);
        if (await selectConnection(client)) {
          throw new IntegrationsError("already_connected");
        }
        const credential = { accountSid, apiKeySid, apiKeySecret };
        const account = await verifyCredential(credential);
        const now = new Date();
        const ciphertext = await encryptSecret(masterKey, apiKeySecret);
        await client.query(
          `insert into twilio_connection
             (id, organization_id, account_sid, api_key_sid, api_key_secret_ciphertext,
              account_friendly_name, connected_by_user_id, connected_at, last_verified_at, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $8, $8)`,
          [randomUUID(), options.organizationId, accountSid, apiKeySid, ciphertext, account.friendlyName, input.actorUserId, now],
        );
        const row = await selectConnection(client);
        if (!row) throw new IntegrationsError("not_connected");
        return toConnectionRecord(row);
      });
    },

    async testTwilio() {
      const row = await selectConnection(options.pool);
      if (!row) throw new IntegrationsError("not_connected");
      const credential = await decryptConnection(row);
      try {
        await verifyCredential(credential);
      } catch (error) {
        const failure = error instanceof IntegrationsError ? error : providerFailure(error);
        await recordFailure(failure);
        throw failure;
      }
      const now = new Date();
      return withTransaction(options.pool, async (client) => {
        await lockOrganization(client);
        await client.query(
          `update twilio_connection
              set last_verified_at = $2, last_failure_at = null, last_failure_detail = null, updated_at = $2
            where organization_id = $1`,
          [options.organizationId, now],
        );
        const updated = await selectConnection(client);
        if (!updated) throw new IntegrationsError("not_connected");
        return toConnectionRecord(updated);
      });
    },

    async rotateTwilioKey(input) {
      const row = await selectConnection(options.pool);
      if (!row) throw new IntegrationsError("not_connected");
      const apiKeySid = input.apiKeySid.trim();
      const apiKeySecret = input.apiKeySecret.trim();
      if (!isTwilioApiKeySid(apiKeySid) || !apiKeySecret) throw new IntegrationsError("invalid_input");
      const masterKey = options.masterKey;
      if (!masterKey) throw new IntegrationsError("master_key_missing");
      return withTransaction(options.pool, async (client) => {
        await lockOrganization(client);
        const current = await selectConnection(client);
        if (!current) throw new IntegrationsError("not_connected");
        const account = await verifyCredential({ accountSid: current.account_sid, apiKeySid, apiKeySecret });
        const now = new Date();
        const ciphertext = await encryptSecret(masterKey, apiKeySecret);
        await client.query(
          `update twilio_connection
              set api_key_sid = $2, api_key_secret_ciphertext = $3,
                  account_friendly_name = $4, last_verified_at = $5,
                  last_failure_at = null, last_failure_detail = null, updated_at = $5
            where organization_id = $1`,
          [options.organizationId, apiKeySid, ciphertext, account.friendlyName, now],
        );
        const updated = await selectConnection(client);
        if (!updated) throw new IntegrationsError("not_connected");
        return toConnectionRecord(updated);
      });
    },

    async setTwilioAuthToken(input) {
      const authToken = input.authToken.trim();
      if (!authToken) throw new IntegrationsError("invalid_input");
      const masterKey = options.masterKey;
      if (!masterKey) throw new IntegrationsError("master_key_missing");
      return withTransaction(options.pool, async (client) => {
        await lockOrganization(client);
        const current = await selectConnection(client);
        if (!current) throw new IntegrationsError("not_connected");
        await verifyCredential(authTokenCredential(current.account_sid, authToken));
        const now = new Date();
        await client.query(
          `update twilio_connection
              set auth_token_ciphertext = $2, last_verified_at = $3,
                  last_failure_at = null, last_failure_detail = null, updated_at = $3
            where organization_id = $1`,
          [options.organizationId, await encryptSecret(masterKey, authToken), now],
        );
        const updated = await selectConnection(client);
        if (!updated) throw new IntegrationsError("not_connected");
        return toConnectionRecord(updated);
      });
    },

    async disconnectTwilio() {
      await withTransaction(options.pool, async (client) => {
        await lockOrganization(client);
        const existing = await selectConnection(client);
        if (!existing) throw new IntegrationsError("not_connected");
        const decision = decideTwilioDisconnect({ activeWorkspaceCount: await options.activeWorkspaceCount() });
        if (!decision.allowed) throw new IntegrationsError("active_workspaces", undefined, decision.activeWorkspaceCount);
        await client.query("delete from twilio_number where organization_id = $1", [options.organizationId]);
        await client.query("delete from twilio_connection where organization_id = $1", [options.organizationId]);
      });
    },

    async syncTwilioNumbers() {
      const row = await selectConnection(options.pool);
      if (!row) throw new IntegrationsError("not_connected");
      const credential = await decryptConnection(row);
      let incoming: TwilioIncomingPhoneNumber[];
      try {
        incoming = await options.twilio.listIncomingPhoneNumbers(credential);
      } catch (error) {
        const failure = providerFailure(error);
        await recordFailure(failure);
        throw failure;
      }
      const normalized = incoming.flatMap((number) => {
        const phoneNumber = normalizeE164PhoneNumber(number.phoneNumber);
        return phoneNumber ? [{ ...number, phoneNumber }] : [];
      });
      const skipped = incoming.length - normalized.length;
      const syncedAt = new Date();
      return withTransaction(options.pool, async (client) => {
        await lockOrganization(client);
        for (const number of normalized) {
          await client.query(
            `insert into twilio_number
               (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable,
                voice_url, voice_method, first_seen_at, last_seen_at, created_at, updated_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $9, $9)
             on conflict (organization_id, twilio_sid) do update set
               phone_number = excluded.phone_number, friendly_name = excluded.friendly_name,
               voice_capable = excluded.voice_capable, voice_url = excluded.voice_url,
               voice_method = excluded.voice_method, last_seen_at = excluded.last_seen_at,
               released_at = null, updated_at = excluded.updated_at`,
            [
              randomUUID(),
              options.organizationId,
              number.sid,
              number.phoneNumber,
              number.friendlyName,
              number.voiceCapable,
              number.voiceUrl,
              number.voiceMethod,
              syncedAt,
            ],
          );
        }
        await client.query(
          `update twilio_number
              set released_at = $2, updated_at = $2
            where organization_id = $1 and released_at is null and not (twilio_sid = any($3::text[]))`,
          [options.organizationId, syncedAt, normalized.map((number) => number.sid)],
        );
        await client.query(`update twilio_connection set numbers_synced_at = $2, updated_at = $2 where organization_id = $1`, [
          options.organizationId,
          syncedAt,
        ]);
        const numbers = await client.query<NumberRow>(
          `select id, twilio_sid, phone_number, friendly_name, voice_capable, voice_url,
                  voice_method, first_seen_at, last_seen_at, released_at
             from twilio_number where organization_id = $1
             order by released_at nulls first, phone_number`,
          [options.organizationId],
        );
        return { numbers: numbers.rows.map(toNumberRecord), syncedAt: syncedAt.toISOString(), skipped };
      });
    },

    async listTwilioNumbers() {
      const result = await options.pool.query<NumberRow>(
        `select id, twilio_sid, phone_number, friendly_name, voice_capable, voice_url,
                voice_method, first_seen_at, last_seen_at, released_at
           from twilio_number where organization_id = $1
           order by released_at nulls first, phone_number`,
        [options.organizationId],
      );
      return result.rows.map(toNumberRecord);
    },

    async getRecordingTransferHealth() {
      const stored = await options.pool.query<{ last_stored_at: Date | null }>(
        "select max(stored_at) as last_stored_at from recording where organization_id = $1",
        [options.organizationId],
      );
      const failures = await options.pool.query<{ failure_stage: string; failure_reason: string; updated_at: Date }>(
        `select failure_stage, failure_reason, updated_at from recording
          where organization_id = $1 and failure_stage is not null
          order by updated_at desc, id
          limit 5`,
        [options.organizationId],
      );
      return {
        lastStoredAt: stored.rows[0].last_stored_at?.toISOString() ?? null,
        recentFailures: failures.rows.map((row) => ({ stage: row.failure_stage, reason: row.failure_reason, at: row.updated_at.toISOString() })),
      };
    },

    async getAnalysisProcessingHealth() {
      const result = await options.pool.query<{ last_transcript_at: Date | null; last_lead_assessment_at: Date | null; failed_count: number; last_failure_at: Date | null }>(
        `select (select max(transcript_completed_at) from recording where organization_id = $1) as last_transcript_at,
                (select max(processed_at) from lead_assessment where organization_id = $1) as last_lead_assessment_at,
                failed.failed_count, failed.last_failure_at
           from (select count(*)::int as failed_count, max(updated_at) as last_failure_at from recording
                  where organization_id = $1 and (transcript_state = 'Failed' or lead_assessment_state = 'Failed')) failed`,
        [options.organizationId],
      );
      const row = result.rows[0];
      return {
        lastTranscriptAt: row.last_transcript_at?.toISOString() ?? null,
        lastLeadAssessmentAt: row.last_lead_assessment_at?.toISOString() ?? null,
        failedCount: row.failed_count,
        lastFailureAt: row.last_failure_at?.toISOString() ?? null,
      };
    },

    async getMediaLifecycleHealth() {
      const result = await options.pool.query<{ call_id: string; workspace_id: string; workspace_name: string; media: "Purged" | "Expired"; since: Date; twilio_not_connected: boolean; stuck_count: number }>(
        `select call_id, workspace_id, workspace_name, media, since, twilio_not_connected, count(*) over ()::int as stuck_count
           from (select r.id, r.call_id, r.workspace_id, w.name as workspace_name,
                        case when r.media_purged_at is not null then 'Purged' else 'Expired' end as media,
                        coalesce(r.media_purged_at, ${recordingMediaExpiresAtSql("c.started_at")}) as since,
                        (t.id is null and r.twilio_cleanup_state <> 'Deleted') as twilio_not_connected
                   from recording r
                   join call c on c.id = r.call_id
                   join workspace w on w.id = r.workspace_id
                   left join twilio_connection t on t.organization_id = r.organization_id
                  where r.organization_id = $1 and r.media_deleted_at is null
                    and (r.media_purged_at is not null or ${recordingMediaExpiredSql("c.started_at", "now()")})) unfinished
          where since <= now() - interval '26 hours' or twilio_not_connected
          order by since, id
          limit 5`,
        [options.organizationId],
      );
      return {
        stuckCount: result.rows[0]?.stuck_count ?? 0,
        oldestStuck: result.rows.map((row) => ({
          callId: row.call_id,
          workspaceId: row.workspace_id,
          workspaceName: row.workspace_name,
          media: row.media,
          since: row.since.toISOString(),
          twilioNotConnected: row.twilio_not_connected,
        })),
      };
    },
  };
}
