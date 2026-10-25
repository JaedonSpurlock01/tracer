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

import type { Database } from "@/data/database";

import { createOrganizationRepository } from "@/data/organization-repository";

/** Thrown inside the smoke transaction so the module rolls its write back. */
class SmokeRollback extends Error {}

export async function smokeDatabase(database: Database): Promise<void> {
  await database
    .transaction(async (client) => {
      const repository = createOrganizationRepository(client);
      const created = await repository.create({
        name: "Tracer Staging Smoke",
        slug: `tracer-staging-smoke-${randomUUID()}`,
      });
      const found = await repository.findById(created.id);

      if (!found) {
        throw new Error("Organization smoke read did not return the created record");
      }
      throw new SmokeRollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof SmokeRollback)) throw error;
    });
}
