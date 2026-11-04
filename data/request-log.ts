/**
 * -------------------------------------------------------------------------
 * @file   request-log.ts
 * @brief  Writes one log line per request with its database work.
 *
 * @description
 *  logRequest writes the Database module's stats for a request, how long
 *  the first connection took, how many queries ran, the slowest one, how
 *  many failed, whether any hit a timeout, and how many waves the request
 *  paid, with the request's Cloudflare ray, its duration, and its outcome
 *  as one JSON line, which Workers Logs stores beside the invocation it
 *  belongs to. watchStalledRequest writes a tracer.request.stalled line
 *  while a request is still open 8, 20, and 60 seconds after it started,
 *  with the sockets opened and connected and each statement still
 *  waiting, so a request that never finishes still says where it is
 *  stuck.
 *
 * @remarks
 *  The stalled line is written during the request on its own timers
 *  because a request the browser gives up on never reaches the
 *  tracer.request line, which runs after the response. Pending
 *  statements are named by their first 80 characters, which are fixed
 *  SQL text, never parameters.
 *  The line is printed with console.error when the request failed so it
 *  carries the error level in Workers Logs, and console.log otherwise.
 *  Error messages are cut to 300 characters and never include query
 *  text or parameters.
 *
 * @see
 *  data/database.ts
 *  data/tracer-runtime.ts
 *  README.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { DatabaseStats } from "@/data/database";

export interface RequestLogEntry {
  ray: string | null;
  durationMs: number;
  db: DatabaseStats;
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
    dbWaves: entry.db.waves,
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

const stallChecksMs = [8_000, 20_000, 60_000];

export interface StalledRequestWatch {
  ray: string | null;
  started: number;
  db: DatabaseStats;
}

/** Writes a tracer.request.stalled line at each check the request is still open for; call the result when it closes. */
export function watchStalledRequest(watch: StalledRequestWatch): () => void {
  const timers = stallChecksMs.map((afterMs) =>
    setTimeout(() => {
      const now = Date.now();
      console.error(
        JSON.stringify({
          event: "tracer.request.stalled",
          ray: watch.ray,
          elapsedMs: now - watch.started,
          dbSocketsOpened: watch.db.socketsOpened,
          dbSocketsConnected: watch.db.socketsConnected,
          dbConnectMs: watch.db.connectMs,
          dbQueries: watch.db.queries,
          dbFailed: watch.db.failedQueries,
          dbTimedOut: watch.db.timedOut,
          dbPending: watch.db.pending.map((statement) => ({ query: statement.text, ms: now - statement.startedAt })),
        }),
      );
    }, afterMs),
  );
  return () => timers.forEach(clearTimeout);
}
