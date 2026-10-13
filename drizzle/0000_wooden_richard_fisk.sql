/**
 * -------------------------------------------------------------------------
 * @file   0000_wooden_richard_fisk.sql
 * @brief  Creates the Organization persistence schema.
 *
 * @description
 *  Adds the minimal Organization table used by Tracer repositories.
 *
 * @remarks
 *  Organization slugs are unique across the first-release tenant model.
 *
 * @see
 *  data/schema.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
