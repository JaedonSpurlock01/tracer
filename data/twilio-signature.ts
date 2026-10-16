/**
 * -------------------------------------------------------------------------
 * @file   twilio-signature.ts
 * @brief  Validates the X-Twilio-Signature header on Twilio webhooks.
 *
 * @description
 *  Recomputes Twilio's HMAC-SHA1 signature over the signed URL followed by
 *  every form parameter sorted by name, then compares it with the header.
 *
 * @remarks
 *  Web Crypto keeps validation compatible with Node and Workers, and the
 *  comparison runs in constant time so timing does not leak the signature.
 *
 * @see
 *  https://www.twilio.com/docs/usage/security
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export interface TwilioSignatureInput {
  authToken: string;
  url: string;
  params: Readonly<Record<string, string>>;
  signature: string | null;
}

async function computeSignature(authToken: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey("raw", encoder.encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const digest = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function signTwilioRequest(input: Omit<TwilioSignatureInput, "signature">): Promise<string> {
  const payload = input.url + Object.keys(input.params).sort().map((name) => name + input.params[name]).join("");
  return computeSignature(input.authToken, payload);
}

export async function isValidTwilioSignature(input: TwilioSignatureInput): Promise<boolean> {
  if (!input.signature || !input.authToken) return false;
  return constantTimeEqual(await signTwilioRequest(input), input.signature);
}
