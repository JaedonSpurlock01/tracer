/**
 * -------------------------------------------------------------------------
 * @file   audiowaveform.test.ts
 * @brief  Verifies the audiowaveform peak contract for Recording waveforms.
 *
 * @description
 *  Checks that audiowaveform JSON output is normalized into the compact
 *  waveform peaks shape the player consumes, with Caller and Business lanes
 *  for a dual-channel Recording and one Mixed lane otherwise, and that the
 *  peak generator invokes the audiowaveform CLI with the expected arguments.
 *
 * @remarks
 *  The JSON fixtures follow audiowaveform's version 2 data format, where
 *  each point interleaves a minimum and maximum per channel. The CLI test
 *  runs a stand-in executable because the real binary exists only in the
 *  deployed Trigger.dev image.
 *
 * @see
 *  data/audiowaveform.ts
 *  data/recording-waveform.ts
 *  https://github.com/bbc/audiowaveform/blob/master/doc/DataFormat.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAudiowaveformPeakGenerator } from "@/data/audiowaveform";
import { normalizeWaveformPeaks } from "@/data/recording-waveform";

import mixed from "./fixtures/audiowaveform/mixed.json";
import splitChannels from "./fixtures/audiowaveform/split-channels.json";

describe("Waveform peak normalization", () => {
  it("splits a dual-channel Recording into Caller and Business lanes", () => {
    expect(normalizeWaveformPeaks(splitChannels, 2)).toEqual({
      version: 1,
      sampleRate: 8000,
      samplesPerPixel: 160,
      pixelsPerSecond: 50,
      durationSeconds: 0.08,
      lanes: ["Caller", "Business"],
      peaks: [
        [0.5, 1, 0.09, 0],
        [0.01, 0.02, 0.75, 0.31],
      ],
    });
  });

  it("keeps a single-channel Recording as one Mixed lane", () => {
    expect(normalizeWaveformPeaks(mixed, 1)).toMatchObject({ durationSeconds: 0.06, lanes: ["Mixed"], peaks: [[0.5, 0.13, 0.01]] });
  });

  it("rejects peaks whose channels do not match the Recording", () => {
    expect(() => normalizeWaveformPeaks(splitChannels, 1)).toThrow("Waveform peaks do not match the Recording channels");
  });
});

describe("audiowaveform peak generator", () => {
  let directory = "";
  let command = "";
  let invocation = "";

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "tracer-audiowaveform-"));
    command = join(directory, "audiowaveform");
    invocation = join(directory, "invocation.json");
    const output = fileURLToPath(new URL("./fixtures/audiowaveform/split-channels.json", import.meta.url));
    await writeFile(
      command,
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (process.env.AUDIOWAVEFORM_FAIL) { process.stderr.write("Can't open input"); process.exit(1); }
const input = fs.readFileSync(args[args.indexOf("-i") + 1]);
fs.writeFileSync(${JSON.stringify(invocation)}, JSON.stringify({ args, inputBytes: [...input] }));
fs.copyFileSync(${JSON.stringify(output)}, args[args.indexOf("-o") + 1]);
`,
    );
    await chmod(command, 0o755);
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("runs audiowaveform on the WAV with split channels at 50 pixels per second and 8-bit peaks", async () => {
    const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3]);

    await expect(createAudiowaveformPeakGenerator({ command }).generate(wav, { splitChannels: true })).resolves.toEqual(splitChannels);

    const { args, inputBytes } = JSON.parse(await readFile(invocation, "utf8")) as { args: string[]; inputBytes: number[] };
    expect(args).toEqual(["-i", expect.stringMatching(/\.wav$/), "-o", expect.stringMatching(/\.json$/), "--pixels-per-second", "50", "-b", "8", "--split-channels"]);
    expect(inputBytes).toEqual([...wav]);
  });

  it("mixes channels when the Recording has a single lane", async () => {
    await createAudiowaveformPeakGenerator({ command }).generate(new Uint8Array([1]), { splitChannels: false });

    const { args } = JSON.parse(await readFile(invocation, "utf8")) as { args: string[] };
    expect(args).not.toContain("--split-channels");
  });

  it("rejects a failed audiowaveform run with a stable reason", async () => {
    process.env.AUDIOWAVEFORM_FAIL = "1";
    try {
      await expect(createAudiowaveformPeakGenerator({ command }).generate(new Uint8Array([1]), { splitChannels: false })).rejects.toThrow("audiowaveform could not generate peaks");
    } finally {
      delete process.env.AUDIOWAVEFORM_FAIL;
    }
  });
});
