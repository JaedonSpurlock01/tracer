/**
 * -------------------------------------------------------------------------
 * @file   tracer-auth-origin.test.ts
 * @brief  Verifies which browser origins may request a sign-in code.
 *
 * @description
 *  Local development serves Tracer on one port under two loopback names,
 *  localhost and 127.0.0.1. A sign-in code request from either name is
 *  accepted, while a request from any other origin is still refused.
 *
 * @remarks
 *  Better Auth skips its origin check when NODE_ENV is test or TEST is set,
 *  and reads them once at import, so the file switches both off before
 *  importing it and restores them afterwards.
 *  The database is left empty, so an accepted request fails later inside
 *  the endpoint; only Better Auth's origin refusal answers 403.
 *
 * @see
 *  data/tracer-auth.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { afterAll, describe, expect, it, vi } from "vitest";

const testEnv = vi.hoisted(() => {
  const previous = { NODE_ENV: process.env.NODE_ENV, TEST: process.env.TEST };
  Object.assign(process.env, { NODE_ENV: "development", TEST: "false" });
  return previous;
});

import { createTracerAuth } from "@/data/tracer-auth";

afterAll(() => {
  Object.assign(process.env, testEnv);
});

function authAt(baseURL: string) {
  return createTracerAuth({
    database: {} as never,
    email: { async send() { return { messageId: "unused" }; } },
    emailFrom: "auth@example.com",
    allowedRecipients: new Set(),
    secret: "domain-test-secret-that-is-long-enough",
    baseURL,
  });
}

async function requestCodeFrom(baseURL: string, origin: string): Promise<number> {
  const response = await authAt(baseURL).handler(
    new Request(`${baseURL}/api/auth/email-otp/send-verification-otp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, cookie: "tracer=1" },
      body: JSON.stringify({ email: "operator@example.com", type: "sign-in" }),
    }),
  );
  return response.status;
}

describe("sign-in code request origin", () => {
  it("accepts localhost and 127.0.0.1 on the same port in local development", async () => {
    expect(await requestCodeFrom("http://127.0.0.1:3000", "http://localhost:3000")).not.toBe(403);
    expect(await requestCodeFrom("http://localhost:3000", "http://127.0.0.1:3000")).not.toBe(403);
  });

  it("refuses any other origin", async () => {
    expect(await requestCodeFrom("http://127.0.0.1:3000", "http://localhost:4000")).toBe(403);
    expect(await requestCodeFrom("https://tracer.example.com", "http://localhost:3000")).toBe(403);
  });
});
