/**
 * -------------------------------------------------------------------------
 * @file   ffmpeg.test.ts
 * @brief  Verifies the ffmpeg MP3 encoder contract for Recording downloads.
 *
 * @description
 *  Checks that the MP3 encoder runs the ffmpeg CLI on the Recording's WAV
 *  with the fixed MP3 settings, returns the encoded file's bytes, and
 *  rejects a failed run with a stable reason.
 *
 * @remarks
 *  The test runs a stand-in executable because the real binary exists only
 *  in the deployed Trigger.dev image.
 *
 * @see
 *  data/ffmpeg.ts
 *  data/recording-mp3.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFfmpegMp3Encoder } from "@/data/ffmpeg";

describe("ffmpeg MP3 encoder", () => {
  let directory = "";
  let command = "";
  let invocation = "";

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "tracer-ffmpeg-"));
    command = join(directory, "ffmpeg");
    invocation = join(directory, "invocation.json");
    await writeFile(
      command,
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (process.env.FFMPEG_FAIL) { process.stderr.write("Invalid data found when processing input"); process.exit(1); }
const input = fs.readFileSync(args[args.indexOf("-i") + 1]);
fs.writeFileSync(${JSON.stringify(invocation)}, JSON.stringify({ args, inputBytes: [...input] }));
fs.writeFileSync(args[args.length - 1], Buffer.from("ID3 synthetic mp3"));
`,
    );
    await chmod(command, 0o755);
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("encodes the WAV to a 64 kbps constant-bitrate 16 kHz MP3 that keeps its channels", async () => {
    const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3]);

    const mp3 = await createFfmpegMp3Encoder({ command }).encode(wav);

    expect(new TextDecoder().decode(mp3)).toBe("ID3 synthetic mp3");
    const { args, inputBytes } = JSON.parse(await readFile(invocation, "utf8")) as { args: string[]; inputBytes: number[] };
    expect(args).toEqual([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-i", expect.stringMatching(/\.wav$/),
      "-vn", "-codec:a", "libmp3lame", "-b:a", "64k", "-ar", "16000",
      expect.stringMatching(/\.mp3$/),
    ]);
    expect(inputBytes).toEqual([...wav]);
  });

  it("rejects a failed ffmpeg run with a stable reason", async () => {
    process.env.FFMPEG_FAIL = "1";
    try {
      await expect(createFfmpegMp3Encoder({ command }).encode(new Uint8Array([1]))).rejects.toThrow("ffmpeg could not encode the MP3");
    } finally {
      delete process.env.FFMPEG_FAIL;
    }
  });
});
