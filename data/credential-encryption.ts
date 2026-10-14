/**
 * -------------------------------------------------------------------------
 * @file   credential-encryption.ts
 * @brief  Encrypts and decrypts provider credentials.
 *
 * @description
 *  Uses AES-256-GCM with a versioned base64 envelope for credential secrets.
 *
 * @remarks
 *  The Web Crypto API keeps this boundary compatible with Node and Workers.
 *
 * @see
 *  data/integrations.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export const masterKeyEnvironmentName = "TWILIO_CREDENTIAL_MASTER_KEY";

export class CredentialEncryptionError extends Error {
  constructor(public readonly code: "invalid_master_key" | "decryption_failed") {
    super(code);
    this.name = "CredentialEncryptionError";
  }
}

function decodeBase64(value: string): Uint8Array | null {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null;
  }
  try {
    const decoded = atob(value);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function masterKeyBytes(value: string): Uint8Array {
  const bytes = decodeBase64(value);
  if (!bytes || bytes.length !== 32) {
    throw new CredentialEncryptionError("invalid_master_key");
  }
  return bytes;
}

async function importMasterKey(value: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "raw",
    masterKeyBytes(value) as unknown as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSecret(masterKey: string, plaintext: string): Promise<string> {
  const key = await importMasterKey(masterKey);
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(plaintext) as unknown as BufferSource,
  );
  return `v1:${btoa(String.fromCharCode(...iv))}:${btoa(String.fromCharCode(...new Uint8Array(ciphertext)))}`;
}

export async function decryptSecret(masterKey: string, ciphertext: string): Promise<string> {
  const key = await importMasterKey(masterKey);
  const parts = ciphertext.split(":");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new CredentialEncryptionError("decryption_failed");
  }
  const iv = decodeBase64(parts[1]);
  const encrypted = decodeBase64(parts[2]);
  if (!iv || iv.length !== 12 || !encrypted || encrypted.length <= 16) {
    throw new CredentialEncryptionError("decryption_failed");
  }
  try {
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      key,
      encrypted as unknown as BufferSource,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new CredentialEncryptionError("decryption_failed");
  }
}
