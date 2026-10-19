/**
 * -------------------------------------------------------------------------
 * @file   report-download.test.ts
 * @brief  Verifies the report artifact download against a real R2 binding.
 *
 * @description
 *  Stores a synthetic report PDF in workerd's local R2 bucket and proves
 *  that the download streams its bytes as a private, uncached attachment
 *  with its content type, R2 byte length, and download filename, and that
 *  a missing object reports as unavailable.
 *
 * @remarks
 *  Download authorization is covered in tests/integration/reports-api.test.ts
 *  with an R2 fake; this suite keeps that fake honest about R2 reads.
 *
 * @see
 *  data/report-download.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { reportDownloadResponse } from "../../data/report-download";

const r2Key = "reports/job-1/report.pdf";
const bytes = new TextEncoder().encode("%PDF-1.7 synthetic Tracer report");
const download = { r2Key, contentType: "application/pdf", filename: "tracer-report-2026-10-14.pdf" };

describe("Report artifact download from R2", () => {
  beforeAll(async () => {
    await env.R2.put(r2Key, bytes);
  });

  it("streams the whole artifact as a private attachment with its filename", async () => {
    const response = await reportDownloadResponse(env.R2, download);
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("application/pdf");
    expect(response?.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(response?.headers.get("content-disposition")).toBe('attachment; filename="tracer-report-2026-10-14.pdf"');
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(bytes);
  });

  it("reports a missing object as unavailable", async () => {
    expect(await reportDownloadResponse(env.R2, { ...download, r2Key: "reports/missing/report.pdf" })).toBeNull();
  });
});
