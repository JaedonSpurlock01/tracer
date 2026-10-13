/**
 * -------------------------------------------------------------------------
 * @file   drizzle.config.ts
 * @brief  Configures Tracer's Drizzle migration generation.
 *
 * @description
 *  Connects the application schema to the checked-in PostgreSQL migration
 *  directory.
 *
 * @remarks
 *  Runtime database access is configured separately through Hyperdrive.
 *
 * @see
 *  data/schema.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./data/schema.ts",
});
