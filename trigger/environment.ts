/**
 * -------------------------------------------------------------------------
 * @file   environment.ts
 * @brief  Reads Trigger.dev task configuration from environment variables.
 *
 * @description
 *  Returns required environment variables by name and opens the small
 *  PostgreSQL pool each task run uses.
 *
 * @remarks
 *  Tasks run in Trigger.dev Cloud outside the Worker bindings, so they read
 *  their credentials from Trigger.dev environment variables. One connection
 *  per run is enough because a run issues its queries in sequence.
 *
 * @see
 *  docs/DATA_PLATFORM.md
 *  https://trigger.dev/docs/database-connections
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { Pool } from "pg";

export function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function taskPool(): Pool {
  return new Pool({ connectionString: requiredEnvironment("DATABASE_URL"), max: 1 });
}
