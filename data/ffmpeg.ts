/**
 * -------------------------------------------------------------------------
 * @file   ffmpeg.ts
 * @brief  Encodes a Recording's WAV as an MP3 with the ffmpeg CLI.
 *
 * @description
 *  Writes a Recording's WAV to a temporary directory, runs ffmpeg on it
 *  with libmp3lame, and returns the encoded MP3's bytes. The MP3 keeps the
 *  WAV's channels, so a dual-channel Recording becomes a stereo MP3 with
 *  Caller on the left and Business on the right, and a voicemail stays
 *  mono.
 *
 * @remarks
 *  Twilio records phone audio at 8 kHz, so 64 kbps constant bitrate keeps
 *  speech clear on both channels while an hour stays near 29 MB. The MP3 is
 *  resampled to 16 kHz because 8 kHz MP3 is the MPEG-2.5 extension that
 *  some players reject, while 16 kHz MPEG-2 plays everywhere and loses
 *  nothing from narrowband audio. Trigger.dev's ffmpeg build extension
 *  installs the CLI in the deployed task image only, so the local Dev
 *  runner needs ffmpeg on its PATH. Errors carry a stable reason instead
 *  of CLI output.
 *
 * @see
 *  data/recording-mp3.ts
 *  trigger.config.ts
 *  https://ffmpeg.org/ffmpeg-codecs.html#libmp3lame-1
 *  https://trigger.dev/docs/config/extensions/ffmpeg
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

export const mp3BitrateKbps = 64;

export const mp3SampleRateHz = 16_000;

export interface Mp3Encoder {
  encode(wav: Uint8Array): Promise<Uint8Array>;
}

export class FfmpegError extends Error {
  constructor() {
    super("ffmpeg could not encode the MP3");
    this.name = "FfmpegError";
  }
}

const run = promisify(execFile);

export function createFfmpegMp3Encoder(options: { command?: string } = {}): Mp3Encoder {
  const command = options.command ?? "ffmpeg";
  return {
    async encode(wav) {
      const directory = await mkdtemp(join(tmpdir(), "recording-mp3-"));
      try {
        const input = join(directory, "recording.wav");
        const output = join(directory, "recording.mp3");
        await writeFile(input, wav);
        const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", input, "-vn", "-codec:a", "libmp3lame", "-b:a", `${mp3BitrateKbps}k`, "-ar", String(mp3SampleRateHz), output];
        await run(command, args).catch(() => {
          throw new FfmpegError();
        });
        return new Uint8Array(await readFile(output));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
