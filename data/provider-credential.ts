/**
 * -------------------------------------------------------------------------
 * @file   provider-credential.ts
 * @brief  Seals, fingerprints, reads back, and records the state of a Provider Credential.
 *
 * @description
 *  Every Organization connection (Twilio, Cloudflare, DataForSEO) stores a
 *  provider secret as AES-256-GCM ciphertext under the deployment master
 *  key together with a fingerprint of that key. This module owns that
 *  lifecycle: sealSecret encrypts and fingerprints, credentialReadability
 *  says whether the current master key can open a stored secret without
 *  touching it, openSecret decrypts or fails as Unreadable, and the
 *  connection helpers hold the transaction, advisory lock, and the
 *  failure and verification stamps the three connection tables share.
 *  The provider connection modules are adapters over this module: they
 *  know their columns, how to verify a credential with their provider,
 *  and nothing about keys.
 *
 * @remarks
 *  Unreadable is a first-class state rather than a provider outage because
 *  the Production master key was changed on 2026-10-23 while connections
 *  sealed under the earlier key kept showing as Connected; the only way out
 *  was invisible. The fingerprint is the first twelve hex characters of the
 *  SHA-256 of the key bytes, enough to tell keys apart and useless for
 *  recovering one. A tampered envelope under the right key is also
 *  Unreadable: the Operator's recovery, re-entering the credential, is the
 *  same. A missing master key stays a deployment error, master_key_missing,
 *  because no Operator action fixes it.
 *
 * @see
 *  data/credential-encryption.ts
 *  data/integrations.ts
 *  data/cloudflare-connection.ts
 *  data/dataforseo-connection.ts
 *  docs/adr/0006-provider-credential-module.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool, PoolClient } from "pg";

import { decryptSecret, encryptSecret } from "@/data/credential-encryption";
import { IntegrationsError } from "@/data/integrations-error";

export type CredentialReadability = "readable" | "unreadable" | "master_key_missing";
/** What a connection record reports: a missing master key reads as unreadable too, since nothing can be opened. */
export type CredentialState = "readable" | "unreadable";

export interface SealedSecret {
  ciphertext: string;
  fingerprint: string;
}

/** A secret as a connection row stores it; a row sealed before fingerprints existed has none and reads as unreadable. */
export interface StoredSecret {
  ciphertext: string;
  fingerprint: string | null;
}

export const connectionTables = ["twilio_connection", "cloudflare_connection", "dataforseo_connection"] as const;
export type ConnectionTable = (typeof connectionTables)[number];

export const unreadableCredentialDetail = "The stored credential was sealed under a different master key. Re-enter it or disconnect.";

export async function masterKeyFingerprint(masterKey: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(masterKey) as unknown as BufferSource);
  return Array.from(new Uint8Array(digest).slice(0, 6), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sealSecret(masterKey: string, secret: string): Promise<SealedSecret> {
  return { ciphertext: await encryptSecret(masterKey, secret), fingerprint: await masterKeyFingerprint(masterKey) };
}

export async function credentialReadability(input: { fingerprint: string | null; masterKey: string | undefined }): Promise<CredentialReadability> {
  if (!input.masterKey) return "master_key_missing";
  if (!input.fingerprint) return "unreadable";
  return (await masterKeyFingerprint(input.masterKey)) === input.fingerprint ? "readable" : "unreadable";
}

/** Decrypts a sealed secret, or throws credential_unreadable when the current key cannot open it. */
export async function openSecret(masterKey: string | undefined, sealed: StoredSecret): Promise<string> {
  const readability = await credentialReadability({ fingerprint: sealed.fingerprint, masterKey });
  if (readability === "master_key_missing" || !masterKey) throw new IntegrationsError("master_key_missing");
  if (readability === "unreadable") throw new IntegrationsError("credential_unreadable", unreadableCredentialDetail);
  try {
    return await decryptSecret(masterKey, sealed.ciphertext);
  } catch {
    throw new IntegrationsError("credential_unreadable", unreadableCredentialDetail);
  }
}

export async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
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

export async function lockOrganization(client: PoolClient, lock: string): Promise<void> {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [lock]);
}

/** Stamps the connection's last failure in its own short transaction so the record shows it even when the caller's work rolls back. */
export async function recordConnectionFailure(pool: Pool, table: ConnectionTable, lock: string, organizationId: string, error: IntegrationsError): Promise<void> {
  const now = new Date();
  await withTransaction(pool, async (client) => {
    await lockOrganization(client, lock);
    await client.query(`update ${table} set last_failure_at = $2, last_failure_detail = $3, updated_at = $2 where organization_id = $1`, [organizationId, now, error.detail ?? error.code]);
  });
}

export async function recordConnectionVerified(client: PoolClient, table: ConnectionTable, organizationId: string, now: Date): Promise<void> {
  await client.query(`update ${table} set last_verified_at = $2, last_failure_at = null, last_failure_detail = null, updated_at = $2 where organization_id = $1`, [organizationId, now]);
}
