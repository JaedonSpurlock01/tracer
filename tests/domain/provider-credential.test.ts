/**
 * -------------------------------------------------------------------------
 * @file   provider-credential.test.ts
 * @brief  Pins how a Provider Credential is sealed, fingerprinted, and read back.
 *
 * @description
 *  A connection row remembers a fingerprint of the master key that sealed
 *  its secret. Reading the secret under the same key succeeds; under a
 *  different key, or with a tampered envelope, it fails as Unreadable, a
 *  state an Operator can recover from, and never as a provider outage. A
 *  deployment with no master key at all is its own error.
 *
 * @see
 *  data/provider-credential.ts
 *  docs/adr/0006-provider-credential-module.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { IntegrationsError } from "@/data/integrations-error";
import { credentialReadability, masterKeyFingerprint, openSecret, sealSecret } from "@/data/provider-credential";

const firstKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const secondKey = "ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=";

describe("Provider Credential", () => {
  it("fingerprints a master key as twelve stable hex characters that differ per key", async () => {
    const first = await masterKeyFingerprint(firstKey);
    expect(first).toMatch(/^[0-9a-f]{12}$/);
    expect(await masterKeyFingerprint(firstKey)).toBe(first);
    expect(await masterKeyFingerprint(secondKey)).not.toBe(first);
  });

  it("seals a secret with the fingerprint of the key that sealed it and opens it under the same key", async () => {
    const sealed = await sealSecret(firstKey, "api-secret");
    expect(sealed.fingerprint).toBe(await masterKeyFingerprint(firstKey));
    await expect(openSecret(firstKey, sealed)).resolves.toBe("api-secret");
  });

  it("reports a secret sealed under another key as unreadable before any decryption", async () => {
    const sealed = await sealSecret(firstKey, "api-secret");
    expect(await credentialReadability({ fingerprint: sealed.fingerprint, masterKey: secondKey })).toBe("unreadable");
    expect(await credentialReadability({ fingerprint: sealed.fingerprint, masterKey: firstKey })).toBe("readable");
    expect(await credentialReadability({ fingerprint: null, masterKey: firstKey })).toBe("unreadable");
    expect(await credentialReadability({ fingerprint: sealed.fingerprint, masterKey: undefined })).toBe("master_key_missing");
  });

  it("fails as credential_unreadable under another key or a tampered envelope, and as master_key_missing without a key", async () => {
    const sealed = await sealSecret(firstKey, "api-secret");
    await expect(openSecret(secondKey, sealed)).rejects.toMatchObject({ name: "IntegrationsError", code: "credential_unreadable" });
    await expect(openSecret(firstKey, { ...sealed, ciphertext: `${sealed.ciphertext.slice(0, -2)}AA` })).rejects.toMatchObject({ code: "credential_unreadable" });
    await expect(openSecret(undefined, sealed)).rejects.toBeInstanceOf(IntegrationsError);
    await expect(openSecret(undefined, sealed)).rejects.toMatchObject({ code: "master_key_missing" });
  });
});
