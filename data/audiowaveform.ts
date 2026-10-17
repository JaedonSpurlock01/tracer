/**
 * -------------------------------------------------------------------------
 * @file   audiowaveform.ts
 * @brief  Generates Recording waveform peaks with the audiowaveform CLI.
 *
 * @description
 *  Writes a Recording's WAV to a temporary directory, runs the BBC
 *  audiowaveform CLI on it, and returns the CLI's JSON peak data. A
 *  dual-channel Recording is split into one peak series per channel; a
 *  single-channel Recording produces one series.
 *
 * @remarks
 *  Trigger.dev's Audio Waveform build extension installs the CLI in the
 *  deployed task image only, so the local Dev runner needs audiowaveform on
 *  its PATH. 50 pixels per second keeps a long Call's peaks small while
 *  leaving detail for client zoom, and 8-bit peaks are enough for drawing.
 *  Errors carry a stable reason instead of CLI output.
 *
 * @see
 *  data/recording-waveform.ts
 *  trigger.config.ts
 *  https://github.com/bbc/audiowaveform
 *  https://trigger.dev/docs/config/extensions/audioWaveform
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

export const waveformPixelsPerSecond = 50;

export interface AudiowaveformData {
  version: number;
  channels: number;
  sample_rate: number;
  samples_per_pixel: number;
  bits: number;
  length: number;
  data: number[];
}

export interface WaveformPeakGenerator {
  generate(wav: Uint8Array, options: { splitChannels: boolean }): Promise<AudiowaveformData>;
}

export class AudiowaveformError extends Error {
  constructor() {
    super("audiowaveform could not generate peaks");
    this.name = "AudiowaveformError";
  }
}

const run = promisify(execFile);

export function createAudiowaveformPeakGenerator(options: { command?: string } = {}): WaveformPeakGenerator {
  const command = options.command ?? "audiowaveform";
  return {
    async generate(wav, { splitChannels }) {
      const directory = await mkdtemp(join(tmpdir(), "recording-waveform-"));
      try {
        const input = join(directory, "recording.wav");
        const output = join(directory, "peaks.json");
        await writeFile(input, wav);
        const args = ["-i", input, "-o", output, "--pixels-per-second", String(waveformPixelsPerSecond), "-b", "8"];
        await run(command, splitChannels ? [...args, "--split-channels"] : args).catch(() => {
          throw new AudiowaveformError();
        });
        return JSON.parse(await readFile(output, "utf8")) as AudiowaveformData;
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
