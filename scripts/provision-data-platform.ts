/**
 * -------------------------------------------------------------------------
 * @file   provision-data-platform.ts
 * @brief  Provisions Tracer's runtime database role and Hyperdrive configs.
 *
 * @description
 *  Applies least-privilege PostgreSQL grants and creates the named Hyperdrive
 *  configurations with credentials supplied only through environment secrets.
 *
 * @remarks
 *  Run this command from an approved GitHub Environment after migrations.
 *
 * @see
 *  docs/adr/0002-isolate-production-data-from-shared-non-production.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { spawn } from "node:child_process";

import pg from "pg";

const runtimeRole = "tracer_app";

function requireEnvironment(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function run(command: string, arguments_: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { stdio: "inherit" });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

const migrationUrl = requireEnvironment("DATABASE_MIGRATION_URL");
const runtimePassword = requireEnvironment("DATABASE_RUNTIME_PASSWORD");
const hyperdriveNames = requireEnvironment("HYPERDRIVE_NAMES").split(",");

if (!/^[A-F0-9]{64}$/.test(runtimePassword)) {
  throw new Error("DATABASE_RUNTIME_PASSWORD must be a 32-byte hexadecimal value");
}

const client = new pg.Client({ connectionString: migrationUrl });

try {
  await client.connect();
  await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${runtimeRole}') THEN
        CREATE ROLE ${runtimeRole} LOGIN;
      END IF;
    END
    $$
  `);
  await client.query(`ALTER ROLE ${runtimeRole} PASSWORD '${runtimePassword}'`);
  await client.query(`GRANT CONNECT ON DATABASE tracer TO ${runtimeRole}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${runtimeRole}`);
  await client.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${runtimeRole}`);
  await client.query(`GRANT SELECT, INSERT ON TABLE public.organization TO ${runtimeRole}`);
} finally {
  await client.end();
}

const runtimeUrl = new URL(migrationUrl);
runtimeUrl.username = runtimeRole;
runtimeUrl.password = runtimePassword;
runtimeUrl.searchParams.set("sslmode", "verify-full");

for (const name of hyperdriveNames) {
  await run("pnpm", [
    "exec",
    "wrangler",
    "hyperdrive",
    "create",
    name,
    "--connection-string",
    runtimeUrl.toString(),
    "--caching-disabled",
  ]);
}
