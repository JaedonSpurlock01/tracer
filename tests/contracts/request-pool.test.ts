/**
 * -------------------------------------------------------------------------
 * @file   request-pool.test.ts
 * @brief  Proves a request's database pool gives up on a stalled connection.
 *
 * @description
 *  Starts a local server that accepts a PostgreSQL connection and never
 *  answers, which is how a stalled Hyperdrive connection looks to the Worker,
 *  and checks that the request pool fails with a timeout instead of leaving
 *  the request waiting forever.
 *
 * @remarks
 *  Production pages hung for minutes with no database activity because
 *  neither node-postgres nor the Cloudflare socket adapter has a default
 *  connection timeout. A failed request can be retried; a hung one cannot.
 *
 * @see
 *  data/tracer-runtime.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createServer, type Server, type Socket } from "node:net";

import { afterEach, expect, it, vi } from "vitest";

import { createRequestPool } from "@/data/tracer-runtime";

let server: Server | undefined;
const sockets: Socket[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

async function silentDatabase(): Promise<string> {
  server = createServer((socket) => sockets.push(socket));
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  return `postgresql://tracer_app:unused@127.0.0.1:${address.port}/tracer`;
}

it("fails a query when the database connection never answers instead of hanging", async () => {
  const pool = createRequestPool(await silentDatabase());
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  const query = pool.query("select 1");
  const outcome = expect(query).rejects.toThrow(/timeout/i);
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(10_000);

  await outcome;
  await pool.end();
});

it("counts the timed-out query and flags the timeout on the observed pool", async () => {
  const { observePool } = await import("@/data/request-log");
  const pool = createRequestPool(await silentDatabase());
  const stats = observePool(pool);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  const query = pool.query("select 1");
  const outcome = expect(query).rejects.toThrow(/timeout/i);
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(10_000);
  await outcome;

  expect(stats).toMatchObject({ connectMs: null, queries: 1, failedQueries: 1, timedOut: true });
  await pool.end();
});

it("writes one tracer.request line with the ray, duration, outcome, and database timing", async () => {
  const { logRequest } = await import("@/data/request-log");
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

  logRequest({ ray: "ray-1", durationMs: 42, db: { connectMs: 7, queries: 3, slowestQueryMs: 20, failedQueries: 0, timedOut: false }, error: undefined });
  logRequest({ ray: null, durationMs: 10_050, db: { connectMs: null, queries: 1, slowestQueryMs: 10_000, failedQueries: 1, timedOut: true }, error: new Error("timeout exceeded when trying to connect") });

  expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({ event: "tracer.request", ray: "ray-1", outcome: "ok", durationMs: 42, dbConnectMs: 7, dbQueries: 3, dbSlowestMs: 20, dbFailed: 0, dbTimedOut: false });
  expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({ event: "tracer.request", ray: null, outcome: "error", dbTimedOut: true, errorName: "Error", errorMessage: "timeout exceeded when trying to connect" });
  log.mockRestore();
  error.mockRestore();
});

it("gives up closing the pool at the deadline when the socket close never answers", async () => {
  const { closeRequestPool } = await import("@/data/tracer-runtime");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const neverCloses = { end: () => new Promise<void>(() => undefined) };

  const closing = closeRequestPool(neverCloses, 2_000);
  await vi.advanceTimersByTimeAsync(2_000);

  await expect(closing).resolves.toBe("abandoned");
});

it("reports a pool that closes in time, including one whose close rejects", async () => {
  const { closeRequestPool } = await import("@/data/tracer-runtime");
  await expect(closeRequestPool({ end: () => Promise.resolve() }, 2_000)).resolves.toBe("closed");
  await expect(closeRequestPool({ end: () => Promise.reject(new Error("Connection terminated")) }, 2_000)).resolves.toBe("closed");
});
