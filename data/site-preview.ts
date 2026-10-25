/**
 * -------------------------------------------------------------------------
 * @file   site-preview.ts
 * @brief  Captures, stores, and serves a Site's preview screenshot.
 *
 * @description
 *  Captures a 1280 by 800 JPEG of a Site's apex URL through Browser
 *  Rendering, stores it in private R2 under
 *  `sites/{siteId}/preview-{versionId}-{timestamp}.jpg`, records the
 *  capture in `site_preview`, and deletes the objects of captures older
 *  than the newest three. The sync asks for a capture when the live
 *  deployment changed or the newest preview is older than a day, and an
 *  Operator's Refresh Preview forces one. The preview is read back through
 *  a Workspace-authorized route that streams the object from the R2
 *  binding.
 *
 * @remarks
 *  Browser Rendering has a small free allowance, so a capture within an
 *  hour of the previous one is skipped unless forced. The object store is
 *  a two-method interface so the Trigger.dev task (S3 API through
 *  aws4fetch) and the Worker (R2 binding) share one capture function. The
 *  runtime role cannot delete `site_preview` rows, so retention deletes
 *  only the objects: rows older than the newest three keep their key as
 *  history while their object is gone, and each capture retries up to ten
 *  of those deletes so a failed delete is picked up later. Reads always use
 *  the newest row, whose object is never deleted. Provider failures are
 *  recorded on the Cloudflare connection like every other credential use.
 *
 * @see
 *  data/site-sync.ts
 *  data/cloudflare-connection.ts
 *  data/r2-objects.ts
 *  data/workspaces-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Database } from "@/data/database";

import type { CloudflareClient } from "@/data/cloudflare-client";
import { createCloudflareConnection } from "@/data/cloudflare-connection";
import { sha256Hex, type ArtifactObjects } from "@/data/r2-objects";

export interface SitePreviewObjects {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface SitePreviewBucket extends SitePreviewObjects {
  get(key: string): Promise<{ body: ReadableStream } | null>;
}

export interface SitePreviewBinding {
  put(key: string, value: ArrayBufferView, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream } | null>;
  delete(key: string): Promise<void>;
}

export interface CaptureSitePreviewInput {
  database: Database;
  cloudflare: CloudflareClient;
  objects: SitePreviewObjects;
  masterKey: string | undefined;
  siteId: string;
  now: Date;
  force?: boolean;
}

export interface SitePreviewCapture {
  captured: boolean;
  objectKey: string | null;
}

export const sitePreviewKeepCount = 3;
export const sitePreviewRetryDeleteLimit = 10;
export const sitePreviewMinimumIntervalMs = 60 * 60 * 1000;
export const sitePreviewRefreshAfterMs = 24 * 60 * 60 * 1000;
export const sitePreviewContentType = "image/jpeg";

export function sitePreviewObjectKey(siteId: string, versionId: string | null, now: Date): string {
  return `sites/${siteId}/preview-${versionId ?? "unversioned"}-${now.getTime()}.jpg`;
}

export function decidePreviewCapture(input: { latestCapturedAt: string | null; now: Date; force: boolean }): boolean {
  if (input.force || input.latestCapturedAt === null) return true;
  return input.now.getTime() - Date.parse(input.latestCapturedAt) >= sitePreviewMinimumIntervalMs;
}

export function previewNeedsRefresh(input: { latestPreview: { versionId: string | null; capturedAt: string } | null; liveVersionId: string | null; now: Date }): boolean {
  if (!input.latestPreview) return true;
  if (input.latestPreview.versionId !== input.liveVersionId) return true;
  return input.now.getTime() - Date.parse(input.latestPreview.capturedAt) >= sitePreviewRefreshAfterMs;
}

export function sitePreviewObjectsFromArtifacts(objects: Pick<ArtifactObjects, "put" | "delete">): SitePreviewObjects {
  return {
    async put(key, body, contentType) {
      await objects.put(key, body, { sizeBytes: body.byteLength, sha256: await sha256Hex(body) }, contentType);
    },
    delete: (key) => objects.delete(key),
  };
}

export function sitePreviewObjectsFromBinding(binding: SitePreviewBinding): SitePreviewBucket {
  return {
    async put(key, body, contentType) {
      await binding.put(key, body, { httpMetadata: { contentType } });
    },
    get: (key) => binding.get(key),
    delete: (key) => binding.delete(key),
  };
}

export async function sitePreviewResponse(bucket: Pick<SitePreviewBucket, "get">, objectKey: string): Promise<Response | null> {
  const object = await bucket.get(objectKey);
  if (!object) return null;
  return new Response(object.body, { headers: { "content-type": sitePreviewContentType, "cache-control": "private, no-store" } });
}

type PreviewSiteRow = {
  organization_id: string;
  primary_hostname: string;
  live_version_id: string | null;
  latest_captured_at: Date | null;
};

export async function captureSitePreview(input: CaptureSitePreviewInput): Promise<SitePreviewCapture> {
  const site = (await input.database.query<PreviewSiteRow>(
    `select s.organization_id, s.primary_hostname, s.live_version_id,
            (select max(p.captured_at) from site_preview p where p.site_id = s.id) as latest_captured_at
       from site s where s.id = $1 and s.removed_at is null`,
    [input.siteId],
  )).rows[0];
  if (!site) return { captured: false, objectKey: null };
  if (!decidePreviewCapture({ latestCapturedAt: site.latest_captured_at?.toISOString() ?? null, now: input.now, force: input.force ?? false })) {
    return { captured: false, objectKey: null };
  }
  const connection = createCloudflareConnection({ database: input.database, organizationId: site.organization_id, cloudflare: input.cloudflare, masterKey: input.masterKey });
  const image = await connection.withCloudflareCredential((credential) => input.cloudflare.captureScreenshot(credential, `https://${site.primary_hostname}/`));
  const objectKey = sitePreviewObjectKey(input.siteId, site.live_version_id, input.now);
  await input.objects.put(objectKey, image, sitePreviewContentType);
  await input.database.query(
    "insert into site_preview (id, site_id, version_id, object_key, captured_at, byte_size) values ($1, $2, $3, $4, $5, $6)",
    [randomUUID(), input.siteId, site.live_version_id, objectKey, input.now, image.byteLength],
  );
  const stale = await input.database.query<{ object_key: string }>(
    "select object_key from site_preview where site_id = $1 order by captured_at desc, id desc offset $2 limit $3",
    [input.siteId, sitePreviewKeepCount, sitePreviewRetryDeleteLimit],
  );
  for (const row of stale.rows) await input.objects.delete(row.object_key);
  return { captured: true, objectKey };
}
