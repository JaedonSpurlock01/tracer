/**
 * -------------------------------------------------------------------------
 * @file   recording-wav.test.ts
 * @brief  Verifies reading, splitting, truncating, and chunking Recording WAVs.
 *
 * @description
 *  Checks that the 16-bit PCM WAV Twilio delivers is read with its channel
 *  count and duration, that a dual-channel Recording splits into Caller and
 *  Business mono chunks, that a single-channel Recording is one Caller
 *  channel, that only the first 3 hours are kept, that each chunk stays
 *  below OpenAI's upload limit with its offset, and that unsupported audio
 *  is rejected with a stable reason.
 *
 * @remarks
 *  Long Recordings use a low synthetic sample rate so a 3-hour WAV stays a
 *  few megabytes. The Twilio WAV fixture is a short synthetic recording.
 *
 * @see
 *  data/recording-wav.ts
 *  https://www.twilio.com/docs/voice/api/recording#fetch-a-recording-media-file
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { maxChunkBytes, maxTranscribedMs, readRecordingAudio, RecordingAudioError } from "@/data/recording-wav";

const twilioWav = new Uint8Array(readFileSync(new URL("./fixtures/twilio/recording.wav", import.meta.url)));

function pcmWav(options: { channels: 1 | 2; sampleRate: number; frames: number; sample?: (frame: number, channel: number) => number; format?: number; bits?: number }): Uint8Array {
  const bits = options.bits ?? 16;
  const blockAlign = options.channels * (bits / 8);
  const dataSize = options.frames * blockAlign;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, 36 + dataSize, true);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, options.format ?? 1, true);
  view.setUint16(22, options.channels, true);
  view.setUint32(24, options.sampleRate, true);
  view.setUint32(28, options.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bits, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, dataSize, true);
  if (bits === 16) {
    for (let frame = 0; frame < options.frames; frame += 1) {
      for (let channel = 0; channel < options.channels; channel += 1) {
        view.setInt16(44 + (frame * options.channels + channel) * 2, options.sample?.(frame, channel) ?? 0, true);
      }
    }
  }
  return bytes;
}

function samples(wav: Uint8Array): number[] {
  const audio = readRecordingAudio(wav);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  return Array.from({ length: audio.frames * audio.channels }, (_, index) => view.getInt16(44 + index * 2, true));
}

describe("Recording WAV", () => {
  it("reads the mono 16-bit PCM WAV Twilio delivers as one Caller channel", () => {
    const audio = readRecordingAudio(twilioWav);
    const chunks = [...audio.chunks()];

    expect(audio).toMatchObject({ channels: 1, sampleRate: 8000, frames: 16, durationMs: 2 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ speaker: "Caller", offsetMs: 0, durationMs: 2 });
    expect(chunks[0].wav).toEqual(twilioWav);
  });

  it("splits a dual-channel Recording into Caller from the first channel and Business from the second", () => {
    const wav = pcmWav({ channels: 2, sampleRate: 8000, frames: 4, sample: (frame, channel) => (channel === 0 ? 100 + frame : -200 - frame) });

    const chunks = [...readRecordingAudio(wav).chunks()];

    expect(chunks.map((chunk) => chunk.speaker)).toEqual(["Caller", "Business"]);
    expect(readRecordingAudio(chunks[0].wav)).toMatchObject({ channels: 1, sampleRate: 8000, frames: 4 });
    expect(samples(chunks[0].wav)).toEqual([100, 101, 102, 103]);
    expect(samples(chunks[1].wav)).toEqual([-200, -201, -202, -203]);
  });

  it("chunks each channel into 20-minute WAVs below OpenAI's upload limit with each chunk's offset", () => {
    const sampleRate = 100;
    const wav = pcmWav({ channels: 2, sampleRate, frames: 45 * 60 * sampleRate });

    const chunks = [...readRecordingAudio(wav).chunks()];

    expect(chunks.map(({ speaker, offsetMs, durationMs }) => ({ speaker, offsetMs, durationMs }))).toEqual([
      { speaker: "Caller", offsetMs: 0, durationMs: 1_200_000 },
      { speaker: "Caller", offsetMs: 1_200_000, durationMs: 1_200_000 },
      { speaker: "Caller", offsetMs: 2_400_000, durationMs: 300_000 },
      { speaker: "Business", offsetMs: 0, durationMs: 1_200_000 },
      { speaker: "Business", offsetMs: 1_200_000, durationMs: 1_200_000 },
      { speaker: "Business", offsetMs: 2_400_000, durationMs: 300_000 },
    ]);
    expect(Math.max(...chunks.map((chunk) => chunk.wav.byteLength))).toBeLessThan(maxChunkBytes);
  });

  it("keeps a high-sample-rate chunk below OpenAI's upload limit", () => {
    const sampleRate = 48_000;
    const wav = pcmWav({ channels: 1, sampleRate, frames: 5 * 60 * sampleRate });

    const chunks = [...readRecordingAudio(wav).chunks()];

    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((chunk) => chunk.wav.byteLength))).toBeLessThanOrEqual(maxChunkBytes);
    expect(chunks.reduce((total, chunk) => total + chunk.durationMs, 0)).toBe(300_000);
  });

  it("folds a tail shorter than one second into the previous chunk instead of sending a tiny file", () => {
    const sampleRate = 100;
    const wav = pcmWav({ channels: 1, sampleRate, frames: 20 * 60 * sampleRate + 50 });

    const chunks = [...readRecordingAudio(wav).chunks()];

    expect(chunks.map(({ offsetMs, durationMs }) => ({ offsetMs, durationMs }))).toEqual([{ offsetMs: 0, durationMs: 1_200_500 }]);
  });

  it("transcribes only the first 3 hours of a longer Recording", () => {
    const sampleRate = 100;
    const wav = pcmWav({ channels: 2, sampleRate, frames: 3.5 * 60 * 60 * sampleRate });

    const audio = readRecordingAudio(wav);
    const chunks = [...audio.chunks()];

    expect(audio.durationMs).toBe(12_600_000);
    expect(audio.transcribedMs).toBe(maxTranscribedMs);
    expect(maxTranscribedMs).toBe(10_800_000);
    expect(chunks).toHaveLength(18);
    expect(Math.max(...chunks.map((chunk) => chunk.offsetMs + chunk.durationMs))).toBe(maxTranscribedMs);
  });

  it("reads past extra chunks before the audio data and clamps a data size longer than the file", () => {
    const base = pcmWav({ channels: 1, sampleRate: 8000, frames: 8, sample: (frame) => frame });
    const list = new Uint8Array([...new TextEncoder().encode("LIST"), 3, 0, 0, 0, 1, 2, 3, 0]);
    const wav = new Uint8Array([...base.subarray(0, 36), ...list, ...base.subarray(36)]);
    new DataView(wav.buffer).setUint32(36 + list.byteLength + 4, 0xffffffff, true);

    const audio = readRecordingAudio(wav);

    expect(audio).toMatchObject({ channels: 1, sampleRate: 8000, frames: 8 });
    expect(samples([...audio.chunks()][0].wav)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("rejects audio that is not a WAV file with a stable reason", () => {
    expect(() => readRecordingAudio(new TextEncoder().encode("ID3 not a wav"))).toThrow(new RecordingAudioError("Recording audio is not a WAV file"));
  });

  it("rejects WAV encodings other than 16-bit PCM with one or two channels with a stable reason", () => {
    const reason = new RecordingAudioError("Recording audio encoding is not supported");

    expect(() => readRecordingAudio(pcmWav({ channels: 1, sampleRate: 8000, frames: 4, format: 7, bits: 8 }))).toThrow(reason);
    expect(() => readRecordingAudio(pcmWav({ channels: 1, sampleRate: 8000, frames: 4, bits: 8 }))).toThrow(reason);
  });
});
