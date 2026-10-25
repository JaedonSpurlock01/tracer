/**
 * -------------------------------------------------------------------------
 * @file   test-pool.ts
 * @brief  Creates a PostgreSQL pool for an integration suite that survives container teardown.
 *
 * @description
 *  Every integration suite ends its pools and then stops its Testcontainers
 *  container. `pool.end()` resolves before the clients' sockets close, so
 *  the stopping server can still deliver PostgreSQL's administrator
 *  shutdown (57P01) to a client that is still closing, which Vitest
 *  reports as an unhandled error after every test passed. Pools made here
 *  ignore that error, and the socket close that follows it, on every
 *  client and on the Pool itself, and still throw any other.
 *
 * @remarks
 *  pg-pool leaves its idle listener on a client it is ending, and that
 *  listener re-emits the client's error on the Pool, so a per-client
 *  listener alone does not cover the idle case. Shared across suites so
 *  the fix lives in one place; the report-jobs suite found it first.
 *
 * @see
 *  tests/integration/test-pool.test.ts
 *  tests/integration/report-jobs.test.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import { openDatabase, type Database } from "@/data/database";

/** The same Database module Production opens, against the test container. */
export function createTestDatabase(connectionString: string, options: { max?: number } = {}): Database {
  return openDatabase(connectionString, { max: options.max ?? 10 });
}

/** Its pool, for repositories that have not yet taken a Database. */
export function createTestPool(connectionString: string, options: { max?: number } = {}): Pool {
  return createTestDatabase(connectionString, options).pool;
}
