/**
 * -------------------------------------------------------------------------
 * @file   site-preview.test.ts
 * @brief  Verifies the Site preview capture and refresh rules.
 *
 * @description
 *  Covers the one-capture-per-hour rule that Refresh Preview overrides,
 *  the sync's refresh triggers (no preview, a new live deployment, or a
 *  preview older than a day), and the R2 object key shape.
 *
 * @see
 *  data/site-preview.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { decidePreviewCapture, previewNeedsRefresh, sitePreviewObjectKey } from "@/data/site-preview";

const now = new Date("2026-10-20T12:17:00.000Z");

describe("Site preview capture rules", () => {
  it("captures a first preview and skips a capture within an hour of the last one unless forced", () => {
    expect(decidePreviewCapture({ latestCapturedAt: null, now, force: false })).toBe(true);
    expect(decidePreviewCapture({ latestCapturedAt: "2026-10-20T11:30:00.000Z", now, force: false })).toBe(false);
    expect(decidePreviewCapture({ latestCapturedAt: "2026-10-20T11:17:00.000Z", now, force: false })).toBe(true);
    expect(decidePreviewCapture({ latestCapturedAt: "2026-10-20T12:16:59.000Z", now, force: true })).toBe(true);
  });

  it("asks for a refresh without a preview, on a new live deployment, or after a day", () => {
    expect(previewNeedsRefresh({ latestPreview: null, liveVersionId: "v2", now })).toBe(true);
    expect(previewNeedsRefresh({ latestPreview: { versionId: "v1", capturedAt: "2026-10-20T12:00:00.000Z" }, liveVersionId: "v2", now })).toBe(true);
    expect(previewNeedsRefresh({ latestPreview: { versionId: "v2", capturedAt: "2026-10-20T12:00:00.000Z" }, liveVersionId: "v2", now })).toBe(false);
    expect(previewNeedsRefresh({ latestPreview: { versionId: "v2", capturedAt: "2026-10-19T12:17:00.000Z" }, liveVersionId: "v2", now })).toBe(true);
    expect(previewNeedsRefresh({ latestPreview: { versionId: null, capturedAt: "2026-10-20T12:00:00.000Z" }, liveVersionId: null, now })).toBe(false);
  });

  it("keys the object by Site, version, and capture time", () => {
    expect(sitePreviewObjectKey("site-1", "9f8e7d6c", now)).toBe(`sites/site-1/preview-9f8e7d6c-${now.getTime()}.jpg`);
    expect(sitePreviewObjectKey("site-1", null, now)).toBe(`sites/site-1/preview-unversioned-${now.getTime()}.jpg`);
  });
});
