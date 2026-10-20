/**
 * -------------------------------------------------------------------------
 * @file   recording-mp3.test.ts
 * @brief  Verifies the Recording MP3 download against a real R2 binding.
 *
 * @description
 *  Stores a synthetic MP3 object in workerd's local R2 bucket and proves
 *  that the download streams its bytes as a private attachment named for
 *  its Call, and that a missing object reports as unavailable.
 *
 * @remarks
 *  Authorization and media expiry are covered in
 *  tests/integration/workspace-access.test.ts with an R2 fake; this suite
 *  keeps that fake honest about R2 reads.
 *
 * @see
 *  data/recording-media.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { recordingMp3Response } from "../../data/recording-media";

const key = "organizations/org/workspaces/workspace/calls/call-1/recordings/recording.mp3";
const bytes = new TextEncoder().encode("ID3 synthetic stored recording mp3");
const mp3 = { key, sizeBytes: bytes.byteLength, callId: "call-1" };

describe("Recording MP3 download from R2", () => {
  beforeAll(async () => {
    await env.R2.put(key, bytes);
  });

  it("streams the whole MP3 as a private attachment named for its Call", async () => {
    const response = await recordingMp3Response(env.R2, mp3);
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("audio/mpeg");
    expect(response?.headers.get("content-disposition")).toBe('attachment; filename="tracer-call-call-1.mp3"');
    expect(response?.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(bytes);
  });

  it("reports a missing object as unavailable", async () => {
    expect(await recordingMp3Response(env.R2, { ...mp3, key: "missing.mp3" })).toBeNull();
  });
});
