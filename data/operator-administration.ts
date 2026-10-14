/**
 * -------------------------------------------------------------------------
 * @file   operator-administration.ts
 * @brief  Provides Organization-scoped Operator administration operations.
 *
 * @description
 *  Provisions Operators, lists Organization users, and changes User State
 *  while protecting the last Active Operator and revoking disabled sessions.
 *
 * @remarks
 *  PostgreSQL advisory locks serialize concurrent changes within one
 *  Organization.
 *
 * @see
 *  data/auth-policy.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import {
  decideOperatorStateChange,
  isProvisionableRole,
  normalizeIdentityEmail,
  reenabledState,
  toCanonicalRole,
  type CanonicalRole,
  type MembershipRole,
  type UserState,
} from "@/data/auth-policy";

export interface OperatorRecord {
  id: string;
  name: string;
  email: string;
  role: CanonicalRole;
  state: UserState;
  emailVerified: boolean;
  lastSignInAt: string | null;
  provisionedBy: { id: string; name: string } | null;
  createdAt: string;
}

export type OperatorAdministrationErrorCode =
  | "invalid_input"
  | "role_unavailable"
  | "duplicate_email"
  | "not_found"
  | "last_active_operator"
  | "state_unchanged";

export class OperatorAdministrationError extends Error {
  constructor(public readonly code: OperatorAdministrationErrorCode) {
    super(code);
    this.name = "OperatorAdministrationError";
  }
}

export interface OperatorAdministration {
  list(): Promise<OperatorRecord[]>;
  provision(input: { email: string; name?: string; role: string; actorUserId: string }): Promise<OperatorRecord>;
  setState(userId: string, nextState: "Active" | "Disabled"): Promise<OperatorRecord>;
  find(userId: string): Promise<OperatorRecord | null>;
}

type OperatorRow = {
  id: string;
  name: string;
  email: string;
  role: MembershipRole;
  state: UserState;
  email_verified: boolean;
  last_sign_in_at: Date | null;
  provisioned_by_id: string | null;
  provisioned_by_name: string | null;
  created_at: Date;
};

const recordQuery = `
  select u.id, u.name, u.email, m.role, u.state, u.email_verified,
         u.last_sign_in_at, p.id as provisioned_by_id, p.name as provisioned_by_name,
         u.created_at
    from "user" u
    join member m on m.user_id = u.id and m.organization_id = $1
    left join "user" p on p.id = u.provisioned_by_user_id
`;

function toRecord(row: OperatorRow): OperatorRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: toCanonicalRole(row.role),
    state: row.state,
    emailVerified: row.email_verified,
    lastSignInAt: row.last_sign_in_at?.toISOString() ?? null,
    provisionedBy: row.provisioned_by_id && row.provisioned_by_name
      ? { id: row.provisioned_by_id, name: row.provisioned_by_name }
      : null,
    createdAt: row.created_at.toISOString(),
  };
}

async function selectRecord(client: PoolClient, organizationId: string, userId: string): Promise<OperatorRecord | null> {
  const result = await client.query<OperatorRow>(`${recordQuery} where u.id = $2 limit 1`, [organizationId, userId]);
  return result.rows[0] ? toRecord(result.rows[0]) : null;
}

async function withTransaction<T>(connection: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await connection.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export function createOperatorAdministration(connection: Pool, organizationId: string): OperatorAdministration {
  const lock = () => ["tracer:users:" + organizationId];

  return {
    async list() {
      const result = await connection.query<OperatorRow>(`${recordQuery} order by u.created_at`, [organizationId]);
      return result.rows.map(toRecord);
    },

    async find(userId) {
      const result = await connection.query<OperatorRow>(`${recordQuery} where u.id = $2 limit 1`, [organizationId, userId]);
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },

    async provision(input) {
      const email = normalizeIdentityEmail(input.email);
      const name = input.name?.trim() || email;
      if (!email) {
        throw new OperatorAdministrationError("invalid_input");
      }
      if (!isProvisionableRole(input.role)) {
        throw new OperatorAdministrationError("role_unavailable");
      }

      return withTransaction(connection, async (client) => {
        await client.query("select pg_advisory_xact_lock(hashtextextended('tracer:users:' || $1, 0))", lock());
        const existing = await client.query(`select id from "user" where lower(trim(email)) = $1 limit 1`, [email]);
        if (existing.rows[0]) {
          throw new OperatorAdministrationError("duplicate_email");
        }

        const userId = randomUUID();
        const now = new Date();
        await client.query(
          `insert into "user" (id, name, email, email_verified, state, timezone, provisioned_by_user_id, created_at, updated_at)
           values ($1, $2, $3, false, 'Provisioned', 'UTC', $4, $5, $5)`,
          [userId, name, email, input.actorUserId, now],
        );
        await client.query(
          `insert into member (id, organization_id, user_id, role, created_at)
           values ($1, $2, $3, 'owner', $4)`,
          [randomUUID(), organizationId, userId, now],
        );
        const record = await selectRecord(client, organizationId, userId);
        if (!record) {
          throw new OperatorAdministrationError("not_found");
        }
        return record;
      });
    },

    async setState(userId, nextState) {
      return withTransaction(connection, async (client) => {
        await client.query("select pg_advisory_xact_lock(hashtextextended('tracer:users:' || $1, 0))", lock());
        const target = await client.query<{
          state: UserState;
          role: MembershipRole;
          email_verified: boolean;
        }>(
          `select u.state, m.role, u.email_verified
             from "user" u
             join member m on m.user_id = u.id and m.organization_id = $1
            where u.id = $2
            for update`,
          [organizationId, userId],
        );
        const current = target.rows[0];
        if (!current) {
          throw new OperatorAdministrationError("not_found");
        }
        if (current.state === nextState) {
          throw new OperatorAdministrationError("state_unchanged");
        }

        const activeOperators = await client.query<{ count: string }>(
          `select count(*)
             from "user" u
             join member m on m.user_id = u.id and m.organization_id = $1
            where u.state = 'Active' and m.role = 'owner'`,
          [organizationId],
        );
        const decision = decideOperatorStateChange({
          target: current,
          nextState,
          activeOperatorCount: Number(activeOperators.rows[0].count),
        });
        if (!decision.allowed) {
          throw new OperatorAdministrationError(decision.reason);
        }

        const state = nextState === "Active" ? reenabledState(current.email_verified) : "Disabled";
        await client.query(`update "user" set state = $1, updated_at = now() where id = $2`, [state, userId]);
        if (nextState === "Disabled") {
          await client.query(`delete from session where user_id = $1`, [userId]);
        }
        const record = await selectRecord(client, organizationId, userId);
        if (!record) {
          throw new OperatorAdministrationError("not_found");
        }
        return record;
      });
    },
  };
}
