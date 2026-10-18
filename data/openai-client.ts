/**
 * -------------------------------------------------------------------------
 * @file   openai-client.ts
 * @brief  Calls OpenAI to transcribe audio chunks and request structured output.
 *
 * @description
 *  Sends one mono WAV chunk to the transcription endpoint with whisper-1,
 *  English, and verbose_json segment timestamps, and returns its segments
 *  with start and end in milliseconds and, when present, each segment's
 *  no-speech probability and average log probability. Sends instructions and input to the
 *  Responses API with a strict JSON schema and returns the output text with
 *  its input and output token counts. Malformed, refused, or incomplete
 *  responses are rejected with a stable reason.
 *
 * @remarks
 *  The client uses fetch instead of the OpenAI SDK so the task bundle gains
 *  no dependency. Errors carry only the HTTP status or a fixed reason, never
 *  the API key, OpenAI's error body, Transcript text, or model output, so
 *  they are safe to persist as failure reasons and to log. A rejected
 *  request a retry cannot fix (HTTP 400, 401, 403, 404, 413, or 422) is
 *  marked not retryable; rate limits, server errors, an unreachable or slow
 *  OpenAI, and invalid responses stay retryable. Responses are
 *  sent with store disabled so OpenAI does not keep Transcript-derived
 *  conversations beyond the request. A generous timeout covers a 20-minute
 *  chunk while still ending a hung request inside the task's run time.
 *
 * @see
 *  data/recording-transcription.ts
 *  data/recording-lead-assessment.ts
 *  https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create
 *  https://developers.openai.com/api/docs/guides/structured-outputs
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export const transcriptionModel = "whisper-1";

export interface TranscriptionSegment {
  startMs: number;
  endMs: number;
  text: string;
  noSpeechProb?: number;
  avgLogprob?: number;
}

export interface AudioTranscriber {
  transcribe(wav: Uint8Array): Promise<TranscriptionSegment[]>;
}

export interface StructuredRequest {
  model: string;
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
}

export interface StructuredResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredResponder {
  respond(request: StructuredRequest): Promise<StructuredResponse>;
}

const permanentStatuses = new Set([400, 401, 403, 404, 413, 422]);

export class OpenAIError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = "OpenAIError";
    this.retryable = options.retryable ?? true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function segments(body: unknown): TranscriptionSegment[] {
  const invalid = new OpenAIError("OpenAI returned an invalid transcription");
  if (!isRecord(body)) throw invalid;
  if (body.segments === undefined) return [];
  if (!Array.isArray(body.segments)) throw invalid;
  return body.segments.map((segment: unknown) => {
    if (!isRecord(segment) || typeof segment.text !== "string") throw invalid;
    const { start, end } = segment;
    if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) throw invalid;
    const { no_speech_prob: noSpeechProb, avg_logprob: avgLogprob } = segment;
    if (![noSpeechProb, avgLogprob].every((score) => score === undefined || (typeof score === "number" && Number.isFinite(score)))) throw invalid;
    return {
      startMs: Math.round(start * 1000),
      endMs: Math.round(end * 1000),
      text: segment.text.trim(),
      ...(noSpeechProb === undefined ? {} : { noSpeechProb: noSpeechProb as number }),
      ...(avgLogprob === undefined ? {} : { avgLogprob: avgLogprob as number }),
    };
  });
}

function structured(body: unknown): StructuredResponse {
  const invalid = new OpenAIError("OpenAI returned an invalid response");
  if (!isRecord(body)) throw invalid;
  if (body.status === "incomplete") throw new OpenAIError("OpenAI response was incomplete");
  if (body.status !== "completed" || !Array.isArray(body.output) || !isRecord(body.usage)) throw invalid;
  const parts = body.output.flatMap((item: unknown) => (isRecord(item) && item.type === "message" && Array.isArray(item.content) ? item.content : []));
  if (parts.some((part: unknown) => isRecord(part) && part.type === "refusal")) throw new OpenAIError("OpenAI refused the request");
  const text = parts.find((part: unknown): part is { text: string } => isRecord(part) && part.type === "output_text" && typeof part.text === "string")?.text;
  const { input_tokens: inputTokens, output_tokens: outputTokens } = body.usage;
  if (text === undefined || !isCount(inputTokens) || !isCount(outputTokens)) throw invalid;
  return { text, inputTokens, outputTokens };
}

export function createOpenAIClient(options: { apiKey: string; fetch?: typeof fetch; baseUrl?: string; timeoutMs?: number }): AudioTranscriber & StructuredResponder {
  const request = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "https://api.openai.com/v1";

  async function send(path: string, init: { headers?: Record<string, string>; body: BodyInit }): Promise<unknown> {
    let response: Response;
    try {
      response = await request(`${baseUrl}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}`, ...init.headers },
        body: init.body,
        signal: AbortSignal.timeout(options.timeoutMs ?? 600_000),
      });
    } catch {
      throw new OpenAIError("OpenAI is unavailable");
    }
    if (!response.ok) throw new OpenAIError(`OpenAI request failed (HTTP ${response.status})`, { retryable: !permanentStatuses.has(response.status) });
    return response.json().catch(() => null);
  }

  return {
    async transcribe(wav) {
      const form = new FormData();
      form.append("file", new File([wav as unknown as BlobPart], "audio.wav", { type: "audio/wav" }));
      form.append("model", transcriptionModel);
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "segment");
      form.append("language", "en");
      return segments(await send("/audio/transcriptions", { body: form }));
    },

    async respond(structuredRequest) {
      const body = {
        model: structuredRequest.model,
        instructions: structuredRequest.instructions,
        input: structuredRequest.input,
        store: false,
        text: { format: { type: "json_schema", name: structuredRequest.schemaName, strict: true, schema: structuredRequest.schema } },
      };
      return structured(await send("/responses", { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    },
  };
}
