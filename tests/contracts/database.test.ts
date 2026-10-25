/**
 * -------------------------------------------------------------------------
 * @file   database.test.ts
 * @brief  Contract tests for the Database module's timeouts, stats, and close.
 *
 * @description
 *  Drives openDatabase with sockets that never answer and with a Node
 *  socket, and checks that a stall fails within the connect timeout as a
 *  DatabaseUnavailableError, that the Worker drives the Cloudflare request
 *  socket, that close gives up at its deadline, and that stats count waves.
 *  Transactions and server shutdown need PostgreSQL and live in
 *  tests/integration/database.test.ts.
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createServer, type Server, type Socket } from "node:net";

import { afterEach, expect, it, vi } from "vitest";

import { openDatabase } from "@/data/database";
import { DatabaseUnavailableError } from "@/data/database-unavailable";
import type { SocketLoader, StuckSocket } from "@/data/request-socket";

let server: Server | undefined;
const sockets: Socket[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
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

function stuckCloudflareSockets() {
  const created: StuckSocket[] = [];
  const loader: SocketLoader = async () => () => {
    const socket: StuckSocket = {
      readable: new ReadableStream<Uint8Array>(),
      writable: new WritableStream<Uint8Array>(),
      closed: new Promise<void>(() => undefined),
      close: vi.fn(() => new Promise<void>(() => undefined)),
      startTls: () => socket,
    };
    created.push(socket);
    return socket;
  };
  return { loader, created };
}

it("fails a query as DatabaseUnavailableError within the connect timeout when the Cloudflare socket never answers", async () => {
  const { loader, created } = stuckCloudflareSockets();
  const database = openDatabase("postgresql://tracer_app:unused@db.hyperdrive.local:5432/tracer", { max: 6, sockets: loader });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  const query = database.query("select 1");
  const outcome = expect(query).rejects.toBeInstanceOf(DatabaseUnavailableError);
  await vi.waitFor(() => expect(created).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(10_000);

  await outcome;
  expect(database.stats).toMatchObject({ connectMs: null, queries: 1, failedQueries: 1, timedOut: true, waves: 1 });
  vi.useRealTimers();
  await expect(database.close()).resolves.toBe("closed");
});

it("fails a query within the connect timeout when a Node socket never answers", async () => {
  const database = openDatabase(await silentDatabase(), { max: 6 });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  const query = database.query("select 1");
  const outcome = expect(query).rejects.toBeInstanceOf(DatabaseUnavailableError);
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(10_000);

  await outcome;
  vi.useRealTimers();
  await database.close();
});

it("drives the Cloudflare request socket inside a Worker and a Node socket elsewhere", async () => {
  const node = openDatabase("postgresql://tracer_app:unused@127.0.0.1:1/tracer", { max: 1 });
  expect(node.pool.options.stream).toBeUndefined();
  expect(node.pool.options.max).toBe(1);
  await node.close();

  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
  const worker = openDatabase("postgresql://tracer_app:unused@db.hyperdrive.local:5432/tracer", { max: 6 });
  expect(worker.pool.options.stream).toBeTypeOf("function");
  expect(worker.pool.options.max).toBe(6);
  await worker.close();
});

it("gives up closing at the deadline when the socket close never answers, and reports a close that finishes or rejects", async () => {
  const { loader } = stuckCloudflareSockets();
  const database = openDatabase("postgresql://tracer_app:unused@db.hyperdrive.local:5432/tracer", { max: 6, sockets: loader });
  (database.pool as unknown as { end: () => Promise<void> }).end = () => new Promise<void>(() => undefined);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const closing = database.close();
  await vi.advanceTimersByTimeAsync(2_000);
  await expect(closing).resolves.toBe("abandoned");
  vi.useRealTimers();

  const rejecting = openDatabase("postgresql://tracer_app:unused@127.0.0.1:1/tracer", { max: 1 });
  (rejecting.pool as unknown as { end: () => Promise<void> }).end = () => Promise.reject(new Error("Connection terminated"));
  await expect(rejecting.close()).resolves.toBe("closed");
});

it("ignores an idle client's socket error once closing and logs one that arrives mid-request", async () => {
  const database = openDatabase("postgresql://tracer_app:unused@127.0.0.1:1/tracer", { max: 1 });
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(() => database.pool.emit("error", new Error("read ECONNRESET"))).not.toThrow();
    expect(logged).toHaveBeenCalledWith("database connection failed", expect.objectContaining({ message: "read ECONNRESET" }));
    logged.mockClear();
    const closing = database.close();
    expect(() => database.pool.emit("error", new Error("The ReadableStream was cancelled"))).not.toThrow();
    expect(logged).not.toHaveBeenCalled();
    await closing;
  } finally {
    logged.mockRestore();
  }
});

it("counts a wave each time the pool goes from idle to busy, so parallel queries share one wave", async () => {
  const database = openDatabase("postgresql://tracer_app:unused@127.0.0.1:1/tracer", { max: 6 });
  const pending: Array<() => void> = [];
  (database.pool as unknown as { query: unknown }).query = () => new Promise<void>((resolve) => pending.push(resolve));

  const first = database.query("select 1");
  const second = database.query("select 2");
  expect(database.stats.waves).toBe(1);
  pending.splice(0).forEach((resolve) => resolve());
  await Promise.all([first, second]);

  const third = database.query("select 3");
  expect(database.stats.waves).toBe(2);
  pending.splice(0).forEach((resolve) => resolve());
  await third;
  expect(database.stats.queries).toBe(3);
  await database.close();
});
