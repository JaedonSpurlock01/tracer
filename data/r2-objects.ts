/**
 * -------------------------------------------------------------------------
 * @file   r2-objects.ts
 * @brief  Stores, inspects, and reads Recording and artifact objects through the R2 S3 API.
 *
 * @description
 *  Uploads a Recording's WAV bytes or derived waveform peaks to a private R2
 *  bucket with a signed PUT, reads back the stored size and SHA-256 checksum
 *  with a signed HEAD so the transfer workflow can verify the object before
 *  Twilio cleanup, and reads a stored object's bytes with a signed GET so
 *  the waveform workflow can derive peaks from the WAV. A generated artifact
 *  too large to hold in memory, such as a Recording ZIP, streams through a
 *  multipart upload: writes are cut into equal 8 MiB parts, only the last
 *  one shorter, each uploaded as soon as it fills, and completion lists
 *  every part's ETag in order. A rerun first aborts every unfinished
 *  upload of the same key, and a failed upload can be aborted.
 *
 * @remarks
 *  The Trigger.dev task runs outside Cloudflare, so it reaches R2 through
 *  the S3 API with a bucket-scoped token instead of a Worker binding. The
 *  PUT sends the payload hash and x-amz-checksum-sha256 so R2 rejects a
 *  corrupted upload, and stores the hex checksum as x-amz-meta-sha256
 *  because R2 returns custom metadata on HEAD. Errors carry only the HTTP
 *  status so the secret access key never reaches logs.
 *  R2 requires every part except the last to be the same size and at
 *  least 5 MiB; 8 MiB keeps one part in memory while allowing archives up
 *  to the 10,000-part limit of about 78 GiB. Each part is signed with its
 *  own SHA-256, like the single PUT. A completion that returns HTTP 200
 *  with an error body is rejected, as S3 allows. Written chunks are
 *  referenced until their part is cut, so a caller must not reuse them.
 *  Listing stale uploads reads one page, which is enough for the handful
 *  a key can accumulate across retries.
 *
 * @see
 *  data/recording-transfer.ts
 *  data/recording-waveform.ts
 *  data/report-generation.ts
 *  https://developers.cloudflare.com/r2/api/s3/api/
 *  https://developers.cloudflare.com/r2/objects/multipart-objects/
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { AwsClient } from "aws4fetch";

export interface StoredObject {
  sizeBytes: number;
  sha256: string;
}

export interface RecordingObjects {
  head(key: string): Promise<StoredObject | null>;
  put(key: string, body: Uint8Array, object: StoredObject, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

export interface MultipartUpload {
  write(chunk: Uint8Array): Promise<void>;
  complete(): Promise<{ sizeBytes: number }>;
  abort(): Promise<void>;
}

export interface ArtifactObjects extends RecordingObjects {
  createMultipartUpload(key: string, contentType: string): Promise<MultipartUpload>;
  abortMultipartUploads(key: string): Promise<void>;
}

export const multipartPartSizeBytes = 8 * 1024 * 1024;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class R2ObjectError extends Error {
  constructor(public readonly status: number | null) {
    super(status === null ? "R2 is unavailable" : `R2 request failed (HTTP ${status})`);
    this.name = "R2ObjectError";
  }
}

function unescapeXml(value: string): string {
  return value.replace(/&(lt|gt|quot|apos|amp);/g, (_, entity: string) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[entity] ?? "");
}

export function createR2RecordingObjects(options: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  fetch?: typeof fetch;
}): ArtifactObjects {
  const request = options.fetch ?? globalThis.fetch;
  const client = new AwsClient({ accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey, service: "s3", region: "auto" });
  const bucketUrl = `https://${options.accountId}.r2.cloudflarestorage.com/${options.bucket}`;

  async function send(key: string, init: RequestInit, query = ""): Promise<Response> {
    const signed = await client.sign(`${key ? `${bucketUrl}/${key}` : bucketUrl}${query}`, init);
    try {
      return await request(signed);
    } catch {
      throw new R2ObjectError(null);
    }
  }

  async function abortUpload(key: string, uploadId: string): Promise<void> {
    const response = await send(key, { method: "DELETE" }, `?uploadId=${encodeURIComponent(uploadId)}`);
    if (!response.ok && response.status !== 404) throw new R2ObjectError(response.status);
  }

  return {
    async head(key) {
      const response = await send(key, { method: "HEAD" });
      if (response.status === 404) return null;
      if (!response.ok) throw new R2ObjectError(response.status);
      return {
        sizeBytes: Number(response.headers.get("content-length")),
        sha256: response.headers.get("x-amz-meta-sha256") ?? "",
      };
    },

    async put(key, body, object, contentType = "audio/wav") {
      const response = await send(key, {
        method: "PUT",
        headers: {
          "content-type": contentType,
          "x-amz-content-sha256": object.sha256,
          "x-amz-checksum-sha256": btoa(String.fromCharCode(...(object.sha256.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16)))),
          "x-amz-meta-sha256": object.sha256,
        },
        body: body as unknown as BodyInit,
      });
      if (!response.ok) throw new R2ObjectError(response.status);
    },

    async createMultipartUpload(key, contentType) {
      const created = await send(key, { method: "POST", headers: { "content-type": contentType } }, "?uploads");
      const createdBody = await created.text();
      const found = /<UploadId>([^<]+)<\/UploadId>/.exec(createdBody)?.[1];
      if (!created.ok || !found) throw new R2ObjectError(created.status);
      const uploadId = unescapeXml(found);
      const query = `?uploadId=${encodeURIComponent(uploadId)}`;
      const pending: Uint8Array[] = [];
      const etags: string[] = [];
      let pendingBytes = 0;
      let sizeBytes = 0;

      async function uploadPart(size: number): Promise<void> {
        const part = new Uint8Array(size);
        for (let filled = 0; filled < size; ) {
          const head = pending[0];
          const take = Math.min(head.byteLength, size - filled);
          part.set(head.subarray(0, take), filled);
          filled += take;
          if (take === head.byteLength) pending.shift();
          else pending[0] = head.subarray(take);
        }
        pendingBytes -= size;
        const response = await send(
          key,
          { method: "PUT", headers: { "x-amz-content-sha256": await sha256Hex(part) }, body: part as unknown as BodyInit },
          `?partNumber=${etags.length + 1}&uploadId=${encodeURIComponent(uploadId)}`,
        );
        const etag = response.headers.get("etag");
        if (!response.ok || !etag) throw new R2ObjectError(response.status);
        etags.push(etag);
        sizeBytes += size;
      }

      return {
        async write(chunk) {
          pending.push(chunk);
          pendingBytes += chunk.byteLength;
          while (pendingBytes >= multipartPartSizeBytes) await uploadPart(multipartPartSizeBytes);
        },
        async complete() {
          if (pendingBytes > 0 || etags.length === 0) await uploadPart(pendingBytes);
          const body = `<CompleteMultipartUpload>${etags.map((etag, index) => `<Part><PartNumber>${index + 1}</PartNumber><ETag>${etag}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
          const response = await send(key, { method: "POST", headers: { "content-type": "application/xml" }, body }, query);
          if (!response.ok || (await response.text()).includes("<Error>")) throw new R2ObjectError(response.status);
          return { sizeBytes };
        },
        async abort() {
          await abortUpload(key, uploadId);
        },
      };
    },

    async abortMultipartUploads(key) {
      const listed = await send("", { method: "GET" }, `?uploads&prefix=${encodeURIComponent(key)}`);
      if (!listed.ok) throw new R2ObjectError(listed.status);
      const uploads = [...(await listed.text()).matchAll(/<Upload>([\s\S]*?)<\/Upload>/g)].map(([, upload]) => ({
        key: unescapeXml(/<Key>([^<]*)<\/Key>/.exec(upload)?.[1] ?? ""),
        uploadId: unescapeXml(/<UploadId>([^<]*)<\/UploadId>/.exec(upload)?.[1] ?? ""),
      }));
      for (const upload of uploads.filter((candidate) => candidate.key === key && candidate.uploadId)) await abortUpload(key, upload.uploadId);
    },

    async get(key) {
      const response = await send(key, { method: "GET" });
      if (response.status === 404) return null;
      if (!response.ok) throw new R2ObjectError(response.status);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
