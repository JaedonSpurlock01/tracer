/**
 * -------------------------------------------------------------------------
 * @file   tracer-auth-phase.test.ts
 * @brief  Tests that Better Auth reports when a call reaches its handler.
 *
 * @description
 *  createTracerAuth reports auth.handler once Better Auth has set up its
 *  request state and context and is about to run an endpoint, so a
 *  stalled session check can say whether it stopped before or inside the
 *  handler.
 *
 * @see
 *  data/tracer-auth.ts
 *  data/authorization.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { expect, it } from "vitest";

import { createTracerAuth } from "@/data/tracer-auth";

it("reports auth.handler when a session check reaches Better Auth's handler", async () => {
  const phases: string[] = [];
  const auth = createTracerAuth({
    database: {} as never,
    email: { async send() { return { messageId: "unused" }; } },
    emailFrom: "auth@example.com",
    allowedRecipients: new Set(),
    secret: "domain-test-secret-that-is-long-enough",
    baseURL: "http://localhost:3000",
    onPhase: (phase) => phases.push(phase),
  });

  await expect(auth.api.getSession({ headers: new Headers() })).resolves.toBeNull();

  expect(phases).toEqual(["auth.handler"]);
});
