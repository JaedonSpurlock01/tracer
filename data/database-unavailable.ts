/**
 * -------------------------------------------------------------------------
 * @file   database-unavailable.ts
 * @brief  The error a request fails with when the database did not answer.
 *
 * @description
 *  The Database module throws DatabaseUnavailableError when a connect or
 *  query hits its timeout. It carries a fixed digest, which Next.js keeps
 *  when it scrubs a server error for the browser, so the failure page can
 *  say the database stalled instead of showing a generic message.
 *
 * @remarks
 *  This file has no database imports so the client failure page can read
 *  the digest from it without pulling pg into the browser bundle.
 *
 * @see
 *  data/database.ts
 *  components/tracer/request-failed.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export const databaseUnavailableDigest = "DATABASE_UNAVAILABLE";

export class DatabaseUnavailableError extends Error {
  readonly digest = databaseUnavailableDigest;

  constructor(cause: unknown) {
    super("The database did not answer within the request's time limit", { cause });
    this.name = "DatabaseUnavailableError";
  }
}
