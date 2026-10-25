/**
 * -------------------------------------------------------------------------
 * @file   openai-runtime.ts
 * @brief  Chooses the OpenAI structured responder for a Worker request.
 *
 * @description
 *  Returns the E2E fake when E2E_OPENAI_FAKE is enabled outside
 *  production, the real client when an API key is present, and nothing
 *  otherwise so the routes that need it answer 503.
 *
 * @remarks
 *  Request-time OpenAI calls (Keyword Discovery) get a one-minute timeout
 *  instead of the task client's twenty minutes, because the Operator is
 *  waiting on the page.
 *
 * @see
 *  data/openai-client.ts
 *  data/e2e-openai-fake.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createE2eOpenAIFake } from "@/data/e2e-openai-fake";
import { createOpenAIClient, type StructuredResponder } from "@/data/openai-client";

export function isE2eOpenAIFake(): boolean {
  return process.env.E2E_OPENAI_FAKE === "true" && process.env.NODE_ENV !== "production";
}

export function createRuntimeStructuredResponder(apiKey: string | undefined): StructuredResponder | undefined {
  if (isE2eOpenAIFake()) return createE2eOpenAIFake();
  return apiKey ? createOpenAIClient({ apiKey, timeoutMs: 60_000 }) : undefined;
}
