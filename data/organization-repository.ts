/**
 * -------------------------------------------------------------------------
 * @file   organization-repository.ts
 * @brief  Creates and reads Organizations.
 *
 * @description
 *  Writes a new Organization row and reads one by id for the app shell.
 *
 * @see
 *  data/schema.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Queryable } from "@/data/database";

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

export function createOrganizationRepository(connection: Queryable): OrganizationRepository {
  return {
    async create(input) {
      const organization = {
        id: randomUUID(),
        createdAt: new Date(),
        ...input,
      };

      await connection.query(`insert into organization (id, name, slug, created_at) values ($1, $2, $3, $4)`, [organization.id, organization.name, organization.slug, organization.createdAt]);

      return organization;
    },

    async findById(id) {
      const { rows } = await connection.query<{ id: string; name: string; slug: string; created_at: Date }>(`select id, name, slug, created_at from organization where id = $1 limit 1`, [id]);
      const row = rows[0];
      return row ? { id: row.id, name: row.name, slug: row.slug, createdAt: row.created_at } : null;
    },
  };
}
