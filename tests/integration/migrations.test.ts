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
import { smokeDatabase } from "@/data/database-smoke";
import { createOrganizationRepository } from "@/data/organization-repository";

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

it("applies the latest migrations repeatedly as a no-op", async () => {
  await migrateDatabase(container.getConnectionUri());
  await migrateDatabase(container.getConnectionUri());

  const result = await pool.query<{ count: string }>(
    `select count(*)
       from drizzle.__drizzle_migrations`,
  );

  expect(Number(result.rows[0].count)).toBe(1);
}, 30_000);

it("creates and reads an Organization by its generated ID", async () => {
  const repository = createOrganizationRepository(pool);

  const created = await repository.create({
    name: "Spurlock Labs",
    slug: "spurlock-labs",
  });

  expect(created.id).toEqual(expect.any(String));
  expect(created.createdAt).toEqual(expect.any(Date));
  await expect(repository.findById(created.id)).resolves.toEqual(created);
});

it("smokes Organization reads and writes without retaining data", async () => {
  const before = await pool.query<{ count: string }>("select count(*) from organization");

  await expect(smokeDatabase(pool)).resolves.toBeUndefined();

  const after = await pool.query<{ count: string }>("select count(*) from organization");
  expect(after.rows[0].count).toBe(before.rows[0].count);
});
