/**
 * -------------------------------------------------------------------------
 * @file   schema.ts
 * @brief  Defines Tracer's PostgreSQL schema.
 *
 * @description
 *  Declares application tables shared by migrations and repository queries.
 *
 * @remarks
 *  Tenant-owned records begin with the Organization root record.
 *
 * @see
 *  CONTEXT.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const organizations = pgTable("organization", {
  id: text().primaryKey(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
