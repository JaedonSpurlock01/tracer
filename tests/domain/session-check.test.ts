/**
 * -------------------------------------------------------------------------
 * @file   session-check.test.ts
 * @brief  Tests that resolving the Actor names its session step and gives up
 *         on a session check that never answers.
 *
 * @description
 *  resolveActor marks auth.context while Better Auth starts and
 *  auth.session while the session is read, and fails with
 *  SessionCheckTimeoutError when the session check has not answered in
 *  5 seconds, so a stuck page shows the failure page with Retry instead
 *  of loading forever.
 *
 * @see
 *  data/authorization.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { afterEach, expect, it, vi } from "vitest";

import { resolveActor, SessionCheckTimeoutError, sessionCheckDeadlineMs } from "@/data/authorization";
import type { Queryable } from "@/data/database";
import type { TracerAuth } from "@/data/tracer-auth";

afterEach(() => {
  vi.useRealTimers();
});

it("fails with SessionCheckTimeoutError after 5 seconds when the session check never answers, naming each step on the way", async () => {
  vi.useFakeTimers();
  const auth = { $context: Promise.resolve({}), api: { getSession: () => new Promise(() => undefined) } } as unknown as TracerAuth;
  const connection: Queryable = { query: vi.fn() };
  const phases: string[] = [];

  const resolving = resolveActor(auth, connection, new Headers(), (phase) => phases.push(phase));
  const outcome = expect(resolving).rejects.toBeInstanceOf(SessionCheckTimeoutError);
  await vi.advanceTimersByTimeAsync(sessionCheckDeadlineMs);

  await outcome;
  expect(sessionCheckDeadlineMs).toBe(5_000);
  expect(phases).toEqual(["auth.context", "auth.session"]);
  expect(connection.query).not.toHaveBeenCalled();
});

it("returns no Actor without waiting out the deadline when there is no session", async () => {
  const auth = { $context: Promise.resolve({}), api: { getSession: async () => null } } as unknown as TracerAuth;

  await expect(resolveActor(auth, { query: vi.fn() }, new Headers())).resolves.toBeNull();
});
