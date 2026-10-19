/**
 * -------------------------------------------------------------------------
 * @file   report-download.ts
 * @brief  Streams an authorized report or Calls export artifact from private R2.
 *
 * @description
 *  Reads the artifact object for an already authorized download and
 *  streams it as a private, uncached attachment with its content type,
 *  the object's byte length, and the download filename.
 *
 * @remarks
 *  The Worker streams the object rather than handing out a pre-signed R2
 *  URL, so every download passes through the request-time authorization
 *  in data/report-jobs.ts and the object key never leaves the server. A
 *  missing object reports as unavailable so the caller answers the same
 *  Not Found as a refused download.
 *
 * @see
 *  data/report-jobs.ts
 *  data/reports-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { ReportDownload } from "@/data/report-jobs";

export interface ReportArtifactBucket {
  get(key: string): Promise<{ body: ReadableStream; size: number } | null>;
}

export async function reportDownloadResponse(bucket: ReportArtifactBucket, download: ReportDownload): Promise<Response | null> {
  const object = await bucket.get(download.r2Key);
  if (!object) return null;
  return new Response(object.body, {
    headers: {
      "content-type": download.contentType,
      "content-length": String(object.size),
      "content-disposition": `attachment; filename="${download.filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
