/**
 * -------------------------------------------------------------------------
 * @file   r2-objects.ts
 * @brief  Stores and inspects Recording objects through the R2 S3 API.
 *
 * @description
 *  Uploads a Recording's WAV bytes to a private R2 bucket with a signed PUT
 *  and reads back the stored size and SHA-256 checksum with a signed HEAD,
 *  so the transfer workflow can verify the object before Twilio cleanup.
 *
 * @remarks
 *  The Trigger.dev task runs outside Cloudflare, so it reaches R2 through
 *  the S3 API with a bucket-scoped token instead of a Worker binding. The
 *  PUT sends the payload hash and x-amz-checksum-sha256 so R2 rejects a
 *  corrupted upload, and stores the hex checksum as x-amz-meta-sha256
 *  because R2 returns custom metadata on HEAD. Errors carry only the HTTP
 *  status so the secret access key never reaches logs.
 *
 * @see
 *  data/recording-transfer.ts
 *  https://developers.cloudflare.com/r2/api/s3/api/
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
  put(key: string, body: Uint8Array, object: StoredObject): Promise<void>;
}

export class R2ObjectError extends Error {
  constructor(public readonly status: number | null) {
    super(status === null ? "R2 is unavailable" : `R2 request failed (HTTP ${status})`);
    this.name = "R2ObjectError";
  }
}

export function createR2RecordingObjects(options: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  fetch?: typeof fetch;
}): RecordingObjects {
  const request = options.fetch ?? globalThis.fetch;
  const client = new AwsClient({ accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey, service: "s3", region: "auto" });
  const bucketUrl = `https://${options.accountId}.r2.cloudflarestorage.com/${options.bucket}`;

  async function send(key: string, init: RequestInit): Promise<Response> {
    const signed = await client.sign(`${bucketUrl}/${key}`, init);
    try {
      return await request(signed);
    } catch {
      throw new R2ObjectError(null);
    }
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

    async put(key, body, object) {
      const response = await send(key, {
        method: "PUT",
        headers: {
          "content-type": "audio/wav",
          "x-amz-content-sha256": object.sha256,
          "x-amz-checksum-sha256": btoa(String.fromCharCode(...(object.sha256.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16)))),
          "x-amz-meta-sha256": object.sha256,
        },
        body: body as unknown as BodyInit,
      });
      if (!response.ok) throw new R2ObjectError(response.status);
    },
  };
}
