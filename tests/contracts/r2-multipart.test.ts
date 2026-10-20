/**
 * -------------------------------------------------------------------------
 * @file   r2-multipart.test.ts
 * @brief  Verifies the R2 S3 multipart upload contract for generated artifacts.
 *
 * @description
 *  Checks the signed CreateMultipartUpload, UploadPart, CompleteMultipartUpload,
 *  AbortMultipartUpload, and ListMultipartUploads requests Tracer sends to
 *  the R2 S3 API while streaming a Recording ZIP: equal fixed-size parts
 *  cut from arbitrary writes with only the last one shorter, each part
 *  signed with its own SHA-256, the completion body listing every part's
 *  ETag in order, an error body inside a successful completion response
 *  rejected, abort after a failed part, and aborting every stale upload of
 *  one key before a rerun restarts it.
 *
 * @remarks
 *  Fixture account, bucket, upload ids, and ETags are synthetic test data
 *  shaped like the R2 S3 responses. The written bytes are a deterministic
 *  non-round sequence a little over two parts long.
 *
 * @see
 *  data/r2-objects.ts
 *  https://developers.cloudflare.com/r2/objects/multipart-objects/
 *  https://docs.aws.amazon.com/AmazonS3/latest/API/API_CompleteMultipartUpload.html
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createR2RecordingObjects, multipartPartSizeBytes, R2ObjectError } from "@/data/r2-objects";

import fixture from "./fixtures/r2/multipart.json";

const credentials = { accountId: fixture.accountId, bucket: fixture.bucket, accessKeyId: "synthetic-access-key-id", secretAccessKey: "synthetic-secret-access-key" };
const objectUrl = `https://${fixture.accountId}.r2.cloudflarestorage.com/${fixture.bucket}/${fixture.key}`;

const archive = new Uint8Array(18_000_102);
for (let index = 0; index < archive.byteLength; index += 1) archive[index] = (index * 131 + 7) % 253;

const writes = Array.from({ length: Math.ceil(archive.byteLength / 3_000_017) }, (_, index) => archive.subarray(index * 3_000_017, (index + 1) * 3_000_017));

type Fetch = (request: Request) => Promise<Response>;

function objects(fetch: Fetch) {
  return createR2RecordingObjects({ ...credentials, fetch: fetch as typeof globalThis.fetch });
}

function r2(overrides: { part?: (partNumber: number) => Response | null; complete?: () => Response } = {}) {
  const requests: Array<{ method: string; url: URL; headers: Headers; body: Uint8Array }> = [];
  const fetch = vi.fn<Fetch>(async (request) => {
    const url = new URL(request.url);
    requests.push({ method: request.method, url, headers: request.headers, body: new Uint8Array(await request.arrayBuffer()) });
    if (request.method === "POST" && url.searchParams.has("uploads")) return new Response(fixture.createMultipartUpload.body, { status: 200 });
    if (request.method === "PUT") {
      const partNumber = Number(url.searchParams.get("partNumber"));
      return overrides.part?.(partNumber) ?? new Response(null, { status: 200, headers: { etag: fixture.uploadPart.etags[partNumber - 1] } });
    }
    if (request.method === "POST") return overrides.complete?.() ?? new Response(fixture.completeMultipartUpload.body, { status: 200 });
    if (request.method === "GET") return new Response(fixture.listMultipartUploads.body, { status: 200 });
    return new Response(null, { status: fixture.abortMultipartUpload.status });
  });
  return { fetch, requests };
}

describe("R2 multipart uploads", () => {
  it("streams writes into equal signed parts, only the last shorter, and completes with every part's ETag in order", async () => {
    const { fetch, requests } = r2();

    const upload = await objects(fetch).createMultipartUpload(fixture.key, "application/zip");
    for (const chunk of writes) await upload.write(chunk);
    await expect(upload.complete()).resolves.toEqual({ sizeBytes: archive.byteLength });

    const [create, ...rest] = requests;
    expect(create.method).toBe("POST");
    expect(`${create.url.origin}${create.url.pathname}`).toBe(objectUrl);
    expect([...create.url.searchParams.keys()]).toEqual(["uploads"]);
    expect(create.headers.get("content-type")).toBe("application/zip");
    expect(create.headers.get("authorization")).toMatch(new RegExp(`^AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/\\d{8}/auto/s3/aws4_request, SignedHeaders=`));
    const parts = rest.slice(0, -1);
    expect(multipartPartSizeBytes).toBe(8 * 1024 * 1024);
    expect(parts.map(({ method, url, body }) => [method, url.searchParams.get("partNumber"), url.searchParams.get("uploadId"), body.byteLength])).toEqual([
      ["PUT", "1", fixture.uploadId, multipartPartSizeBytes],
      ["PUT", "2", fixture.uploadId, multipartPartSizeBytes],
      ["PUT", "3", fixture.uploadId, archive.byteLength - 2 * multipartPartSizeBytes],
    ]);
    for (const [index, part] of parts.entries()) {
      const expected = createHash("sha256").update(archive.subarray(index * multipartPartSizeBytes, (index + 1) * multipartPartSizeBytes)).digest("hex");
      expect(createHash("sha256").update(part.body).digest("hex")).toBe(expected);
      expect(part.headers.get("x-amz-content-sha256")).toBe(expected);
      expect(part.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
    }
    const complete = rest.at(-1)!;
    expect(complete.method).toBe("POST");
    expect(complete.url.searchParams.get("uploadId")).toBe(fixture.uploadId);
    expect(new TextDecoder().decode(complete.body)).toBe(
      `<CompleteMultipartUpload>${fixture.uploadPart.etags.map((etag, index) => `<Part><PartNumber>${index + 1}</PartNumber><ETag>${etag}</ETag></Part>`).join("")}</CompleteMultipartUpload>`,
    );
  });

  it("rejects a failed part without exposing the secret access key, and aborts the upload with a signed DELETE", async () => {
    const { fetch, requests } = r2({ part: (partNumber) => (partNumber === 2 ? new Response(null, fixture.serviceUnavailable) : null) });
    const upload = await objects(fetch).createMultipartUpload(fixture.key, "application/zip");

    const error = await (async () => {
      for (const chunk of writes) await upload.write(chunk);
    })().catch((value: unknown) => value);
    await upload.abort();

    expect(error).toEqual(new R2ObjectError(503));
    expect((error as Error).message).not.toContain(credentials.secretAccessKey);
    const abort = requests.at(-1)!;
    expect(abort.method).toBe("DELETE");
    expect(`${abort.url.origin}${abort.url.pathname}`).toBe(objectUrl);
    expect(abort.url.searchParams.get("uploadId")).toBe(fixture.uploadId);
    expect(abort.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it("rejects a completion whose successful response carries an error body", async () => {
    const { fetch } = r2({ complete: () => new Response(fixture.completeMultipartUploadError.body, { status: fixture.completeMultipartUploadError.status }) });
    const upload = await objects(fetch).createMultipartUpload(fixture.key, "application/zip");
    await upload.write(archive.subarray(0, 1_048_583));

    await expect(upload.complete()).rejects.toEqual(new R2ObjectError(200));
  });

  it("aborts every stale upload of exactly that key before a rerun restarts it", async () => {
    const { fetch, requests } = r2();

    await objects(fetch).abortMultipartUploads(fixture.key);

    const [list, ...aborts] = requests;
    expect(list.method).toBe("GET");
    expect(`${list.url.origin}${list.url.pathname}`).toBe(`https://${fixture.accountId}.r2.cloudflarestorage.com/${fixture.bucket}`);
    expect(list.url.searchParams.has("uploads")).toBe(true);
    expect(list.url.searchParams.get("prefix")).toBe(fixture.key);
    expect(list.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(aborts.map(({ method, url }) => [method, `${url.origin}${url.pathname}`, url.searchParams.get("uploadId")])).toEqual(
      fixture.staleUploadIds.map((uploadId) => ["DELETE", objectUrl, uploadId]),
    );
  });
});
