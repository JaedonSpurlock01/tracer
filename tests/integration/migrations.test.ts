/**
 * -------------------------------------------------------------------------
 * @file   migrations.test.ts
 * @brief  Verifies Tracer database migrations against PostgreSQL.
 *
 * @description
 *  Runs the public migration workflow against a clean PostgreSQL 17
 *  database and inspects the resulting application schema.
 *
 * @remarks
 *  The PostgreSQL container is shared across every test in this file.
 *
 * @see
 *  docs/IMPLEMENTATION_ROADMAP.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";

import { migrateDatabase } from "@/data/migrate";

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
}, 120_000);

afterAll(async () => {
  await pool.end();
  await container.stop();
});

it("migrates a clean database to the latest Organization schema", async () => {
  await migrateDatabase(container.getConnectionUri());

  const result = await pool.query<{ column_name: string }>(
    `select column_name
       from information_schema.columns
      where table_schema = 'public'
        and table_name = 'organization'
      order by ordinal_position`,
  );

  expect(result.rows.map(({ column_name }) => column_name)).toEqual([
    "id",
    "name",
    "slug",
    "created_at",
  ]);
}, 30_000);
