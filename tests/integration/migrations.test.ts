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
import { provisionRuntimeRole, runtimeRole } from "@/data/runtime-role";

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

it("limits the runtime role to creating and reading Organizations", async () => {
  const password = "A".repeat(64);
  await provisionRuntimeRole(pool, password);

  const grants = await pool.query<{ privilege_type: string }>(
    `select privilege_type
       from information_schema.role_table_grants
      where grantee = $1
        and table_schema = 'public'
        and table_name = 'organization'
      order by privilege_type`,
    [runtimeRole],
  );
  expect(grants.rows.map(({ privilege_type }) => privilege_type)).toEqual(["INSERT", "SELECT"]);

  const runtimeUrl = new URL(container.getConnectionUri());
  runtimeUrl.username = runtimeRole;
  runtimeUrl.password = password;
  const runtimePool = new Pool({ connectionString: runtimeUrl.toString() });

  try {
    await expect(runtimePool.query("update organization set name = name")).rejects.toMatchObject({
      code: "42501",
    });
    await expect(runtimePool.query("delete from organization")).rejects.toMatchObject({
      code: "42501",
    });
    await expect(runtimePool.query("create table forbidden (id text)")).rejects.toMatchObject({
      code: "42501",
    });
  } finally {
    await runtimePool.end();
  }
});
