/**
 * -------------------------------------------------------------------------
 * @file   runtime-role.ts
 * @brief  Applies least-privilege PostgreSQL runtime grants.
 *
 * @description
 *  Creates or rotates Tracer's application role and limits it to the
 *  Organization operations exposed by the public repository.
 *
 * @remarks
 *  The password format is validated before it is interpolated into role SQL.
 *
 * @see
 *  data/organization-repository.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Client, Pool } from "pg";

export const runtimeRole = "tracer_app";

export async function provisionRuntimeRole(
  connection: Client | Pool,
  password: string,
): Promise<void> {
  if (!/^[A-F0-9]{64}$/.test(password)) {
    throw new Error("Runtime role password must be a 32-byte hexadecimal value");
  }

  await connection.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await connection.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${runtimeRole}') THEN
        CREATE ROLE ${runtimeRole} LOGIN;
      END IF;
    END
    $$
  `);
  await connection.query(`ALTER ROLE ${runtimeRole} PASSWORD '${password}'`);
  await connection.query(`GRANT CONNECT ON DATABASE tracer TO ${runtimeRole}`);
  await connection.query(`GRANT USAGE ON SCHEMA public TO ${runtimeRole}`);
  await connection.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${runtimeRole}`);
  await connection.query(`GRANT SELECT, INSERT ON TABLE public.organization TO ${runtimeRole}`);
}
