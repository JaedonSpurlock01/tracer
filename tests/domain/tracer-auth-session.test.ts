/**
 * -------------------------------------------------------------------------
 * @file   tracer-auth-session.test.ts
 * @brief  Pins the session cookie cache window Tracer configures.
 *
 * @description
 *  A navigation must not read the session from the database every time, so
 *  Better Auth keeps a signed copy in the cookie for 60 seconds. A Disabled
 *  user therefore keeps a working session for at most one minute, the
 *  window the Product Owner accepted on 2026-10-24.
 *
 * @see
 *  data/tracer-auth.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { expect, it } from "vitest";

import { createTracerAuth, sessionCookieCacheSeconds } from "@/data/tracer-auth";

it("caches the session in the cookie for 60 seconds", () => {
  const auth = createTracerAuth({
    database: {} as never,
    email: { async send() { return { messageId: "unused" }; } },
    emailFrom: "auth@example.com",
    allowedRecipients: new Set(),
    secret: "domain-test-secret",
    baseURL: "http://localhost:3000",
  });

  expect(sessionCookieCacheSeconds).toBe(60);
  expect(auth.options.session?.cookieCache).toMatchObject({ enabled: true, maxAge: 60 });
});
