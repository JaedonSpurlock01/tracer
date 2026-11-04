/**
 * -------------------------------------------------------------------------
 * @file   request-log.test.ts
 * @brief  Tests the tracer.request log line.
 *
 * @description
 *  Checks that one request writes one JSON line with its ray, duration,
 *  outcome, and the Database module's stats, as an info line on success
 *  and an error line with the error's name and message on failure, and
 *  that a request still open after 8, 20, and 60 seconds writes a
 *  tracer.request.stalled line while it is stuck, naming what the
 *  database is waiting on.
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { expect, it, vi } from "vitest";

import type { DatabaseStats } from "@/data/database";
import { logRequest, watchStalledRequest } from "@/data/request-log";

it("writes one tracer.request line with the ray, duration, outcome, and database timing", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

  logRequest({ ray: "ray-1", durationMs: 42, db: { connectMs: 7, queries: 3, slowestQueryMs: 20, failedQueries: 0, timedOut: false, waves: 2, socketsOpened: 1, socketsConnected: 1, pending: [] }, error: undefined });
  logRequest({ ray: null, durationMs: 10_050, db: { connectMs: null, queries: 1, slowestQueryMs: 10_000, failedQueries: 1, timedOut: true, waves: 1, socketsOpened: 1, socketsConnected: 1, pending: [] }, error: new Error("timeout exceeded when trying to connect") });

  expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({ event: "tracer.request", ray: "ray-1", outcome: "ok", durationMs: 42, dbConnectMs: 7, dbQueries: 3, dbSlowestMs: 20, dbFailed: 0, dbTimedOut: false, dbWaves: 2 });
  expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({ event: "tracer.request", ray: null, outcome: "error", dbTimedOut: true, errorName: "Error", errorMessage: "timeout exceeded when trying to connect" });
  log.mockRestore();
  error.mockRestore();
});

it("writes a tracer.request.stalled line while a request is still open after 8, 20, and 60 seconds, and nothing once it closes", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const db: DatabaseStats = { connectMs: null, queries: 0, slowestQueryMs: 0, failedQueries: 0, timedOut: false, waves: 1, socketsOpened: 1, socketsConnected: 0, pending: [{ text: "select organization_id, role from member where user_id = $1 limit 1", startedAt: 1_000_500 }] };

  const stop = watchStalledRequest({ ray: "ray-stuck", started: 1_000_000, db });
  vi.advanceTimersByTime(7_999);
  expect(error).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);

  expect(JSON.parse(String(error.mock.calls[0][0]))).toEqual({
    event: "tracer.request.stalled",
    ray: "ray-stuck",
    elapsedMs: 8_000,
    dbSocketsOpened: 1,
    dbSocketsConnected: 0,
    dbConnectMs: null,
    dbQueries: 0,
    dbFailed: 0,
    dbTimedOut: false,
    dbPending: [{ query: "select organization_id, role from member where user_id = $1 limit 1", ms: 7_500 }],
  });
  vi.advanceTimersByTime(12_000);
  expect(JSON.parse(String(error.mock.calls[1][0]))).toMatchObject({ event: "tracer.request.stalled", elapsedMs: 20_000 });
  stop();
  vi.advanceTimersByTime(60_000);
  expect(error).toHaveBeenCalledTimes(2);
  error.mockRestore();
  vi.useRealTimers();
});
