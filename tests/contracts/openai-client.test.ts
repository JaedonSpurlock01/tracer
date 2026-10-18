/**
 * -------------------------------------------------------------------------
 * @file   openai-client.test.ts
 * @brief  Verifies the OpenAI transcription and Responses API contracts.
 *
 * @description
 *  Checks the multipart transcription request Tracer sends for one audio
 *  chunk, the parsing of verbose_json segments into millisecond segments,
 *  the strict structured-output Responses request, the output text and
 *  token usage read back, and safe errors that never expose the API key,
 *  the provider's error body, or Transcript text.
 *
 * @remarks
 *  Fixtures follow the documented response shapes and contain synthetic
 *  speech. No request reaches OpenAI.
 *
 * @see
 *  data/openai-client.ts
 *  https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create
 *  https://developers.openai.com/api/docs/guides/structured-outputs
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it, vi } from "vitest";

import { leadAssessmentRequest, parseLeadAssessment } from "@/data/lead-assessment";
import { createOpenAIClient, OpenAIError } from "@/data/openai-client";

import errorBody from "./fixtures/openai/error.json";
import incomplete from "./fixtures/openai/incomplete-response.json";
import assessmentResponse from "./fixtures/openai/lead-assessment-response.json";
import refusal from "./fixtures/openai/refusal-response.json";
import verbose from "./fixtures/openai/transcription-verbose.json";

const apiKey = "sk-synthetic-openai-api-key-fixture";
const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function client(fetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response>, timeoutMs?: number) {
  return createOpenAIClient({ apiKey, fetch: fetch as typeof globalThis.fetch, timeoutMs });
}

const structuredRequest = {
  model: "gpt-5-mini",
  instructions: "Assess the call.",
  input: "Workspace: Example Plumbing",
  schemaName: "lead_assessment",
  schema: { type: "object", properties: { score: { type: "integer" } }, required: ["score"], additionalProperties: false },
};

async function failure(promise: Promise<unknown>): Promise<Error> {
  const error = await promise.catch((value: unknown) => value);
  expect(error).toBeInstanceOf(OpenAIError);
  expect((error as Error).message).not.toContain(apiKey);
  return error as Error;
}

describe("OpenAI transcription", () => {
  it("posts one audio chunk as multipart form data for whisper-1 English verbose_json segments", async () => {
    const fetch = vi.fn(async () => json(verbose));

    await client(fetch).transcribe(wav);

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: `Bearer ${apiKey}` });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.getAll("timestamp_granularities[]")).toEqual(["segment"]);
    expect(form.get("language")).toBe("en");
    const file = form.get("file") as File;
    expect(file.name).toBe("audio.wav");
    expect(file.type).toBe("audio/wav");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(wav);
  });

  it("reads each segment's start and end in milliseconds, its trimmed text, and its no-speech scores", async () => {
    const fetch = vi.fn(async () => json(verbose));

    await expect(client(fetch).transcribe(wav)).resolves.toEqual([
      { startMs: 0, endMs: 3960, text: "Hi, I'm calling about a quote for a new water heater.", noSpeechProb: 0.01, avgLogprob: -0.21 },
      { startMs: 4500, endMs: 6880, text: "Is someone available this week?", noSpeechProb: 0.02, avgLogprob: -0.19 },
      { startMs: 7200, endMs: 9420, text: "Thank you.", noSpeechProb: 0.83, avgLogprob: -1.38 },
    ]);
  });

  it("reads a segment without no-speech scores as plain text", async () => {
    const plain: Record<string, unknown> = { ...verbose.segments[0] };
    delete plain.no_speech_prob;
    delete plain.avg_logprob;
    const fetch = vi.fn(async () => json({ ...verbose, segments: [plain] }));

    await expect(client(fetch).transcribe(wav)).resolves.toEqual([{ startMs: 0, endMs: 3960, text: "Hi, I'm calling about a quote for a new water heater." }]);
  });

  it("reads a response without segments as no speech", async () => {
    const fetch = vi.fn(async () => json({ ...verbose, text: "", segments: [] }));

    await expect(client(fetch).transcribe(wav)).resolves.toEqual([]);
  });

  it("rejects malformed segments with a stable reason that never repeats Transcript text", async () => {
    const malformed = [
      { ...verbose, segments: "none" },
      { ...verbose, segments: [{ ...verbose.segments[0], start: "zero" }] },
      { ...verbose, segments: [{ ...verbose.segments[0], start: 5, end: 1 }] },
      { ...verbose, segments: [{ ...verbose.segments[0], text: 42 }] },
      { ...verbose, segments: [{ ...verbose.segments[0], no_speech_prob: "high" }] },
      { ...verbose, segments: [{ ...verbose.segments[0], avg_logprob: null }] },
    ];
    for (const body of malformed) {
      const error = await failure(client(vi.fn(async () => json(body))).transcribe(wav));
      expect(error.message).toBe("OpenAI returned an invalid transcription");
    }
  });

  it("rejects a non-success response with only its HTTP status, never the API key or the provider error body", async () => {
    const error = await failure(client(vi.fn(async () => json(errorBody, 401))).transcribe(wav));

    expect(error.message).toBe("OpenAI request failed (HTTP 401)");
    expect(error.message).not.toContain("sk-synth");
  });

  it("rejects an unreachable or slow OpenAI as unavailable", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError(`fetch failed for ${apiKey}`);
    });
    const slow = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    }));

    expect((await failure(client(offline).transcribe(wav))).message).toBe("OpenAI is unavailable");
    expect((await failure(client(slow, 10).transcribe(wav))).message).toBe("OpenAI is unavailable");
  });
});

describe("OpenAI error retryability", () => {
  it("marks rate limits, server errors, and an unreachable or slow OpenAI as retryable", async () => {
    for (const status of [429, 500, 502, 503]) {
      const error = await failure(client(vi.fn(async () => json(errorBody, status))).transcribe(wav));
      expect((error as OpenAIError).retryable).toBe(true);
    }
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(((await failure(client(offline).respond(structuredRequest))) as OpenAIError).retryable).toBe(true);
  });

  it("marks rejected requests that a retry cannot fix as not retryable", async () => {
    for (const status of [400, 401, 403, 404, 413, 422]) {
      const error = await failure(client(vi.fn(async () => json(errorBody, status))).respond(structuredRequest));
      expect((error as OpenAIError).retryable).toBe(false);
    }
  });

  it("keeps an invalid, refused, or incomplete response retryable", async () => {
    for (const body of [{ ...verbose, segments: "none" }]) {
      expect(((await failure(client(vi.fn(async () => json(body))).transcribe(wav))) as OpenAIError).retryable).toBe(true);
    }
    for (const body of [refusal, incomplete]) {
      expect(((await failure(client(vi.fn(async () => json(body))).respond(structuredRequest))) as OpenAIError).retryable).toBe(true);
    }
  });
});

describe("OpenAI structured responses", () => {
  it("posts instructions and input to the Responses API with a strict JSON schema and without storing the response", async () => {
    const fetch = vi.fn(async () => json(assessmentResponse));

    await client(fetch).respond(structuredRequest);

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: `Bearer ${apiKey}`, "content-type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-5-mini",
      instructions: "Assess the call.",
      input: "Workspace: Example Plumbing",
      store: false,
      text: { format: { type: "json_schema", name: "lead_assessment", strict: true, schema: structuredRequest.schema } },
    });
  });

  it("reads the output text and the input and output token usage", async () => {
    const fetch = vi.fn(async () => json(assessmentResponse));

    await expect(client(fetch).respond(structuredRequest)).resolves.toEqual({
      text: assessmentResponse.output[1].content![0].text,
      inputTokens: 812,
      outputTokens: 436,
    });
  });

  it("rejects a refusal, an incomplete response, or missing usage with a stable reason that never repeats model output", async () => {
    const refused = await failure(client(vi.fn(async () => json(refusal))).respond(structuredRequest));
    const cutOff = await failure(client(vi.fn(async () => json(incomplete))).respond(structuredRequest));
    const noUsage = await failure(client(vi.fn(async () => json({ ...assessmentResponse, usage: null }))).respond(structuredRequest));

    expect(refused.message).toBe("OpenAI refused the request");
    expect(refused.message).not.toContain("sorry");
    expect(cutOff.message).toBe("OpenAI response was incomplete");
    expect(noUsage.message).toBe("OpenAI returned an invalid response");
  });

  it("rejects a non-success response with only its HTTP status", async () => {
    const error = await failure(client(vi.fn(async () => json(errorBody, 429))).respond(structuredRequest));

    expect(error.message).toBe("OpenAI request failed (HTTP 429)");
  });

  it("sends the Lead Assessment to gpt-5-mini under its strict schema and validates the recorded response against the Transcript", async () => {
    const fetch = vi.fn(async () => json(assessmentResponse));
    const turns = [
      { speaker: "Caller" as const, startMs: 0, endMs: 3960, text: "Hi, I'm calling about a quote for a new water heater." },
      { speaker: "Business" as const, startMs: 4500, endMs: 6880, text: "We can come out this week. What day works?" },
      { speaker: "Caller" as const, startMs: 7200, endMs: 8800, text: "Thursday morning works." },
    ];
    const request = leadAssessmentRequest("Example Plumbing", turns);

    const response = await client(fetch).respond(request);

    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ model: "gpt-5-mini", text: { format: { type: "json_schema", name: "lead_assessment", strict: true, schema: request.schema } } });
    expect(body.input).toContain("Workspace: Example Plumbing");
    expect(parseLeadAssessment(response.text, turns)).toMatchObject({
      classification: "Good Lead",
      score: 86,
      evidence: [
        { turnIndex: 0, startMs: 0 },
        { turnIndex: 2, startMs: 7200 },
      ],
    });
  });
});
