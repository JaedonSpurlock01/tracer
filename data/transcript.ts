/**
 * -------------------------------------------------------------------------
 * @file   transcript.ts
 * @brief  Normalizes channel transcription segments into speaker Transcript turns.
 *
 * @description
 *  Places each chunk's segments on the Recording timeline with the chunk's
 *  offset, labels them with the speaker of the channel they came from,
 *  orders them by start time, drops segments without text or that Whisper
 *  likely invented on silence, and merges
 *  consecutive segments from one speaker separated by less than two seconds
 *  into one turn. Validates stored turns before they are persisted or read
 *  back, and prices transcription by transcribed audio minutes.
 *
 * @remarks
 *  Speaker labels come from the dual-channel Recording rather than
 *  diarization, so each channel is transcribed alone and the turns are
 *  merged afterwards. A pause of two seconds or more starts a new turn even
 *  for the same speaker so long monologues keep seekable timestamps. The
 *  database only checks that turns are an array, so the shape is enforced
 *  here. A segment is treated as invented on silence with Whisper's own
 *  no-speech rule, a no-speech probability above 0.6 together with an
 *  average log probability below -1, because Whisper hallucinates text on
 *  a silent channel; a segment without those scores is kept. Cost uses
 *  whisper-1's published $0.006 per minute, checked on 2026-10-17, summed
 *  across both channels because each is billed.
 *
 * @see
 *  data/recording-transcription.ts
 *  https://openai.com/api/pricing/
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { TranscriptionSegment } from "@/data/openai-client";
import type { TranscriptSpeaker } from "@/data/recording-wav";

export interface TranscriptTurn {
  speaker: TranscriptSpeaker;
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscribedChunk {
  speaker: TranscriptSpeaker;
  offsetMs: number;
  segments: TranscriptionSegment[];
}

const turnPauseMs = 2000;

const noSpeechThreshold = 0.6;

const logprobThreshold = -1;

export class TranscriptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptError";
  }
}

function likelySilence(segment: TranscriptionSegment): boolean {
  return segment.noSpeechProb !== undefined && segment.avgLogprob !== undefined && segment.noSpeechProb > noSpeechThreshold && segment.avgLogprob < logprobThreshold;
}

export function normalizeTranscript(chunks: TranscribedChunk[]): TranscriptTurn[] {
  const segments = chunks
    .flatMap((chunk) => chunk.segments.filter((segment) => !likelySilence(segment)).map((segment) => ({ speaker: chunk.speaker, startMs: chunk.offsetMs + segment.startMs, endMs: chunk.offsetMs + segment.endMs, text: segment.text.trim() })))
    .filter((segment) => segment.text !== "")
    .sort((left, right) => left.startMs - right.startMs);
  const turns: TranscriptTurn[] = [];
  for (const segment of segments) {
    const previous = turns.at(-1);
    if (previous?.speaker === segment.speaker && segment.startMs - previous.endMs < turnPauseMs) {
      previous.endMs = Math.max(previous.endMs, segment.endMs);
      previous.text = `${previous.text} ${segment.text}`;
    } else {
      turns.push(segment);
    }
  }
  return turns;
}

function isMs(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

export function parseTranscriptTurns(value: unknown): TranscriptTurn[] {
  if (!Array.isArray(value)) throw new TranscriptError("Transcript turns are invalid");
  return value.map((turn: unknown) => {
    const record = (typeof turn === "object" && turn !== null ? turn : {}) as Record<string, unknown>;
    const valid =
      Object.keys(record).length === 4 &&
      (record.speaker === "Caller" || record.speaker === "Business") &&
      isMs(record.startMs) &&
      isMs(record.endMs) &&
      record.endMs >= record.startMs &&
      typeof record.text === "string" &&
      record.text.trim() !== "";
    if (!valid) throw new TranscriptError("Transcript turns are invalid");
    return { speaker: record.speaker, startMs: record.startMs, endMs: record.endMs, text: record.text } as TranscriptTurn;
  });
}

export function transcriptionCostUsd(audioMs: number): number {
  return Math.round(audioMs / 10) / 1_000_000;
}
