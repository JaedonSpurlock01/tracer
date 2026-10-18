/**
 * -------------------------------------------------------------------------
 * @file   transcript.test.ts
 * @brief  Verifies normalized speaker Transcript turns and transcription cost.
 *
 * @description
 *  Checks that Caller and Business segments from separate channel chunks are
 *  placed on the Recording timeline with their chunk offsets, ordered by
 *  start time, cleaned of empty text, and merged into turns when one speaker
 *  continues without a pause, that persisted turns are validated, and that
 *  transcription cost follows the transcribed audio minutes.
 *
 * @see
 *  data/transcript.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { normalizeTranscript, parseTranscriptTurns, TranscriptError, transcriptionCostUsd } from "@/data/transcript";

describe("Transcript normalization", () => {
  it("interleaves Caller and Business segments by start time with speaker labels from their channels", () => {
    const turns = normalizeTranscript([
      { speaker: "Caller", offsetMs: 0, segments: [{ startMs: 0, endMs: 2000, text: "Hi, I need a quote." }, { startMs: 6000, endMs: 8000, text: "Thursday works." }] },
      { speaker: "Business", offsetMs: 0, segments: [{ startMs: 2500, endMs: 5000, text: "Sure, when are you free?" }] },
    ]);

    expect(turns).toEqual([
      { speaker: "Caller", startMs: 0, endMs: 2000, text: "Hi, I need a quote." },
      { speaker: "Business", startMs: 2500, endMs: 5000, text: "Sure, when are you free?" },
      { speaker: "Caller", startMs: 6000, endMs: 8000, text: "Thursday works." },
    ]);
  });

  it("places each chunk's segments on the Recording timeline with the chunk offset", () => {
    const turns = normalizeTranscript([
      { speaker: "Caller", offsetMs: 0, segments: [{ startMs: 1000, endMs: 2000, text: "First chunk." }] },
      { speaker: "Caller", offsetMs: 1_200_000, segments: [{ startMs: 500, endMs: 1500, text: "Second chunk." }] },
    ]);

    expect(turns).toEqual([
      { speaker: "Caller", startMs: 1000, endMs: 2000, text: "First chunk." },
      { speaker: "Caller", startMs: 1_200_500, endMs: 1_201_500, text: "Second chunk." },
    ]);
  });

  it("merges consecutive segments from one speaker separated by less than two seconds and keeps a longer pause as a new turn", () => {
    const turns = normalizeTranscript([
      {
        speaker: "Caller",
        offsetMs: 0,
        segments: [
          { startMs: 0, endMs: 2000, text: "My water heater" },
          { startMs: 2400, endMs: 4000, text: "is leaking." },
          { startMs: 7000, endMs: 9000, text: "Hello?" },
        ],
      },
    ]);

    expect(turns).toEqual([
      { speaker: "Caller", startMs: 0, endMs: 4000, text: "My water heater is leaking." },
      { speaker: "Caller", startMs: 7000, endMs: 9000, text: "Hello?" },
    ]);
  });

  it("drops segments without text", () => {
    const turns = normalizeTranscript([
      { speaker: "Caller", offsetMs: 0, segments: [{ startMs: 0, endMs: 1000, text: "  " }, { startMs: 3000, endMs: 4000, text: "Hi." }] },
      { speaker: "Business", offsetMs: 0, segments: [{ startMs: 1000, endMs: 2000, text: "" }] },
    ]);

    expect(turns).toEqual([{ speaker: "Caller", startMs: 3000, endMs: 4000, text: "Hi." }]);
  });

  it("drops segments Whisper likely invented on silence and keeps segments without no-speech scores", () => {
    const turns = normalizeTranscript([
      {
        speaker: "Caller",
        offsetMs: 0,
        segments: [
          { startMs: 0, endMs: 2000, text: "Hi, I need a quote.", noSpeechProb: 0.01, avgLogprob: -0.2 },
          { startMs: 5000, endMs: 6000, text: "Thank you for watching.", noSpeechProb: 0.82, avgLogprob: -1.4 },
          { startMs: 9000, endMs: 10000, text: "Hello?", noSpeechProb: 0.7, avgLogprob: -0.5 },
          { startMs: 13000, endMs: 14000, text: "Still there?", noSpeechProb: 0.4, avgLogprob: -1.6 },
          { startMs: 17000, endMs: 18000, text: "Okay." },
        ],
      },
    ]);

    expect(turns.map((turn) => turn.text)).toEqual(["Hi, I need a quote.", "Hello?", "Still there?", "Okay."]);
  });

  it("produces no turns from silent audio", () => {
    expect(normalizeTranscript([{ speaker: "Caller", offsetMs: 0, segments: [] }])).toEqual([]);
  });
});

describe("Transcript turns", () => {
  const turn = { speaker: "Caller", startMs: 0, endMs: 1000, text: "Hi." };

  it("accepts ordered Caller and Business turns", () => {
    expect(parseTranscriptTurns([turn, { ...turn, speaker: "Business", startMs: 1000, endMs: 2000 }])).toHaveLength(2);
    expect(parseTranscriptTurns([])).toEqual([]);
  });

  it("rejects turns with an unknown speaker, invalid times, empty text, or extra fields", () => {
    const invalid = [
      {},
      [{ ...turn, speaker: "Mixed" }],
      [{ ...turn, startMs: -1 }],
      [{ ...turn, startMs: 1.5 }],
      [{ ...turn, endMs: 0, startMs: 10 }],
      [{ ...turn, text: " " }],
      [{ ...turn, extra: true }],
    ];
    for (const value of invalid) expect(() => parseTranscriptTurns(value)).toThrow(new TranscriptError("Transcript turns are invalid"));
  });
});

describe("Transcription cost", () => {
  it("charges whisper-1's $0.006 per transcribed audio minute", () => {
    expect(transcriptionCostUsd(60_000)).toBe(0.006);
    expect(transcriptionCostUsd(2 * 90_000)).toBe(0.018);
    expect(transcriptionCostUsd(12_345)).toBe(0.001235);
  });
});
