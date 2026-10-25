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
 *  belongs to.
 *
 * @remarks
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
