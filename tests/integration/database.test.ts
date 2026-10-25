/**
 * -------------------------------------------------------------------------
 * @file   database.test.ts
 * @brief  Integration tests for the Database module against PostgreSQL.
 *
 * @description
 *  Runs the same module Production opens against a testcontainers
 *  PostgreSQL: a transaction commits or rolls back as one, its callback
 *  holds the named advisory lock until it ends, the server closing an
 *  idle or checked-out client does not fail later queries, and stats
 *  count the work. The timeout and socket behaviour that needs no server
 *  lives in tests/contracts/database.test.ts.
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openDatabase, type OpenedDatabase } from "@/data/database";

let container: StartedPostgreSqlContainer | undefined;
let database: OpenedDatabase | undefined;
let terminator: Client | undefined;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  database = openDatabase(container.getConnectionUri(), { max: 4 });
  await database.query("create table note (id int primary key, body text not null)");
  terminator = new Client({ connectionString: container.getConnectionUri() });
  await terminator.connect();
}, 120_000);

afterAll(async () => {
  await terminator?.end();
  await database?.close();
  await container?.stop();
});

async function terminate(pid: number): Promise<void> {
  await terminator!.query("select pg_terminate_backend($1)", [pid]);
  await new Promise((resolve) => setTimeout(resolve, 200));
}

describe.sequential("Database module", () => {
  it("commits a transaction as one and rolls it back as one", async () => {
    await database!.transaction(async (tx) => {
      await tx.query("insert into note values ($1, $2)", [1, "kept"]);
      await tx.query("insert into note values ($1, $2)", [2, "kept"]);
    });
    await expect(
      database!.transaction(async (tx) => {
        await tx.query("insert into note values ($1, $2)", [3, "lost"]);
        throw new Error("abandon");
      }),
    ).rejects.toThrow("abandon");

    const { rows } = await database!.query<{ id: number }>("select id from note order by id");
    expect(rows.map((row) => row.id)).toEqual([1, 2]);
  });

  it("holds the named advisory lock for the whole transaction", async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));

    const first = database!.transaction(
      async () => {
        order.push("first in");
        await held;
        order.push("first out");
      },
      { lock: "tracer:test:lock" },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = database!.transaction(
      async () => {
        order.push("second in");
      },
      { lock: "tracer:test:lock" },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(order).toEqual(["first in"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first in", "first out", "second in"]);
  });

  it("ignores the server closing an idle client and keeps serving queries", async () => {
    const client = await database!.pool.connect();
    const { rows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
    client.release();

    await terminate(rows[0]!.pid);

    expect((await database!.query<{ ok: number }>("select 1 as ok")).rows[0]!.ok).toBe(1);
  });

  it("ignores the server closing a checked-out client", async () => {
    const client = await database!.pool.connect();
    const { rows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");

    await terminate(rows[0]!.pid);
    client.release();

    expect((await database!.query<{ ok: number }>("select 1 as ok")).rows[0]!.ok).toBe(1);
  });

  it("counts queries and the first connection", async () => {
    const fresh = openDatabase(container!.getConnectionUri(), { max: 2 });
    try {
      await Promise.all([fresh.query("select 1"), fresh.query("select 2")]);
      await fresh.transaction(async (tx) => {
        await tx.query("select 3");
      });
      expect(fresh.stats.connectMs).not.toBeNull();
      expect(fresh.stats.queries).toBe(5);
      expect(fresh.stats.waves).toBe(4);
      expect(fresh.stats.failedQueries).toBe(0);
    } finally {
      await fresh.close();
    }
  });
});
