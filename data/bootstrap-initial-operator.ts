/**
 * -------------------------------------------------------------------------
 * @file   bootstrap-initial-operator.ts
 * @brief  Creates the first Tracer Organization and Operator.
 *
 * @description
 *  Performs an idempotent bootstrap of Spurlock Labs and its provisioned
 *  Operator while holding a transaction-scoped PostgreSQL advisory lock.
 *
 * @remarks
 *  Partial or conflicting database state is rejected without writes.
 *
 * @see
 *  scripts/bootstrap-initial-operator.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { isValidIanaTimezone, normalizeIdentityEmail } from "@/data/auth-policy";

export interface BootstrapInitialOperatorInput {
  email: string;
  name: string;
  timezone: string;
}

export type BootstrapInitialOperatorResult =
  | { status: "created"; organizationId: string; userId: string }
  | { status: "existing"; organizationId: string; userId: string };

export class BootstrapConflictError extends Error {
  constructor() {
    super("Initial Operator bootstrap conflicts with existing state");
    this.name = "BootstrapConflictError";
  }
}

const organizationName = "Spurlock Labs";
const organizationSlug = "spurlock-labs";

function validateInput(input: BootstrapInitialOperatorInput): BootstrapInitialOperatorInput {
  const email = normalizeIdentityEmail(input.email);
  const name = input.name.trim();
  const timezone = input.timezone.trim();

  if (!email || !name || !isValidIanaTimezone(timezone)) {
    throw new BootstrapConflictError();
  }

  return { email, name, timezone };
}

async function findOrganization(client: PoolClient) {
  const result = await client.query<{
    id: string;
    name: string;
    slug: string;
    created_at: Date;
  }>(
    `select id, name, slug, created_at
       from organization
      where slug = $1 or name = $2
      for update`,
    [organizationSlug, organizationName],
  );
  return result.rows;
}

async function findUser(client: PoolClient, email: string) {
  const result = await client.query<{
    id: string;
    email: string;
    name: string;
    state: "Provisioned" | "Active" | "Disabled";
    timezone: string;
  }>(
    `select id, email, name, state, timezone
       from "user"
      where lower(trim(email)) = $1
      for update`,
    [email],
  );
  return result.rows;
}

export async function bootstrapInitialOperator(
  connection: Pool,
  input: BootstrapInitialOperatorInput,
): Promise<BootstrapInitialOperatorResult> {
  const validated = validateInput(input);
  const client = await connection.connect();

  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
      "tracer:bootstrap:spurlock-labs",
    ]);

    const organizations = await findOrganization(client);
    const users = await findUser(client, validated.email);

    if (organizations.length > 1 || users.length > 1) {
      throw new BootstrapConflictError();
    }

    const organization = organizations[0];
    const user = users[0];
    const membership = organization && user
      ? await client.query<{ id: string; role: string }>(
          `select id, role
             from member
            where organization_id = $1 and user_id = $2
            for update`,
          [organization.id, user.id],
        )
      : { rows: [] };

    const hasAnyState = Boolean(organization || user || membership.rows.length);
    const exactState =
      organization?.name === organizationName &&
      organization.slug === organizationSlug &&
      user?.email === validated.email &&
      user.name === validated.name &&
      user.timezone === validated.timezone &&
      (user.state === "Provisioned" || user.state === "Active") &&
      membership.rows.length === 1 &&
      membership.rows[0].role === "owner";

    if (exactState) {
      await client.query("commit");
      return { status: "existing", organizationId: organization.id, userId: user.id };
    }

    if (hasAnyState) {
      throw new BootstrapConflictError();
    }

    const organizationId = randomUUID();
    const userId = randomUUID();
    const now = new Date();

    await client.query(
      `insert into organization (id, name, slug, created_at)
       values ($1, $2, $3, $4)`,
      [organizationId, organizationName, organizationSlug, now],
    );
    await client.query(
      `insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at)
       values ($1, $2, $3, false, 'Provisioned', $4, $5, $5)`,
      [userId, validated.name, validated.email, validated.timezone, now],
    );
    await client.query(
      `insert into member (id, organization_id, user_id, role, created_at)
       values ($1, $2, $3, 'owner', $4)`,
      [randomUUID(), organizationId, userId, now],
    );
    await client.query("commit");
    return { status: "created", organizationId, userId };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
