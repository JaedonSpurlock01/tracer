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
 *  The Provider Credential module (data/provider-credential.ts) owns
 *  sealing, the master key fingerprint, readability, and failure stamps;
 *  this module is Twilio's adapter over it: it knows the Twilio columns,
 *  how to verify a credential with Twilio, and the number inventory. An
 *  Unreadable credential is recorded on the connection the first time it is
 *  used, so the Integrations page shows Needs re-entry instead of Connected.
 *  Disconnect counts Active Workspaces on its own transaction client, and a
 *  forced disconnect ends their Number Assignments without restoring the
 *  Twilio voice configuration, which the Workspace remembers. Numbers a
 *  Number Assignment ever referenced are released rather than deleted, so
 *  the assignment history keeps its number; a later sync restores them.
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
 *  data/provider-credential.ts
 *  docs/adr/0006-provider-credential-module.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Database, Queryable, Transaction } from "@/data/database";

import { CloudflareClientError, type CloudflareClient } from "@/data/cloudflare-client";
import { createCloudflareConnection, type CloudflareConnection } from "@/data/cloudflare-connection";
import { DataForSeoClientError, type DataForSeoClient } from "@/data/dataforseo-client";
import { createDataForSeoConnection, type DataForSeoConnection } from "@/data/dataforseo-connection";
import { IntegrationsError } from "@/data/integrations-error";
import { decideTwilioDisconnect, isTwilioAccountSid, isTwilioApiKeySid } from "@/data/integrations-policy";
import { normalizeE164PhoneNumber } from "@/data/phone-number";
import { credentialReadability, openSecret, recordConnectionFailure, recordConnectionVerified, sealSecret, unreadableCredentialDetail, type CredentialState } from "@/data/provider-credential";
import type { AnalysisProcessingHealth, MediaLifecycleHealth, RecordingTransferHealth } from "@/data/provider-health";
import { recordingMediaExpiredSql, recordingMediaExpiresAtSql } from "@/data/recording-media";
import { authTokenCredential, TwilioClientError, type TwilioClient, type TwilioCredential, type TwilioIncomingPhoneNumber } from "@/data/twilio-client";

export interface TwilioConnectionRecord {
  accountSid: string;
  apiKeySid: string;
  authTokenConfigured: boolean;
  /** Whether the deployment's master key can open the stored secrets; Unreadable needs Re-enter credential or Disconnect. */
  credentialState: CredentialState;
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
  database: Database;
  organizationId: string;
  twilio: TwilioClient;
  cloudflare?: CloudflareClient;
  dataforseo?: DataForSeoClient;
  masterKey: string | undefined;
}

export interface Integrations extends CloudflareConnection, DataForSeoConnection {
  getTwilioConnection(client?: Queryable): Promise<TwilioConnectionRecord | null>;
  withTwilioCredential<T>(
    operation: (credential: TwilioCredential) => Promise<T>,
    context?: { client?: Queryable; deferFailureRecording?: boolean },
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
  /** Removes the credential and numbers; with force, ends every open Number Assignment first without restoring Twilio. */
  disconnectTwilio(input?: { force?: boolean }): Promise<{ endedAssignments: number }>;
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
  master_key_fingerprint: string | null;
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

const connectionQuery = `
  select c.account_sid, c.api_key_sid, c.api_key_secret_ciphertext, c.auth_token_ciphertext, c.master_key_fingerprint,
         c.account_friendly_name, c.connected_at, c.connected_by_user_id as connected_by_id,
         u.name as connected_by_name, c.last_verified_at, c.last_failure_at,
         c.last_failure_detail, c.numbers_synced_at, count(n.id)::int as number_count
    from twilio_connection c
    left join "user" u on u.id = c.connected_by_user_id
    left join twilio_number n on n.organization_id = c.organization_id and n.released_at is null
   where c.organization_id = $1
   group by c.account_sid, c.api_key_sid, c.api_key_secret_ciphertext, c.auth_token_ciphertext, c.master_key_fingerprint,
            c.account_friendly_name, c.connected_at, c.connected_by_user_id,
            u.name, c.last_verified_at, c.last_failure_at,
            c.last_failure_detail, c.numbers_synced_at
`;

function toConnectionRecord(row: ConnectionRow, credentialState: CredentialState): TwilioConnectionRecord {
  return {
    accountSid: row.account_sid,
    apiKeySid: row.api_key_sid,
    authTokenConfigured: row.auth_token_ciphertext !== null,
    credentialState,
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
  async listLocations() { throw new DataForSeoClientError("provider_unavailable", null); },
  async keywordOverview() { throw new DataForSeoClientError("provider_unavailable", null); },
};

export function createIntegrations(options: IntegrationsOptions): Integrations {
  const lock = "tracer:integrations:" + options.organizationId;
  const transaction = <T>(operation: (client: Transaction) => Promise<T>) => options.database.transaction(operation, { lock });
  const table = "twilio_connection";
  const cloudflare = createCloudflareConnection({
    database: options.database,
    organizationId: options.organizationId,
    cloudflare: options.cloudflare ?? unavailableCloudflare,
    masterKey: options.masterKey,
  });
  const dataforseo = createDataForSeoConnection({
    database: options.database,
    organizationId: options.organizationId,
    dataforseo: options.dataforseo ?? unavailableDataForSeo,
    masterKey: options.masterKey,
  });

  async function selectConnection(client: Queryable): Promise<ConnectionRow | null> {
    const result = await client.query<ConnectionRow>(connectionQuery, [options.organizationId]);
    return result.rows[0] ?? null;
  }


  async function recordFailure(error: IntegrationsError): Promise<void> {
    await recordConnectionFailure(options.database, table, lock, options.organizationId, error);
  }

  async function recordOf(row: ConnectionRow): Promise<TwilioConnectionRecord> {
    const readability = await credentialReadability({ fingerprint: row.master_key_fingerprint, masterKey: options.masterKey });
    return toConnectionRecord(row, readability === "readable" ? "readable" : "unreadable");
  }

  /** Opens the stored API key secret; an Unreadable credential is recorded on the connection before it is reported. */
  async function decryptConnection(row: ConnectionRow): Promise<TwilioCredential> {
    try {
      return credentialFromRow(row, await openSecret(options.masterKey, { ciphertext: row.api_key_secret_ciphertext, fingerprint: row.master_key_fingerprint }));
    } catch (error) {
      if (error instanceof IntegrationsError && error.code === "credential_unreadable") await recordFailure(error);
      throw error;
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
      const row = await selectConnection(client ?? options.database);
      return row ? recordOf(row) : null;
    },

    async withTwilioCredential<T>(
      operation: (credential: TwilioCredential) => Promise<T>,
      context?: { client?: Queryable; deferFailureRecording?: boolean },
    ) {
      const row = await selectConnection(context?.client ?? options.database);
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
      return transaction(async (client) => {
        if (await selectConnection(client)) {
          throw new IntegrationsError("already_connected");
        }
        const credential = { accountSid, apiKeySid, apiKeySecret };
        const account = await verifyCredential(credential);
        const now = new Date();
        const sealed = await sealSecret(masterKey, apiKeySecret);
        await client.query(
          `insert into twilio_connection
             (id, organization_id, account_sid, api_key_sid, api_key_secret_ciphertext, master_key_fingerprint,
              account_friendly_name, connected_by_user_id, connected_at, last_verified_at, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $9, $9)`,
          [randomUUID(), options.organizationId, accountSid, apiKeySid, sealed.ciphertext, sealed.fingerprint, account.friendlyName, input.actorUserId, now],
        );
        const row = await selectConnection(client);
        if (!row) throw new IntegrationsError("not_connected");
        return recordOf(row);
      });
    },

    async testTwilio() {
      const row = await selectConnection(options.database);
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
      return transaction(async (client) => {
        await recordConnectionVerified(client, table, options.organizationId, now);
        const updated = await selectConnection(client);
        if (!updated) throw new IntegrationsError("not_connected");
        return recordOf(updated);
      });
    },

    async rotateTwilioKey(input) {
      const row = await selectConnection(options.database);
      if (!row) throw new IntegrationsError("not_connected");
      const apiKeySid = input.apiKeySid.trim();
      const apiKeySecret = input.apiKeySecret.trim();
      if (!isTwilioApiKeySid(apiKeySid) || !apiKeySecret) throw new IntegrationsError("invalid_input");
      const masterKey = options.masterKey;
      if (!masterKey) throw new IntegrationsError("master_key_missing");
      return transaction(async (client) => {
        const current = await selectConnection(client);
        if (!current) throw new IntegrationsError("not_connected");
        const account = await verifyCredential({ accountSid: current.account_sid, apiKeySid, apiKeySecret });
        const now = new Date();
        const sealed = await sealSecret(masterKey, apiKeySecret);
        const authTokenReadable = current.auth_token_ciphertext !== null && (await credentialReadability({ fingerprint: current.master_key_fingerprint, masterKey })) === "readable";
        await client.query(
          `update twilio_connection
              set api_key_sid = $2, api_key_secret_ciphertext = $3, master_key_fingerprint = $4,
                  auth_token_ciphertext = case when $6 then auth_token_ciphertext else null end,
                  account_friendly_name = $5, last_verified_at = $7,
                  last_failure_at = null, last_failure_detail = null, updated_at = $7
            where organization_id = $1`,
          [options.organizationId, apiKeySid, sealed.ciphertext, sealed.fingerprint, account.friendlyName, authTokenReadable, now],
        );
        const updated = await selectConnection(client);
        if (!updated) throw new IntegrationsError("not_connected");
        return recordOf(updated);
      });
    },

    async setTwilioAuthToken(input) {
      const authToken = input.authToken.trim();
      if (!authToken) throw new IntegrationsError("invalid_input");
      const masterKey = options.masterKey;
      if (!masterKey) throw new IntegrationsError("master_key_missing");
      return transaction(async (client) => {
        const current = await selectConnection(client);
        if (!current) throw new IntegrationsError("not_connected");
        if ((await credentialReadability({ fingerprint: current.master_key_fingerprint, masterKey })) !== "readable") {
          throw new IntegrationsError("credential_unreadable", unreadableCredentialDetail);
        }
        await verifyCredential(authTokenCredential(current.account_sid, authToken));
        const now = new Date();
        await client.query(
          `update twilio_connection
              set auth_token_ciphertext = $2, last_verified_at = $3,
                  last_failure_at = null, last_failure_detail = null, updated_at = $3
            where organization_id = $1`,
          [options.organizationId, (await sealSecret(masterKey, authToken)).ciphertext, now],
        );
        const updated = await selectConnection(client);
        if (!updated) throw new IntegrationsError("not_connected");
        return recordOf(updated);
      });
    },

    async disconnectTwilio(input) {
      return transaction(async (client) => {
        const existing = await selectConnection(client);
        if (!existing) throw new IntegrationsError("not_connected");
        const active = await client.query<{ count: number }>("select count(*)::int as count from workspace where organization_id = $1 and state = 'Active'", [options.organizationId]);
        const decision = decideTwilioDisconnect({ activeWorkspaceCount: active.rows[0]?.count ?? 0, force: input?.force });
        if (!decision.allowed) throw new IntegrationsError("active_workspaces", undefined, decision.activeWorkspaceCount);
        let endedAssignments = 0;
        if (decision.endsAssignments > 0) {
          const now = new Date();
          const ended = await client.query(
            "update number_assignment set ended_at = $2, ended_reason = 'disconnected', voice_restore_skipped_at = $2 where organization_id = $1 and ended_at is null",
            [options.organizationId, now],
          );
          endedAssignments = ended.rowCount ?? 0;
          await client.query("update workspace set state = 'Setup Required', updated_at = $2 where organization_id = $1 and state = 'Active'", [options.organizationId, now]);
        }
        await client.query(
          "delete from twilio_number n where n.organization_id = $1 and not exists (select 1 from number_assignment a where a.twilio_number_id = n.id)",
          [options.organizationId],
        );
        await client.query("update twilio_number set released_at = coalesce(released_at, $2), updated_at = $2 where organization_id = $1", [options.organizationId, new Date()]);
        await client.query("delete from twilio_connection where organization_id = $1", [options.organizationId]);
        return { endedAssignments };
      });
    },

    async syncTwilioNumbers() {
      const row = await selectConnection(options.database);
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
      return transaction(async (client) => {
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
      const result = await options.database.query<NumberRow>(
        `select id, twilio_sid, phone_number, friendly_name, voice_capable, voice_url,
                voice_method, first_seen_at, last_seen_at, released_at
           from twilio_number where organization_id = $1
           order by released_at nulls first, phone_number`,
        [options.organizationId],
      );
      return result.rows.map(toNumberRecord);
    },

    async getRecordingTransferHealth() {
      const stored = await options.database.query<{ last_stored_at: Date | null }>(
        "select max(stored_at) as last_stored_at from recording where organization_id = $1",
        [options.organizationId],
      );
      const failures = await options.database.query<{ failure_stage: string; failure_reason: string; updated_at: Date }>(
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
      const result = await options.database.query<{ last_transcript_at: Date | null; last_lead_assessment_at: Date | null; failed_count: number; last_failure_at: Date | null }>(
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
      const result = await options.database.query<{ call_id: string; workspace_id: string; workspace_name: string; media: "Purged" | "Expired"; since: Date; twilio_not_connected: boolean; stuck_count: number }>(
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
