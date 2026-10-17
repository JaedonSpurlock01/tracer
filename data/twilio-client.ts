/**
 * -------------------------------------------------------------------------
 * @file   twilio-client.ts
 * @brief  Provides a narrow Twilio REST provider boundary.
 *
 * @description
 *  Fetches account metadata and incoming numbers, downloads Recording WAV
 *  media, and deletes Twilio Recordings without exposing provider response
 *  bodies or credential material through errors.
 *
 * @remarks
 *  Application services depend on TwilioClient and TwilioRecordingMedia
 *  rather than this REST detail. Deleting a Recording Twilio no longer has
 *  succeeds, because the goal of cleanup is already met.
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

export function authTokenCredential(accountSid: string, authToken: string): TwilioCredential {
  return { accountSid, apiKeySid: accountSid, apiKeySecret: authToken };
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
  voiceFallbackUrl: string | null;
  voiceFallbackMethod: string | null;
  statusCallback: string | null;
  statusCallbackMethod: string | null;
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

export interface TwilioVoiceConfiguration {
  voiceUrl: string | null;
  voiceMethod: string | null;
  voiceFallbackUrl: string | null;
  voiceFallbackMethod: string | null;
  statusCallback: string | null;
  statusCallbackMethod: string | null;
}

export interface TwilioClient {
  fetchAccount(credential: TwilioCredential): Promise<TwilioAccountSummary>;
  listIncomingPhoneNumbers(credential: TwilioCredential): Promise<TwilioIncomingPhoneNumber[]>;
  fetchIncomingPhoneNumber(credential: TwilioCredential, sid: string): Promise<TwilioIncomingPhoneNumber>;
  updateIncomingPhoneNumberVoice(credential: TwilioCredential, sid: string, configuration: TwilioVoiceConfiguration): Promise<TwilioIncomingPhoneNumber>;
}

export interface TwilioIncomingPhoneNumberPayload {
  sid: string;
  phone_number: string;
  friendly_name: string | null;
  capabilities?: { voice?: boolean };
  voice_url?: string | null;
  voice_method?: string | null;
  voice_fallback_url?: string | null;
  voice_fallback_method?: string | null;
  status_callback?: string | null;
  status_callback_method?: string | null;
}

export function mapIncomingPhoneNumber(payload: TwilioIncomingPhoneNumberPayload): TwilioIncomingPhoneNumber {
  return {
    sid: payload.sid,
    phoneNumber: payload.phone_number,
    friendlyName: payload.friendly_name ?? "",
    voiceCapable: payload.capabilities?.voice === true,
    voiceUrl: payload.voice_url ?? null,
    voiceMethod: payload.voice_method ?? null,
    voiceFallbackUrl: payload.voice_fallback_url ?? null,
    voiceFallbackMethod: payload.voice_fallback_method ?? null,
    statusCallback: payload.status_callback ?? null,
    statusCallbackMethod: payload.status_callback_method ?? null,
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

  async function send<T>(method: "GET" | "POST", path: string, credential: TwilioCredential, body?: Record<string, string>): Promise<T> {
    const headers: Record<string, string> = { Authorization: authorization(credential) };
    const init: RequestInit = { headers };
    if (method !== "GET") {
      init.method = method;
    }
    if (body) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      init.body = new URLSearchParams(body).toString();
    }
    let response: Response;
    try {
      response = await request(requestUrl(baseUrl, path), init);
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
      const account = await send<TwilioAccountPayload>("GET", `/2010-04-01/Accounts/${credential.accountSid}.json`, credential);
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
        const page: TwilioIncomingPhoneNumbersResponse = await send<TwilioIncomingPhoneNumbersResponse>("GET", path, credential);
        numbers.push(...(page.incoming_phone_numbers ?? []).map(mapIncomingPhoneNumber));
        path = page.next_page_uri ?? null;
      }
      return numbers;
    },

    async fetchIncomingPhoneNumber(credential, sid) {
      const payload = await send<TwilioIncomingPhoneNumberPayload>("GET", `/2010-04-01/Accounts/${credential.accountSid}/IncomingPhoneNumbers/${sid}.json`, credential);
      return mapIncomingPhoneNumber(payload);
    },

    async updateIncomingPhoneNumberVoice(credential, sid, configuration) {
      const payload = await send<TwilioIncomingPhoneNumberPayload>("POST", `/2010-04-01/Accounts/${credential.accountSid}/IncomingPhoneNumbers/${sid}.json`, credential, {
        VoiceUrl: configuration.voiceUrl ?? "",
        VoiceMethod: configuration.voiceMethod ?? "",
        VoiceFallbackUrl: configuration.voiceFallbackUrl ?? "",
        VoiceFallbackMethod: configuration.voiceFallbackMethod ?? "",
        StatusCallback: configuration.statusCallback ?? "",
        StatusCallbackMethod: configuration.statusCallbackMethod ?? "",
      });
      return mapIncomingPhoneNumber(payload);
    },
  };
}

export interface TwilioRecordingMedia {
  downloadRecording(credential: TwilioCredential, recordingSid: string): Promise<Uint8Array>;
  deleteRecording(credential: TwilioCredential, recordingSid: string): Promise<void>;
}

export function createTwilioRecordingMedia(options: { fetch?: typeof fetch; baseUrl?: string } = {}): TwilioRecordingMedia {
  const request = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? "https://api.twilio.com";

  async function send(path: string, credential: TwilioCredential, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await request(requestUrl(baseUrl, path), { ...init, headers: { Authorization: authorization(credential) } });
    } catch {
      throw new TwilioClientError("unavailable", null);
    }
    if (response.status === 401 || response.status === 403) {
      throw new TwilioClientError("authentication_failed", response.status);
    }
    return response;
  }

  return {
    async downloadRecording(credential, recordingSid) {
      const response = await send(`/2010-04-01/Accounts/${credential.accountSid}/Recordings/${recordingSid}.wav`, credential);
      if (!response.ok) {
        throw new TwilioClientError("request_failed", response.status);
      }
      try {
        return new Uint8Array(await response.arrayBuffer());
      } catch {
        throw new TwilioClientError("unavailable", null);
      }
    },

    async deleteRecording(credential, recordingSid) {
      const response = await send(`/2010-04-01/Accounts/${credential.accountSid}/Recordings/${recordingSid}.json`, credential, { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        throw new TwilioClientError("request_failed", response.status);
      }
    },
  };
}
