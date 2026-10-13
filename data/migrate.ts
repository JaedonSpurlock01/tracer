/**
 * -------------------------------------------------------------------------
 * @file   migrate.ts
 * @brief  Applies Tracer's PostgreSQL migrations.
 *
 * @description
 *  Opens a dedicated direct PostgreSQL connection and applies every pending
 *  Drizzle migration before closing the connection.
 *
 * @remarks
 *  Worker runtime queries do not use this migration connection path.
 *
 * @see
 *  docs/IMPLEMENTATION_ROADMAP.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function migrateDatabase(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });

  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
