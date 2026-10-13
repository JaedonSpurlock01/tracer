/**
 * -------------------------------------------------------------------------
 * @file   organization-repository.ts
 * @brief  Persists and reads Organizations.
 *
 * @description
 *  Exposes the minimal Organization persistence interface shared by direct
 *  PostgreSQL tests and Cloudflare Hyperdrive runtime connections.
 *
 * @remarks
 *  The repository owns opaque Organization identifier generation.
 *
 * @see
 *  CONTEXT.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";

import { organizations } from "@/data/schema";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
}

export interface CreateOrganization {
  name: string;
  slug: string;
}

export interface OrganizationRepository {
  create(input: CreateOrganization): Promise<Organization>;
  findById(id: string): Promise<Organization | null>;
}

export function createOrganizationRepository(connection: Pool | PoolClient): OrganizationRepository {
  const database = drizzle(connection);

  return {
    async create(input) {
      const organization = {
        id: randomUUID(),
        createdAt: new Date(),
        ...input,
      };

      await database.insert(organizations).values(organization);

      return organization;
    },

    async findById(id) {
      const [organization] = await database
        .select()
        .from(organizations)
        .where(eq(organizations.id, id))
        .limit(1);

      return organization ?? null;
    },
  };
}
