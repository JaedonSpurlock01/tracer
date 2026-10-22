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
