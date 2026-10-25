/**
 * -------------------------------------------------------------------------
 * @file   test-pool.ts
 * @brief  Creates a PostgreSQL pool for an integration suite that survives container teardown.
 *
 * @description
 *  Every integration suite ends its pools and then stops its Testcontainers
 *  container. `pool.end()` resolves before the clients' sockets close, so
 *  the stopping server can still deliver PostgreSQL's administrator
 *  shutdown (57P01) to a client that no longer has an error listener,
 *  which Vitest reports as an unhandled error after every test passed.
 *  Pools made here ignore that one error on every client and still throw
 *  any other.
 *
 * @remarks
 *  Shared across suites so the fix lives in one place instead of being
 *  rediscovered file by file; the report-jobs suite found it first.
 *
 * @see
 *  tests/integration/report-jobs.test.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { Pool, type PoolConfig } from "pg";

export function createTestPool(connectionString: string, options: Omit<PoolConfig, "connectionString"> = {}): Pool {
  const pool = new Pool({ connectionString, ...options });
  pool.on("connect", (client) =>
    client.on("error", (error: Error & { code?: string }) => {
      if (error.code !== "57P01") throw error;
    }),
  );
  return pool;
}
