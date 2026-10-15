/**
 * -------------------------------------------------------------------------
 * @file   e2e-twilio-fake.ts
 * @brief  Provides the non-production E2E Twilio fake boundary.
 *
 * @description
 *  Stores deterministic Incoming Phone Number and voice configuration state for
 *  Playwright journeys without contacting Twilio.
 *
 * @remarks
 *  Runtime selection is separately gated by E2E_TWILIO_FAKE and production mode.
 *
 * @see
 *  data/twilio-runtime.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { TwilioClient, TwilioCredential, TwilioIncomingPhoneNumber, TwilioVoiceConfiguration } from "@/data/twilio-client";

const configurations = new Map<string, TwilioVoiceConfiguration>();
const numbers: TwilioIncomingPhoneNumber[] = [
  {
    sid: "PNe2e0001",
    phoneNumber: "+14155550100",
    friendlyName: "E2E Primary",
    voiceCapable: true,
    voiceUrl: "https://example.com/legacy-voice",
    voiceMethod: "POST",
    voiceFallbackUrl: null,
    voiceFallbackMethod: null,
    statusCallback: null,
    statusCallbackMethod: null,
  },
  {
    sid: "PNe2e0002",
    phoneNumber: "+14155550101",
    friendlyName: "E2E Secondary",
    voiceCapable: true,
    voiceUrl: "https://example.com/legacy-voice",
    voiceMethod: "POST",
    voiceFallbackUrl: null,
    voiceFallbackMethod: null,
    statusCallback: null,
    statusCallbackMethod: null,
  },
];

function defaultConfiguration(sid: string): TwilioIncomingPhoneNumber {
  return (
    numbers.find((number) => number.sid === sid) ?? {
      sid,
      phoneNumber: "+14155550100",
      friendlyName: "E2E Number",
      voiceCapable: true,
      voiceUrl: "https://example.com/legacy-voice",
      voiceMethod: "POST",
      voiceFallbackUrl: null,
      voiceFallbackMethod: null,
      statusCallback: null,
      statusCallbackMethod: null,
    }
  );
}

export function createE2eTwilioFake(): TwilioClient {
  return {
    async fetchAccount(credential: TwilioCredential) {
      return { sid: credential.accountSid, friendlyName: "E2E Account", status: "active", type: "Full" };
    },
    async listIncomingPhoneNumbers() {
      return numbers.map((number) => ({ ...number, ...(configurations.has(number.sid) ? configurations.get(number.sid) : {}) }));
    },
    async fetchIncomingPhoneNumber(_credential, sid) {
      return { ...defaultConfiguration(sid), ...(configurations.has(sid) ? configurations.get(sid) : {}) };
    },
    async updateIncomingPhoneNumberVoice(_credential, sid, configuration) {
      configurations.set(sid, configuration);
      return { ...defaultConfiguration(sid), ...configuration };
    },
  };
}
