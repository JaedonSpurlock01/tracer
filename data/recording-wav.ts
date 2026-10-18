/**
 * -------------------------------------------------------------------------
 * @file   recording-wav.ts
 * @brief  Splits a Recording's WAV into per-speaker chunks for transcription.
 *
 * @description
 *  Reads the 16-bit PCM WAV Twilio delivers, keeps only its first 3 hours,
 *  and yields mono WAV chunks per speaker: Caller from the first channel and
 *  Business from the second of a dual-channel Recording, or one Caller
 *  channel for a single-channel Recording such as a voicemail. Each chunk is
 *  at most 20 minutes and below OpenAI's 25 MB upload limit and carries its
 *  offset from the start of the Recording, so transcript timestamps can be
 *  placed back on the Recording's timeline. Audio that is not a 16-bit PCM
 *  WAV with one or two channels is rejected with a stable reason.
 *
 * @remarks
 *  Twilio places the parent call leg, the caller, on the first channel of a
 *  dual-channel Dial recording, which is the same lane mapping the waveform
 *  uses. Chunks are built one at a time by a generator so only the source
 *  WAV and one chunk are in memory. A tail shorter than one second is folded
 *  into the previous chunk because OpenAI rejects very short audio; the
 *  chunk byte cap leaves room for that second.
 *
 * @see
 *  data/recording-waveform.ts
 *  data/recording-transcription.ts
 *  https://www.twilio.com/docs/voice/twiml/dial#record
 *  https://developers.openai.com/api/docs/guides/speech-to-text
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export type TranscriptSpeaker = "Caller" | "Business";

export const maxTranscribedMs = 3 * 60 * 60 * 1000;

export const maxChunkBytes = 24_000_000;

const maxChunkMs = 20 * 60 * 1000;
const headerBytes = 44;
const bytesPerSample = 2;

export interface AudioChunk {
  speaker: TranscriptSpeaker;
  offsetMs: number;
  durationMs: number;
  wav: Uint8Array;
}

export interface RecordingAudio {
  channels: 1 | 2;
  sampleRate: number;
  frames: number;
  durationMs: number;
  transcribedMs: number;
  chunks(): Generator<AudioChunk>;
}

export class RecordingAudioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingAudioError";
  }
}

function tag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function frameMs(frames: number, sampleRate: number): number {
  return Math.round((frames * 1000) / sampleRate);
}

function monoWav(sampleRate: number, samples: Int16Array): Uint8Array {
  const dataSize = samples.length * bytesPerSample;
  const bytes = new Uint8Array(headerBytes + dataSize);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, 36 + dataSize, true);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, dataSize, true);
  for (let index = 0; index < samples.length; index += 1) view.setInt16(headerBytes + index * bytesPerSample, samples[index], true);
  return bytes;
}

export function readRecordingAudio(wav: Uint8Array): RecordingAudio {
  if (wav.byteLength < 12 || tag(wav, 0) !== "RIFF" || tag(wav, 8) !== "WAVE") throw new RecordingAudioError("Recording audio is not a WAV file");
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let format: { encoding: number; channels: number; sampleRate: number; bits: number } | null = null;
  let data: { offset: number; size: number } | null = null;
  for (let offset = 12; offset + 8 <= wav.byteLength && !data; ) {
    const size = view.getUint32(offset + 4, true);
    if (tag(wav, offset) === "fmt " && offset + 24 <= wav.byteLength) {
      format = { encoding: view.getUint16(offset + 8, true), channels: view.getUint16(offset + 10, true), sampleRate: view.getUint32(offset + 12, true), bits: view.getUint16(offset + 22, true) };
    } else if (tag(wav, offset) === "data") {
      data = { offset: offset + 8, size: Math.min(size, wav.byteLength - offset - 8) };
    }
    offset += 8 + size + (size % 2);
  }
  if (!format || !data) throw new RecordingAudioError("Recording audio is not a WAV file");
  if (format.encoding !== 1 || format.bits !== 16 || (format.channels !== 1 && format.channels !== 2) || format.sampleRate === 0) {
    throw new RecordingAudioError("Recording audio encoding is not supported");
  }
  const channels = format.channels as 1 | 2;
  const sampleRate = format.sampleRate;
  const dataOffset = data.offset;
  const frames = Math.floor(data.size / (channels * bytesPerSample));
  const transcribedFrames = Math.min(frames, (maxTranscribedMs / 1000) * sampleRate);
  const framesPerChunk = Math.min((maxChunkMs / 1000) * sampleRate, Math.floor((maxChunkBytes - headerBytes) / bytesPerSample) - sampleRate);

  function* chunks(): Generator<AudioChunk> {
    for (let channel = 0; channel < channels; channel += 1) {
      for (let start = 0; start < transcribedFrames; ) {
        let end = Math.min(start + framesPerChunk, transcribedFrames);
        if (transcribedFrames - end < sampleRate) end = transcribedFrames;
        const samples = new Int16Array(end - start);
        for (let frame = start; frame < end; frame += 1) samples[frame - start] = view.getInt16(dataOffset + (frame * channels + channel) * bytesPerSample, true);
        yield {
          speaker: channel === 0 ? "Caller" : "Business",
          offsetMs: frameMs(start, sampleRate),
          durationMs: frameMs(end, sampleRate) - frameMs(start, sampleRate),
          wav: monoWav(sampleRate, samples),
        };
        start = end;
      }
    }
  }

  return { channels, sampleRate, frames, durationMs: frameMs(frames, sampleRate), transcribedMs: frameMs(transcribedFrames, sampleRate), chunks };
}
