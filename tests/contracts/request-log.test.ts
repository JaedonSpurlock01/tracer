/**
 * -------------------------------------------------------------------------
 * @file   request-log.test.ts
 * @brief  Tests the tracer.request log line.
 *
 * @description
 *  Checks that one request writes one JSON line with its ray, duration,
 *  outcome, and the Database module's stats, as an info line on success
 *  and an error line with the error's name and message on failure.
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { expect, it, vi } from "vitest";

import { logRequest } from "@/data/request-log";

it("writes one tracer.request line with the ray, duration, outcome, and database timing", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

  logRequest({ ray: "ray-1", durationMs: 42, db: { connectMs: 7, queries: 3, slowestQueryMs: 20, failedQueries: 0, timedOut: false, waves: 2 }, error: undefined });
  logRequest({ ray: null, durationMs: 10_050, db: { connectMs: null, queries: 1, slowestQueryMs: 10_000, failedQueries: 1, timedOut: true, waves: 1 }, error: new Error("timeout exceeded when trying to connect") });

  expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({ event: "tracer.request", ray: "ray-1", outcome: "ok", durationMs: 42, dbConnectMs: 7, dbQueries: 3, dbSlowestMs: 20, dbFailed: 0, dbTimedOut: false, dbWaves: 2 });
  expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({ event: "tracer.request", ray: null, outcome: "error", dbTimedOut: true, errorName: "Error", errorMessage: "timeout exceeded when trying to connect" });
  log.mockRestore();
  error.mockRestore();
});
