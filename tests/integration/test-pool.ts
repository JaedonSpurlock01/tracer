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
import { Pool, type PoolConfig } from "pg";

export function createTestPool(connectionString: string, options: Omit<PoolConfig, "connectionString"> = {}): Pool {
  const pool = new Pool({ connectionString, ...options });
  pool.on("connect", (client) => {
    let closedByServer = false;
    client.on("error", (error: Error & { code?: string }) => {
      if (error.code === "57P01") closedByServer = true;
      else if (!closedByServer) throw error;
    });
  });
  pool.on("error", (error: Error & { code?: string }) => {
    if (error.code !== "57P01") throw error;
  });
  return pool;
}
