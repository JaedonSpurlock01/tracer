/**
 * -------------------------------------------------------------------------
 * @file   recording-audio.ts
 * @brief  Streams a Stored Recording's private audio from R2.
 *
 * @description
 *  Streams an available Recording's WAV object from the R2 binding as
 *  private, uncached audio with single-range support for seeking. This is
 *  the only read path for Recording audio; callers authorize the Workspace
 *  and find the available media first.
 *
 * @remarks
 *  The object key never leaves the server, and no presigned or public URL is
 *  issued.
 *
 * @see
 *  data/recording-media.ts
 *  data/workspaces-handler.ts
 *  https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { AvailableRecordingMedia, RecordingMediaBucket } from "@/data/recording-media";

function requestedRange(header: string | null, size: number): { offset: number; length: number } | "unsatisfiable" | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (match[1] === "" && match[2] === "")) return null;
  const first = match[1] === "" ? Math.max(size - Number(match[2]), 0) : Number(match[1]);
  const last = match[1] === "" || match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (first > last || first >= size) return "unsatisfiable";
  return { offset: first, length: last - first + 1 };
}

export async function recordingAudioResponse(bucket: RecordingMediaBucket, audio: AvailableRecordingMedia["audio"], rangeHeader: string | null): Promise<Response | null> {
  const range = requestedRange(rangeHeader, audio.sizeBytes);
  const headers: Record<string, string> = { "content-type": "audio/wav", "cache-control": "private, no-store", "accept-ranges": "bytes" };
  if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${audio.sizeBytes}` } });
  const object = await bucket.get(audio.key, range ? { range } : undefined);
  if (!object) return null;
  if (!range) return new Response(object.body, { headers: { ...headers, "content-length": String(audio.sizeBytes) } });
  return new Response(object.body, {
    status: 206,
    headers: {
      ...headers,
      "content-length": String(range.length),
      "content-range": `bytes ${range.offset}-${range.offset + range.length - 1}/${audio.sizeBytes}`,
    },
  });
}
