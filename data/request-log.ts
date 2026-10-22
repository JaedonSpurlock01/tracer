/**
 * -------------------------------------------------------------------------
 * @file   request-log.ts
 * @brief  Measures a request's database work and writes one log line for it.
 *
 * @description
 *  observePool wraps a request pool so the runtime knows how long the
 *  first connection took, how many queries ran, the slowest one, how many
 *  failed, and whether any hit the pool's connect or query timeout.
 *  logRequest writes those numbers with the request's Cloudflare ray,
 *  its duration, and its outcome as one JSON line, which Workers Logs
 *  stores beside the invocation it belongs to.
 *
 * @remarks
 *  The line is printed with console.error when the request failed so it
 *  carries the error level in Workers Logs, and console.log otherwise.
 *  Error messages are cut to 300 characters and never include query
 *  text or parameters.
 *
 * @see
 *  data/tracer-runtime.ts
 *  README.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool, PoolClient } from "pg";

export interface RequestPoolStats {
  /** Milliseconds from pool creation to the first connected client, or null if none connected. */
  connectMs: number | null;
  queries: number;
  slowestQueryMs: number;
  failedQueries: number;
  /** True once any connection or query hit the pool's timeout. */
  timedOut: boolean;
}

export function isPoolTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /connection timeout|timeout exceeded when trying to connect|timeout expired|query read timeout/i.test(message);
}

type Queryable = { query: (...args: unknown[]) => unknown };

/** Wraps the pool and every client it hands out so each query is timed. */
export function observePool(pool: Pool): RequestPoolStats {
  const created = Date.now();
  const stats: RequestPoolStats = { connectMs: null, queries: 0, slowestQueryMs: 0, failedQueries: 0, timedOut: false };
  const wrapped = new WeakSet<object>();

  function record(started: number, error?: unknown) {
    stats.queries += 1;
    stats.slowestQueryMs = Math.max(stats.slowestQueryMs, Date.now() - started);
    if (error !== undefined) {
      stats.failedQueries += 1;
      if (isPoolTimeout(error)) stats.timedOut = true;
    }
  }

  function instrument(target: Queryable) {
    if (wrapped.has(target)) return;
    wrapped.add(target);
    const original = target.query.bind(target);
    target.query = (...args: unknown[]) => {
      const started = Date.now();
      let result: unknown;
      try {
        result = original(...args);
      } catch (error) {
        record(started, error);
        throw error;
      }
      if (result && typeof (result as Promise<unknown>).then === "function") {
        return (result as Promise<unknown>).then(
          (value) => {
            record(started);
            return value;
          },
          (error: unknown) => {
            record(started, error);
            throw error;
          },
        );
      }
      record(started);
      return result;
    };
  }

  pool.on("connect", () => {
    if (stats.connectMs === null) stats.connectMs = Date.now() - created;
  });
  pool.on("acquire", (client: PoolClient) => instrument(client as unknown as Queryable));
  instrument(pool as unknown as Queryable);
  const originalConnect = pool.connect.bind(pool) as () => Promise<PoolClient>;
  (pool as { connect: unknown }).connect = ((...args: unknown[]) => {
    const result = (originalConnect as (...inner: unknown[]) => unknown)(...args);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      return (result as Promise<PoolClient>).catch((error: unknown) => {
        if (isPoolTimeout(error)) stats.timedOut = true;
        throw error;
      });
    }
    return result;
  }) as typeof pool.connect;
  return stats;
}

export interface RequestLogEntry {
  ray: string | null;
  durationMs: number;
  db: RequestPoolStats;
  error: unknown;
}

export function logRequest(entry: RequestLogEntry): void {
  const failed = entry.error !== undefined;
  const line = {
    event: "tracer.request",
    ray: entry.ray,
    outcome: failed ? "error" : "ok",
    durationMs: entry.durationMs,
    dbConnectMs: entry.db.connectMs,
    dbQueries: entry.db.queries,
    dbSlowestMs: entry.db.slowestQueryMs,
    dbFailed: entry.db.failedQueries,
    dbTimedOut: entry.db.timedOut,
    ...(failed
      ? {
          errorName: entry.error instanceof Error ? entry.error.name : typeof entry.error,
          errorMessage: (entry.error instanceof Error ? entry.error.message : String(entry.error)).slice(0, 300),
        }
      : {}),
  };
  if (failed) console.error(JSON.stringify(line));
  else console.log(JSON.stringify(line));
}
