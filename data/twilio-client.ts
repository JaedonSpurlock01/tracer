/**
 * -------------------------------------------------------------------------
 * @file   twilio-client.ts
 * @brief  Provides a narrow Twilio REST provider boundary.
 *
 * @description
 *  Fetches account metadata and incoming numbers without exposing provider
 *  response bodies or credential material through errors.
 *
 * @remarks
 *  Application services depend on TwilioClient rather than this REST detail.
 *
 * @see
 *  data/integrations.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export interface TwilioCredential {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
}

export interface TwilioAccountSummary {
  sid: string;
  friendlyName: string;
  status: string;
  type: string;
}

export interface TwilioIncomingPhoneNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  voiceCapable: boolean;
  voiceUrl: string | null;
  voiceMethod: string | null;
}

export type TwilioClientErrorCode = "authentication_failed" | "request_failed" | "unavailable";

export class TwilioClientError extends Error {
  constructor(public readonly code: TwilioClientErrorCode, public readonly status: number | null) {
    super(code === "authentication_failed"
      ? `Twilio rejected the credential (HTTP ${status ?? "unknown"})`
      : code === "request_failed"
        ? `Twilio request failed (HTTP ${status ?? "unknown"})`
        : "Twilio is unavailable");
    this.name = "TwilioClientError";
  }
}

export interface TwilioClient {
  fetchAccount(credential: TwilioCredential): Promise<TwilioAccountSummary>;
  listIncomingPhoneNumbers(credential: TwilioCredential): Promise<TwilioIncomingPhoneNumber[]>;
}

export interface TwilioIncomingPhoneNumberPayload {
  sid: string;
  phone_number: string;
  friendly_name: string | null;
  capabilities?: { voice?: boolean };
  voice_url?: string | null;
  voice_method?: string | null;
}

export function mapIncomingPhoneNumber(payload: TwilioIncomingPhoneNumberPayload): TwilioIncomingPhoneNumber {
  return {
    sid: payload.sid,
    phoneNumber: payload.phone_number,
    friendlyName: payload.friendly_name ?? "",
    voiceCapable: payload.capabilities?.voice === true,
    voiceUrl: payload.voice_url ?? null,
    voiceMethod: payload.voice_method ?? null,
  };
}

interface TwilioAccountPayload {
  sid?: string;
  friendly_name?: string | null;
  status?: string;
  type?: string;
}

interface TwilioIncomingPhoneNumbersResponse {
  incoming_phone_numbers?: TwilioIncomingPhoneNumberPayload[];
  next_page_uri?: string | null;
}

function requestUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl.replace(/\/$/, "")}/`).toString();
}

function authorization(credential: TwilioCredential): string {
  return `Basic ${btoa(`${credential.apiKeySid}:${credential.apiKeySecret}`)}`;
}

export function createTwilioRestClient(options: { fetch?: typeof fetch; baseUrl?: string } = {}): TwilioClient {
  const request = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "https://api.twilio.com";

  async function get<T>(path: string, credential: TwilioCredential): Promise<T> {
    let response: Response;
    try {
      response = await request(requestUrl(baseUrl, path), {
        headers: { Authorization: authorization(credential) },
      });
    } catch {
      throw new TwilioClientError("unavailable", null);
    }
    if (response.status === 401 || response.status === 403) {
      throw new TwilioClientError("authentication_failed", response.status);
    }
    if (!response.ok) {
      throw new TwilioClientError("request_failed", response.status);
    }
    try {
      return await response.json() as T;
    } catch {
      throw new TwilioClientError("request_failed", response.status);
    }
  }

  return {
    async fetchAccount(credential) {
      const account = await get<TwilioAccountPayload>(`/2010-04-01/Accounts/${credential.accountSid}.json`, credential);
      return {
        sid: account.sid ?? "",
        friendlyName: account.friendly_name ?? "",
        status: account.status ?? "",
        type: account.type ?? "",
      };
    },

    async listIncomingPhoneNumbers(credential) {
      const numbers: TwilioIncomingPhoneNumber[] = [];
      let path: string | null = `/2010-04-01/Accounts/${credential.accountSid}/IncomingPhoneNumbers.json?PageSize=1000`;
      while (path) {
        const page: TwilioIncomingPhoneNumbersResponse = await get<TwilioIncomingPhoneNumbersResponse>(path, credential);
        numbers.push(...(page.incoming_phone_numbers ?? []).map(mapIncomingPhoneNumber));
        path = page.next_page_uri ?? null;
      }
      return numbers;
    },
  };
}
