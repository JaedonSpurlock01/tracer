/**
 * -------------------------------------------------------------------------
 * @file   test-pool.test.ts
 * @brief  Proves the shared integration pool survives PostgreSQL closing a connection.
 *
 * @description
 *  Terminates a pool client from a second connection, the way a stopping
 *  Testcontainers server does at suite teardown, both while the client is
 *  idle in the pool and while it is checked out. Neither may surface as an
 *  uncaught exception, and the pool must keep answering queries.
 *
 * @remarks
 *  An idle client's 57P01 reaches pg-pool's idle listener, which re-emits
 *  it on the Pool itself, so the Pool needs its own listener in addition to
 *  the per-client one.
 *
 * @see
 *  tests/integration/test-pool.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client, type Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestPool } from "./test-pool";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let terminator: Client | undefined;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = createTestPool(container.getConnectionUri());
  terminator = new Client({ connectionString: container.getConnectionUri() });
  await terminator.connect();
}, 120_000);

afterAll(async () => {
  await terminator?.end();
  await pool?.end();
  await container?.stop();
});

async function terminate(pid: number): Promise<void> {
  await terminator!.query("select pg_terminate_backend($1)", [pid]);
  await new Promise((resolve) => setTimeout(resolve, 200));
}

describe.sequential("Integration test pool", () => {
  it("ignores the server closing an idle client and keeps serving queries", async () => {
    const client = await pool!.connect();
    const { rows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
    client.release();

    await terminate(rows[0]!.pid);

    expect((await pool!.query<{ ok: number }>("select 1 as ok")).rows[0]!.ok).toBe(1);
  });

  it("ignores the server closing a checked-out client", async () => {
    const client = await pool!.connect();
    const { rows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");

    await terminate(rows[0]!.pid);
    client.release();

    expect((await pool!.query<{ ok: number }>("select 1 as ok")).rows[0]!.ok).toBe(1);
  });
});
