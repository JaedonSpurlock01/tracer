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
  if (!pool || !container) return;
  await pool.end();
  await container.stop();
});

it("migrates a clean database to the latest authentication and Organization schema", async () => {
  await migrateDatabase(container.getConnectionUri());

  const result = await pool.query<{ table_name: string }>(
    `select table_name
       from information_schema.tables
      where table_schema = 'public'
        and table_name in ('organization', 'user', 'session', 'account', 'verification', 'member', 'invitation', 'twilio_connection', 'twilio_number', 'workspace')
      order by table_name`,
  );
  expect(result.rows.map(({ table_name }) => table_name)).toEqual([
    "account",
    "invitation",
    "member",
    "organization",
    "session",
    "twilio_connection",
    "twilio_number",
    "user",
    "verification",
    "workspace",
  ]);

  const columns = await pool.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name
       from information_schema.columns
      where table_schema = 'public'
        and ((table_name = 'organization' and column_name in ('id', 'name', 'slug', 'created_at', 'logo', 'metadata'))
          or (table_name = 'user' and column_name in ('state', 'timezone', 'last_sign_in_at', 'provisioned_by_user_id'))
          or (table_name = 'session' and column_name = 'active_organization_id'))
      order by table_name, ordinal_position`,
  );
  expect(columns.rows).toEqual(expect.arrayContaining([
    { table_name: "organization", column_name: "created_at" },
    { table_name: "user", column_name: "state" },
    { table_name: "user", column_name: "timezone" },
    { table_name: "user", column_name: "last_sign_in_at" },
    { table_name: "user", column_name: "provisioned_by_user_id" },
    { table_name: "session", column_name: "active_organization_id" },
  ]));

  const stateConstraint = await pool.query<{ constraint_name: string }>(
    `select constraint_name
       from information_schema.check_constraints
      where constraint_name = 'user_state_check'`,
  );
  expect(stateConstraint.rows).toEqual([{ constraint_name: "user_state_check" }]);
  const workspaceStateConstraint = await pool.query<{ constraint_name: string }>(
    `select constraint_name
       from information_schema.check_constraints
      where constraint_name = 'workspace_state_check'`,
  );
  expect(workspaceStateConstraint.rows).toEqual([{ constraint_name: "workspace_state_check" }]);
  const foreignKeys = await pool.query<{ constraint_name: string }>(
    `select constraint_name
       from information_schema.table_constraints
      where constraint_type = 'FOREIGN KEY'
        and constraint_name in ('session_active_organization_id_organization_id_fk', 'member_organization_id_organization_id_fk', 'member_user_id_user_id_fk', 'user_provisioned_by_user_id_fk')`,
  );
  expect(foreignKeys.rows.map(({ constraint_name }) => constraint_name)).toEqual(expect.arrayContaining([
    "session_active_organization_id_organization_id_fk",
    "member_organization_id_organization_id_fk",
    "member_user_id_user_id_fk",
    "user_provisioned_by_user_id_fk",
  ]));
}, 30_000);

it("applies the latest migrations repeatedly as a no-op", async () => {
  await migrateDatabase(container.getConnectionUri());
  await migrateDatabase(container.getConnectionUri());

  const result = await pool.query<{ count: string }>(
    `select count(*)
       from drizzle.__drizzle_migrations`,
  );

  expect(Number(result.rows[0].count)).toBe(6);
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

it("grants Better Auth tables without granting schema creation or user deletion", async () => {
  const password = "A".repeat(64);
  await provisionRuntimeRole(pool, password);

  const grants = await pool.query<{ table_name: string; privilege_type: string }>(
    `select table_name, privilege_type
       from information_schema.role_table_grants
      where grantee = $1
        and table_schema = 'public'
        and table_name in ('organization', 'user', 'session', 'account', 'verification', 'member', 'invitation', 'twilio_connection', 'twilio_number', 'workspace')
      order by table_name, privilege_type`,
    [runtimeRole],
  );
  expect(grants.rows).not.toContainEqual({ table_name: "organization", privilege_type: "DELETE" });
  expect(grants.rows).toContainEqual({ table_name: "organization", privilege_type: "UPDATE" });
  expect(grants.rows).toContainEqual({ table_name: "session", privilege_type: "DELETE" });
  expect(grants.rows).toContainEqual({ table_name: "twilio_connection", privilege_type: "DELETE" });
  expect(grants.rows).toContainEqual({ table_name: "twilio_number", privilege_type: "DELETE" });
  expect(grants.rows).toContainEqual({ table_name: "workspace", privilege_type: "UPDATE" });
  expect(grants.rows).not.toContainEqual({ table_name: "workspace", privilege_type: "DELETE" });
  expect(grants.rows).not.toContainEqual({ table_name: "user", privilege_type: "DELETE" });

  const runtimeUrl = new URL(container.getConnectionUri());
  runtimeUrl.username = runtimeRole;
  runtimeUrl.password = password;
  const runtimePool = new Pool({ connectionString: runtimeUrl.toString() });

  try {
    await expect(runtimePool.query("delete from \"user\"")).rejects.toMatchObject({ code: "42501" });
    await expect(runtimePool.query("create table forbidden (id text)")).rejects.toMatchObject({
      code: "42501",
    });
  } finally {
    await runtimePool.end();
  }
});
