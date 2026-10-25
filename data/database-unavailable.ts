/**
 * -------------------------------------------------------------------------
 * @file   database-unavailable.ts
 * @brief  Names a request failure caused by a database that did not answer.
 *
 * @description
 *  asRequestFailure looks at the error a page loader threw and, when a
 *  pool connect or query timeout is anywhere in its cause chain, wraps it
 *  in a DatabaseUnavailableError carrying a fixed digest. Next.js keeps a
 *  server error's digest when it reaches the client error boundary, so
 *  the failure page can say the database stalled instead of showing a
 *  generic message. Any other error is returned unchanged.
 *
 * @remarks
 *  The digest is a constant rather than a hash so it survives the
 *  message scrubbing Next.js applies to server errors in production. The
 *  module has no server imports so the client failure page can read the
 *  digest from it.
 *
 * @see
 *  app/(app)/runtime.ts
 *  components/tracer/request-failed.tsx
 *  node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { isPoolTimeout } from "@/data/request-log";

export const databaseUnavailableDigest = "DATABASE_UNAVAILABLE";

export class DatabaseUnavailableError extends Error {
  readonly digest = databaseUnavailableDigest;

  constructor(cause: unknown) {
    super("The database did not answer within the request's time limit", { cause });
    this.name = "DatabaseUnavailableError";
  }
}

function causedByPoolTimeout(error: unknown, depth = 0): boolean {
  if (depth > 5 || error === null || typeof error !== "object") return false;
  if (isPoolTimeout(error)) return true;
  return causedByPoolTimeout((error as { cause?: unknown }).cause, depth + 1);
}

export function asRequestFailure(error: unknown): unknown {
  if (error instanceof DatabaseUnavailableError) return error;
  return causedByPoolTimeout(error) ? new DatabaseUnavailableError(error) : error;
}
