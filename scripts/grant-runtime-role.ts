/**
 * -------------------------------------------------------------------------
 * @file   grant-runtime-role.ts
 * @brief  Applies Tracer runtime database grants.
 *
 * @description
 *  Connects with the migration role and applies the least-privilege runtime
 *  grants without creating Hyperdrive configurations.
 *
 * @remarks
 *  Credentials are read only from the approved environment and never printed.
 *
 * @see
 *  data/runtime-role.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import pg from "pg";

import { provisionRuntimeRole, runtimeRole } from "../data/runtime-role";

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const migrationUrl = requireEnvironment("DATABASE_MIGRATION_URL");
const runtimePassword = requireEnvironment("DATABASE_RUNTIME_PASSWORD");
const client = new pg.Client({ connectionString: migrationUrl });

try {
  await client.connect();
  await provisionRuntimeRole(client, runtimePassword);
  console.log(`runtimeRole=${runtimeRole} status=granted`);
} finally {
  await client.end();
}
