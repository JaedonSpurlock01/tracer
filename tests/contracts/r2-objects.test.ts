/**
 * -------------------------------------------------------------------------
 * @file   r2-objects.test.ts
 * @brief  Verifies the R2 S3 API contract for Recording objects.
 *
 * @description
 *  Checks the signed PUT, HEAD, and GET requests Tracer sends to the R2 S3
 *  API for a Recording object, the stored size and checksum read back from
 *  HEAD, the bytes read back from GET, and safe errors that never expose the
 *  R2 secret access key.
 *
 * @remarks
 *  Fixture account, bucket, and keys are synthetic test data. The WAV
 *  fixture is a short synthetic recording.
 *
 * @see
 *  data/r2-objects.ts
 *  https://developers.cloudflare.com/r2/api/s3/api/
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { createR2RecordingObjects } from "@/data/r2-objects";

import fixture from "./fixtures/r2/objects.json";

const wav = new Uint8Array(readFileSync(new URL("./fixtures/twilio/recording.wav", import.meta.url)));
const sha256 = createHash("sha256").update(wav).digest("hex");
const credentials = { accountId: fixture.accountId, bucket: fixture.bucket, accessKeyId: "synthetic-access-key-id", secretAccessKey: "synthetic-secret-access-key" };
const objectUrl = `https://${fixture.accountId}.r2.cloudflarestorage.com/${fixture.bucket}/${fixture.key}`;

function objects(fetch: (request: Request) => Promise<Response>) {
  return createR2RecordingObjects({ ...credentials, fetch: fetch as typeof globalThis.fetch });
}

describe("R2 Recording objects", () => {
  it("uploads a private WAV object with a signed PUT carrying its size and SHA-256 checksum", async () => {
    const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => new Response(null, fixture.putObject));

    await objects(fetch).put(fixture.key, wav, { sizeBytes: wav.byteLength, sha256 });

    const request = fetch.mock.calls[0][0];
    expect(request.method).toBe("PUT");
    expect(request.url).toBe(objectUrl);
    expect(request.headers.get("authorization")).toMatch(new RegExp(`^AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/\\d{8}/auto/s3/aws4_request, SignedHeaders=`));
    expect(request.headers.get("content-type")).toBe("audio/wav");
    expect(request.headers.get("x-amz-content-sha256")).toBe(sha256);
    expect(request.headers.get("x-amz-checksum-sha256")).toBe(Buffer.from(sha256, "hex").toString("base64"));
    expect(request.headers.get("x-amz-meta-sha256")).toBe(sha256);
    expect(new Uint8Array(await request.arrayBuffer())).toEqual(wav);
  });

  it("reads the stored size and SHA-256 checksum from a signed HEAD", async () => {
    const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => new Response(null, fixture.headObject));

    await expect(objects(fetch).head(fixture.key)).resolves.toEqual({ sizeBytes: wav.byteLength, sha256 });
    const request = fetch.mock.calls[0][0];
    expect(request.method).toBe("HEAD");
    expect(request.url).toBe(objectUrl);
    expect(request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it("uploads derived waveform peaks with a signed PUT carrying the JSON content type", async () => {
    const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => new Response(null, fixture.putObject));
    const peaks = new TextEncoder().encode(JSON.stringify({ version: 1, peaks: [[0.5]] }));
    const peaksSha256 = createHash("sha256").update(peaks).digest("hex");

    await objects(fetch).put(fixture.peaksKey, peaks, { sizeBytes: peaks.byteLength, sha256: peaksSha256 }, "application/json");

    const request = fetch.mock.calls[0][0];
    expect(request.method).toBe("PUT");
    expect(request.url).toBe(`https://${fixture.accountId}.r2.cloudflarestorage.com/${fixture.bucket}/${fixture.peaksKey}`);
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(request.headers.get("x-amz-meta-sha256")).toBe(peaksSha256);
    expect(new Uint8Array(await request.arrayBuffer())).toEqual(peaks);
  });

  it("reads a stored object's bytes with a signed GET", async () => {
    const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => new Response(wav, fixture.getObject));

    await expect(objects(fetch).get(fixture.key)).resolves.toEqual(wav);
    const request = fetch.mock.calls[0][0];
    expect(request.method).toBe("GET");
    expect(request.url).toBe(objectUrl);
    expect(request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it("reads an absent object's bytes as missing", async () => {
    const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => new Response(null, { status: 404 }));

    await expect(objects(fetch).get(fixture.key)).resolves.toBeNull();
  });

  it("rejects a failed GET without exposing the secret access key", async () => {
    const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => new Response(fixture.accessDenied.body, { status: fixture.accessDenied.status }));

    const error = await objects(fetch).get(fixture.key).catch((value: unknown) => value);

    expect((error as Error).message).toBe("R2 request failed (HTTP 403)");
    expect((error as Error).message).not.toContain(credentials.secretAccessKey);
  });

  it("reports an absent object as missing", async () => {
    const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => new Response(null, { status: 404 }));

    await expect(objects(fetch).head(fixture.key)).resolves.toBeNull();
  });

  it("rejects an R2 failure without exposing the secret access key", async () => {
    const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => new Response(fixture.accessDenied.body, { status: fixture.accessDenied.status }));

    const error = await objects(fetch).put(fixture.key, wav, { sizeBytes: wav.byteLength, sha256 }).catch((value: unknown) => value);

    expect((error as Error).message).toBe("R2 request failed (HTTP 403)");
    expect((error as Error).message).not.toContain(credentials.secretAccessKey);
  });

  it("rejects an unreachable R2 as unavailable", async () => {
    const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => {
      throw new Error("socket failed");
    });

    await expect(objects(fetch).head(fixture.key)).rejects.toThrow("R2 is unavailable");
  });
});
