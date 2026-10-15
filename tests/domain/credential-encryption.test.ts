/**
 * -------------------------------------------------------------------------
 * @file   credential-encryption.test.ts
 * @brief  Verifies encrypted credential round trips and failure handling.
 *
 * @description
 *  Tests randomized AES-GCM encryption without persisting or logging secrets.
 *
 * @remarks
 *  The test key is deterministic test data and is not a deployment secret.
 *
 * @see
 *  data/credential-encryption.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "@/data/credential-encryption";

const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const alternateMasterKey = "YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODk=";
const plaintext = "twilio-api-secret-for-tests";

describe("credential encryption", () => {
  it("round trips plaintext with a versioned ciphertext", async () => {
    const ciphertext = await encryptSecret(masterKey, plaintext);

    expect(ciphertext).toMatch(/^v1:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/);
    await expect(decryptSecret(masterKey, ciphertext)).resolves.toBe(plaintext);
    expect(ciphertext).not.toContain(plaintext);
  });

  it("uses a different random IV for each encryption", async () => {
    const first = await encryptSecret(masterKey, plaintext);
    const second = await encryptSecret(masterKey, plaintext);

    expect(first).not.toBe(second);
  });

  it("rejects a wrong key and tampered ciphertext", async () => {
    const ciphertext = await encryptSecret(masterKey, plaintext);
    const [, iv, encoded] = ciphertext.split(":");
    const last = encoded.at(-1) === "A" ? "B" : "A";
    const tampered = `v1:${iv}:${encoded.slice(0, -1)}${last}`;

    await expect(decryptSecret(alternateMasterKey, ciphertext)).rejects.toMatchObject({ code: "decryption_failed" });
    await expect(decryptSecret(masterKey, tampered)).rejects.toMatchObject({ code: "decryption_failed" });
  });

  it("rejects invalid master keys", async () => {
    await expect(encryptSecret("MDEyMzQ1Njc4OWFiY2RlZg==", plaintext)).rejects.toMatchObject({ code: "invalid_master_key" });
    await expect(encryptSecret("not-base64", plaintext)).rejects.toMatchObject({ code: "invalid_master_key" });
  });
});
