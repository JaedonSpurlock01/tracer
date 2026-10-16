/**
 * -------------------------------------------------------------------------
 * @file   twilio-webhook-handler.ts
 * @brief  Receives Twilio voice webhooks for Number Assignments.
 *
 * @description
 *  Resolves the Organization from the Number Assignment in the webhook URL,
 *  validates the X-Twilio-Signature with that Organization's Auth Token, and
 *  answers accepted requests with TwiML.
 *
 * @remarks
 *  Twilio signs the exact voice URL Tracer configured during activation, so
 *  the signed URL is rebuilt from the configured base URL rather than from the
 *  incoming request, which a proxy may rewrite. Every rejection returns the
 *  same 403 so unknown assignments cannot be distinguished from bad signatures.
 *
 * @see
 *  data/twilio-signature.ts
 *  data/workspace-routing.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import { decryptSecret } from "@/data/credential-encryption";
import { createInboundCalls } from "@/data/inbound-calls";
import { isValidTwilioSignature } from "@/data/twilio-signature";

export interface TwilioWebhookHandlerOptions {
  pool: Pool;
  masterKey: string | undefined;
  baseURL: string;
}

const voiceRoute = /^\/api\/twilio\/voice\/([^/]+)$/;

function twiml(document: string): Response {
  return new Response(document, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

function forbidden(): Response {
  return new Response("Forbidden", { status: 403 });
}

async function readParams(request: Request): Promise<Record<string, string>> {
  return Object.fromEntries(new URLSearchParams(await request.text()));
}

async function assignmentAuthToken(options: TwilioWebhookHandlerOptions, assignmentId: string): Promise<string | null> {
  if (!options.masterKey) return null;
  const result = await options.pool.query<{ auth_token_ciphertext: string | null }>(
    `select c.auth_token_ciphertext
       from number_assignment a
       join twilio_connection c on c.organization_id = a.organization_id
      where a.id = $1`,
    [assignmentId],
  );
  const ciphertext = result.rows[0]?.auth_token_ciphertext;
  if (!ciphertext) return null;
  try {
    return await decryptSecret(options.masterKey, ciphertext);
  } catch {
    return null;
  }
}

export function createTwilioWebhookHandler(options: TwilioWebhookHandlerOptions): (request: Request) => Promise<Response> {
  const baseURL = options.baseURL.replace(/\/$/, "");
  return async (request) => {
    const path = new URL(request.url).pathname;
    const voice = voiceRoute.exec(path);
    if (request.method !== "POST" || !voice) return new Response("Not Found", { status: 404 });
    const params = await readParams(request);
    const authToken = await assignmentAuthToken(options, voice[1]);
    const signature = request.headers.get("x-twilio-signature");
    if (!authToken || !(await isValidTwilioSignature({ authToken, url: `${baseURL}${path}`, params, signature }))) {
      return forbidden();
    }
    const assignmentId = voice[1];
    const result = await createInboundCalls({ pool: options.pool }).receiveVoiceWebhook(assignmentId, params, {
      forwardAction: (nodeId) => `${baseURL}/api/twilio/forward/${assignmentId}?node=${encodeURIComponent(nodeId)}`,
      forwardStatus: (nodeId) => `${baseURL}/api/twilio/forward-status/${assignmentId}?node=${encodeURIComponent(nodeId)}`,
    });
    if (result.kind !== "call") return forbidden();
    return twiml(result.twiml);
  };
}
