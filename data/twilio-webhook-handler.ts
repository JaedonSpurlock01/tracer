/**
 * -------------------------------------------------------------------------
 * @file   twilio-webhook-handler.ts
 * @brief  Receives Twilio voice and status webhooks for Number Assignments.
 *
 * @description
 *  Resolves the Organization from the Number Assignment in the webhook URL,
 *  validates the X-Twilio-Signature with that Organization's Auth Token, and
 *  hands accepted voice, Keypad Gate, Whisper, Forward Call, voicemail, and
 *  status callbacks to the Call lifecycle. Voice, gather, whisper, Forward
 *  Call, and voicemail action requests receive TwiML; status and recording
 *  status callbacks receive an empty 204.
 *
 * @remarks
 *  Twilio signs the exact URL Tracer configured, including its query string,
 *  so the signed URL is rebuilt from the configured base URL rather than from
 *  the incoming request, which a proxy may rewrite. Every rejection returns
 *  the same 403 so unknown assignments cannot be distinguished from bad
 *  signatures.
 *
 * @see
 *  data/twilio-signature.ts
 *  data/inbound-calls.ts
 *  data/workspace-routing.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import { decryptSecret } from "@/data/credential-encryption";
import { createInboundCalls } from "@/data/inbound-calls";
import { isValidTwilioSignature } from "@/data/twilio-signature";
import type { VoiceUrls } from "@/data/voice-response";

export interface TwilioWebhookHandlerOptions {
  pool: Pool;
  masterKey: string | undefined;
  baseURL: string;
}

const webhookRoute = /^\/api\/twilio\/(voice|gather|whisper|forward|forward-status|voicemail|voicemail-status|status)\/([^/]+)$/;

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
    const url = new URL(request.url);
    const route = webhookRoute.exec(url.pathname);
    if (request.method !== "POST" || !route) return new Response("Not Found", { status: 404 });
    const [, kind, assignmentId] = route;
    const params = await readParams(request);
    const authToken = await assignmentAuthToken(options, assignmentId);
    const signature = request.headers.get("x-twilio-signature");
    if (!authToken || !(await isValidTwilioSignature({ authToken, url: `${baseURL}${url.pathname}${url.search}`, params, signature }))) {
      return forbidden();
    }
    const calls = createInboundCalls({ pool: options.pool });
    const nodeId = url.searchParams.get("node") ?? "";
    const urls: VoiceUrls = {
      forwardAction: (node) => `${baseURL}/api/twilio/forward/${assignmentId}?node=${encodeURIComponent(node)}`,
      forwardStatus: (node) => `${baseURL}/api/twilio/forward-status/${assignmentId}?node=${encodeURIComponent(node)}`,
      whisper: (node) => `${baseURL}/api/twilio/whisper/${assignmentId}?node=${encodeURIComponent(node)}`,
      voicemailAction: (node) => `${baseURL}/api/twilio/voicemail/${assignmentId}?node=${encodeURIComponent(node)}`,
      voicemailStatus: (node) => `${baseURL}/api/twilio/voicemail-status/${assignmentId}?node=${encodeURIComponent(node)}`,
      gatherAction: (node, attempt) => `${baseURL}/api/twilio/gather/${assignmentId}?node=${encodeURIComponent(node)}&attempt=${attempt}`,
    };
    if (kind === "whisper") {
      const result = await calls.receiveWhisper(assignmentId, nodeId, params);
      return result.kind === "twiml" ? twiml(result.twiml) : forbidden();
    }
    if (kind === "voice" || kind === "gather" || kind === "forward" || kind === "voicemail") {
      const result = kind === "voice"
        ? await calls.receiveVoiceWebhook(assignmentId, params, urls)
        : kind === "gather"
          ? await calls.receiveGatherAction(assignmentId, nodeId, Number.parseInt(url.searchParams.get("attempt") ?? "", 10) || 1, params, urls)
          : kind === "forward"
            ? await calls.receiveForwardAction(assignmentId, nodeId, params, urls)
            : await calls.receiveVoicemailAction(assignmentId, nodeId, params);
      return result.kind === "twiml" ? twiml(result.twiml) : forbidden();
    }
    const result = kind === "forward-status"
      ? await calls.receiveForwardStatus(assignmentId, nodeId, params, urls)
      : kind === "voicemail-status"
        ? await calls.receiveVoicemailStatus(assignmentId, nodeId, params)
        : await calls.receiveCallStatus(assignmentId, params);
    return result.kind === "recorded" ? new Response(null, { status: 204 }) : forbidden();
  };
}
