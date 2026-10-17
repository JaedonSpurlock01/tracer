/**
 * -------------------------------------------------------------------------
 * @file   recording-audio.test.ts
 * @brief  Verifies Recording audio streaming against a real R2 binding.
 *
 * @description
 *  Stores a synthetic WAV object in workerd's local R2 bucket and proves
 *  that full, ranged, unsatisfiable, and missing-object reads produce the
 *  bytes and headers playback relies on.
 *
 * @remarks
 *  Authorization is covered in tests/integration/workspace-access.test.ts
 *  with an R2 fake; this suite keeps that fake honest about R2 range reads.
 *
 * @see
 *  data/recording-audio.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { recordingAudioResponse } from "../../data/recording-audio";

const key = "organizations/org/workspaces/workspace/calls/call/recordings/recording.wav";
const bytes = new TextEncoder().encode("RIFF synthetic stored recording audio");
const audio = { key, sizeBytes: bytes.byteLength };

describe("Recording audio stream from R2", () => {
  beforeAll(async () => {
    await env.R2.put(key, bytes);
  });

  it("streams the whole object without a Range header", async () => {
    const response = await recordingAudioResponse(env.R2, audio, null);
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(bytes);
  });

  it.each([
    ["bytes=2-9", 2, 9],
    ["bytes=30-", 30, bytes.byteLength - 1],
    ["bytes=-5", bytes.byteLength - 5, bytes.byteLength - 1],
    ["bytes=30-5000", 30, bytes.byteLength - 1],
  ])("streams exactly the requested %s bytes", async (range, first, last) => {
    const response = await recordingAudioResponse(env.R2, audio, range);
    expect(response?.status).toBe(206);
    expect(response?.headers.get("content-range")).toBe(`bytes ${first}-${last}/${bytes.byteLength}`);
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(bytes.slice(first, last + 1));
  });

  it("answers an unsatisfiable Range with 416 without reading the object", async () => {
    const response = await recordingAudioResponse(env.R2, audio, `bytes=${bytes.byteLength}-`);
    expect(response?.status).toBe(416);
    expect(response?.headers.get("content-range")).toBe(`bytes */${bytes.byteLength}`);
  });

  it("reports a missing object as unavailable", async () => {
    expect(await recordingAudioResponse(env.R2, { key: "missing.wav", sizeBytes: 10 }, null)).toBeNull();
  });
});
