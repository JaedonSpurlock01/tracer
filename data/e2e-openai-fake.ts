/**
 * -------------------------------------------------------------------------
 * @file   e2e-openai-fake.ts
 * @brief  Provides the non-production E2E OpenAI structured-output fake.
 *
 * @description
 *  Answers a Keyword Discovery request with a predictable set of phrases
 *  built from the niche and Service Area in the request input, so browser
 *  journeys and local development run without an OpenAI key or bill.
 *
 * @remarks
 *  Only the structured responder is faked here; transcription and Lead
 *  Assessment run in Trigger.dev tasks with their own environment.
 *  Runtime selection is gated by E2E_OPENAI_FAKE and never applies in
 *  production.
 *
 * @see
 *  data/openai-runtime.ts
 *  data/keyword-discovery.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { StructuredResponder } from "@/data/openai-client";

function lineValue(input: string, label: string): string {
  return input.split("\n").find((line) => line.startsWith(`${label}: `))?.slice(label.length + 2).trim() ?? "";
}

export function createE2eOpenAIFake(): StructuredResponder {
  return {
    async respond(request) {
      const niche = lineValue(request.input, "Niche").toLowerCase() || "service";
      const city = lineValue(request.input, "Service Area").split(",")[0]?.trim().toLowerCase() || "near me";
      const phrases = [`${niche} ${city}`, `${niche} contractor ${city}`, `${niche} near me`, `${niche} cost ${city}`, `best ${niche} ${city}`];
      return { text: JSON.stringify({ phrases }), inputTokens: 50, outputTokens: 30 };
    },
  };
}
