/**
 * -------------------------------------------------------------------------
 * @file   database-smoke.ts
 * @brief  Verifies the runtime Organization persistence path.
 *
 * @description
 *  Creates and reads an Organization inside a transaction, then rolls the
 *  transaction back so smoke checks never retain application data.
 *
 * @remarks
 *  The same behavior runs through PostgreSQL and Cloudflare Hyperdrive pools.
 *
 * @see
 *  data/organization-repository.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { createOrganizationRepository } from "@/data/organization-repository";

export async function smokeDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("begin");

    const repository = createOrganizationRepository(client);
    const created = await repository.create({
      name: "Tracer Staging Smoke",
      slug: `tracer-staging-smoke-${randomUUID()}`,
    });
    const found = await repository.findById(created.id);

    if (!found) {
      throw new Error("Organization smoke read did not return the created record");
    }
  } finally {
    await client.query("rollback");
    client.release();
  }
}
