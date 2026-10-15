/**
 * -------------------------------------------------------------------------
 * @file   twilio-client.test.ts
 * @brief  Verifies the Twilio REST provider contract mapping.
 *
 * @description
 *  Exercises request authentication, pagination, response mapping, and safe
 *  provider errors using fake fetch responses and contract fixtures.
 *
 * @remarks
 *  Fixture credentials and identifiers are synthetic test data.
 *
 * @see
 *  data/twilio-client.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import account from "./fixtures/twilio/account.json";
import authenticationError from "./fixtures/twilio/authentication-error.json";
import pageOne from "./fixtures/twilio/incoming-phone-numbers-page-1.json";
import pageTwo from "./fixtures/twilio/incoming-phone-numbers-page-2.json";
import { describe, expect, it, vi } from "vitest";

import { createTwilioRestClient, TwilioClientError } from "@/data/twilio-client";

const credential = {
  accountSid: account.sid,
  apiKeySid: "SK11111111111111111111111111111111",
  apiKeySecret: "synthetic-api-secret",
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Twilio REST client", () => {
  it("fetches account metadata with the exact URL and Basic authorization", async () => {
    const fetch = vi.fn().mockResolvedValue(response(account));
    const client = createTwilioRestClient({ fetch, baseUrl: "https://twilio.test" });

    await expect(client.fetchAccount(credential)).resolves.toEqual({
      sid: account.sid,
      friendlyName: account.friendly_name,
      status: account.status,
      type: account.type,
    });
    expect(fetch).toHaveBeenCalledWith(
      `https://twilio.test/2010-04-01/Accounts/${account.sid}.json`,
      { headers: { Authorization: `Basic ${btoa(`${credential.apiKeySid}:${credential.apiKeySecret}`)}` } },
    );
  });

  it("maps incoming phone capabilities and null friendly names", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ ...pageOne, next_page_uri: null }));
    const client = createTwilioRestClient({ fetch, baseUrl: "https://twilio.test" });

    await expect(client.listIncomingPhoneNumbers(credential)).resolves.toEqual([
      expect.objectContaining({ sid: pageOne.incoming_phone_numbers[0].sid, voiceCapable: true }),
      expect.objectContaining({ sid: pageOne.incoming_phone_numbers[1].sid, friendlyName: "", voiceCapable: false }),
    ]);
  });

  it("follows incoming number pagination and concatenates pages", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(pageOne))
      .mockResolvedValueOnce(response(pageTwo));
    const client = createTwilioRestClient({ fetch, baseUrl: "https://twilio.test" });

    const numbers = await client.listIncomingPhoneNumbers(credential);

    expect(numbers).toHaveLength(3);
    expect(fetch).toHaveBeenNthCalledWith(2,
      "https://twilio.test/2010-04-01/Accounts/ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/IncomingPhoneNumbers.json?PageSize=1000&Page=1",
      expect.anything(),
    );
  });

  it("maps authentication errors without exposing secrets or headers", async () => {
    const fetch = vi.fn().mockResolvedValue(response(authenticationError, 401));
    const client = createTwilioRestClient({ fetch, baseUrl: "https://twilio.test" });

    let error: TwilioClientError | undefined;
    try {
      await client.fetchAccount(credential);
    } catch (value) {
      error = value as TwilioClientError;
    }

    expect(error).toBeInstanceOf(TwilioClientError);
    if (!(error instanceof TwilioClientError)) throw new Error("Expected TwilioClientError");
    expect(error.code).toBe("authentication_failed");
    expect(error.status).toBe(401);
    expect(error.message).not.toContain(credential.apiKeySecret);
    expect(error.message).not.toContain("Basic");
  });

  it("maps rejected fetches to unavailable", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("socket failed"));
    const client = createTwilioRestClient({ fetch, baseUrl: "https://twilio.test" });

    await expect(client.fetchAccount(credential)).rejects.toMatchObject({ code: "unavailable", status: null });
  });
});
