/**
 * -------------------------------------------------------------------------
 * @file   route.ts
 * @brief  Mounts the public Twilio webhook endpoints.
 *
 * @description
 *  Creates the request-scoped Twilio webhook handler for voice requests sent
 *  to Number Assignment URLs.
 *
 * @remarks
 *  These endpoints carry no session; the handler authenticates every request
 *  with the Twilio signature instead.
 *
 * @see
 *  data/twilio-webhook-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createTwilioWebhookHandler } from "@/data/twilio-webhook-handler";
import { withTracerRuntime } from "@/data/tracer-runtime";

async function handle(request: Request): Promise<Response> {
  return withTracerRuntime((runtime) => createTwilioWebhookHandler(runtime)(request));
}

export const POST = handle;
