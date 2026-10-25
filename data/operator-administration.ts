/**
 * -------------------------------------------------------------------------
 * @file   operator-administration.ts
 * @brief  Provides Organization-scoped user administration operations.
 *
 * @description
 *  Provisions Operators and Client Viewers, lists Organization users with
 *  their Access Grants, and changes User State while protecting the last
 *  Active Operator and revoking disabled sessions.
 *
 * @remarks
 *  PostgreSQL advisory locks serialize concurrent changes within one
 *  Organization. A Client Viewer and its initial Access Grants are written in
 *  one transaction so a Client Viewer never exists without a grant.
 *
 * @see
 *  data/auth-policy.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Database, Transaction } from "@/data/database";

import {
  decideOperatorStateChange,
  decideRoleChange,
  isProvisionableRole,
  normalizeIdentityEmail,
  reenabledState,
  toCanonicalRole,
  type CanonicalRole,
  type MembershipRole,
  type UserState,
} from "@/data/auth-policy";
import { canReceiveAccessGrant, type WorkspaceState } from "@/data/workspace-policy";

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
  accessGrants: AccessGrantSummary[];
}

export interface AccessGrantSummary {
  workspaceId: string;
  workspaceName: string;
}

export type OperatorAdministrationErrorCode =
  | "invalid_input"
  | "role_unavailable"
  | "duplicate_email"
  | "not_found"
  | "last_active_operator"
  | "state_unchanged"
  | "access_grant_required"
  | "workspace_not_grantable"
  | "not_client_viewer"
  | "last_access_grant";

export class OperatorAdministrationError extends Error {
  constructor(public readonly code: OperatorAdministrationErrorCode) {
    super(code);
    this.name = "OperatorAdministrationError";
  }
}

export interface OperatorAdministration {
  list(): Promise<OperatorRecord[]>;
  provision(input: {
    email: string;
    name?: string;
    role: string;
    workspaceIds?: readonly string[];
    actorUserId: string;
  }): Promise<OperatorRecord>;
  setState(userId: string, nextState: "Active" | "Disabled"): Promise<OperatorRecord>;
  find(userId: string): Promise<OperatorRecord | null>;
  addAccessGrant(input: { userId: string; workspaceId: string; actorUserId: string }): Promise<OperatorRecord>;
  removeAccessGrant(input: { userId: string; workspaceId: string }): Promise<OperatorRecord>;
  setRole(input: {
    userId: string;
    role: string;
    workspaceIds?: readonly string[];
    actorUserId: string;
  }): Promise<OperatorRecord>;
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
  access_grants: AccessGrantSummary[];
};

const recordQuery = `
  select u.id, u.name, u.email, m.role, u.state, u.email_verified,
         u.last_sign_in_at, p.id as provisioned_by_id, p.name as provisioned_by_name,
         u.created_at,
         coalesce(
           (select json_agg(json_build_object('workspaceId', w.id, 'workspaceName', w.name) order by w.name)
              from access_grant g
              join workspace w on w.id = g.workspace_id
             where g.user_id = u.id and g.organization_id = $1),
           '[]'::json
         ) as access_grants
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
    accessGrants: row.access_grants,
  };
}

async function insertAccessGrants(
  client: Transaction,
  input: { organizationId: string; userId: string; workspaceIds: readonly string[]; actorUserId: string },
): Promise<void> {
  const workspaceIds = [...new Set(input.workspaceIds)];
  const workspaces = await client.query<{ id: string; state: WorkspaceState }>(
    `select id, state from workspace where organization_id = $1 and id = any($2::text[]) for share`,
    [input.organizationId, workspaceIds],
  );
  if (workspaces.rows.length !== workspaceIds.length || !workspaces.rows.every((row) => canReceiveAccessGrant(row.state))) {
    throw new OperatorAdministrationError("workspace_not_grantable");
  }
  for (const workspaceId of workspaceIds) {
    await client.query(
      `insert into access_grant (id, organization_id, workspace_id, user_id, granted_by_user_id, created_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (user_id, workspace_id) do nothing`,
      [randomUUID(), input.organizationId, workspaceId, input.userId, input.actorUserId],
    );
  }
}

async function selectRecord(client: Transaction, organizationId: string, userId: string): Promise<OperatorRecord | null> {
  const result = await client.query<OperatorRow>(`${recordQuery} where u.id = $2 limit 1`, [organizationId, userId]);
  return result.rows[0] ? toRecord(result.rows[0]) : null;
}

async function countActiveOperators(client: Transaction, organizationId: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)
       from "user" u
       join member m on m.user_id = u.id and m.organization_id = $1
      where u.state = 'Active' and m.role = 'owner'`,
    [organizationId],
  );
  return Number(result.rows[0].count);
}

async function lockMembershipRole(client: Transaction, organizationId: string, userId: string): Promise<MembershipRole> {
  const membership = await client.query<{ role: MembershipRole }>(
    `select role from member where organization_id = $1 and user_id = $2 for update`,
    [organizationId, userId],
  );
  if (!membership.rows[0]) {
    throw new OperatorAdministrationError("not_found");
  }
  return membership.rows[0].role;
}

export function createOperatorAdministration(connection: Database, organizationId: string): OperatorAdministration {
  const lock = () => ["tracer:users:" + organizationId];
  const lockUsers = (client: Transaction) =>
    client.query("select pg_advisory_xact_lock(hashtextextended('tracer:users:' || $1, 0))", lock());
  const requireRecord = async (client: Transaction, userId: string) => {
    const record = await selectRecord(client, organizationId, userId);
    if (!record) {
      throw new OperatorAdministrationError("not_found");
    }
    return record;
  };

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
      const role = input.role;
      const workspaceIds = input.workspaceIds ?? [];
      if (role === "Client Viewer" && workspaceIds.length === 0) {
        throw new OperatorAdministrationError("access_grant_required");
      }

      return connection.transaction(async (client) => {
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
           values ($1, $2, $3, $4, $5)`,
          [randomUUID(), organizationId, userId, role === "Operator" ? "owner" : "member", now],
        );
        if (role === "Client Viewer") {
          await insertAccessGrants(client, { organizationId, userId, workspaceIds, actorUserId: input.actorUserId });
        }
        const record = await selectRecord(client, organizationId, userId);
        if (!record) {
          throw new OperatorAdministrationError("not_found");
        }
        return record;
      });
    },

    async addAccessGrant(input) {
      return connection.transaction(async (client) => {
        await lockUsers(client);
        if ((await lockMembershipRole(client, organizationId, input.userId)) !== "member") {
          throw new OperatorAdministrationError("not_client_viewer");
        }
        await insertAccessGrants(client, {
          organizationId,
          userId: input.userId,
          workspaceIds: [input.workspaceId],
          actorUserId: input.actorUserId,
        });
        return requireRecord(client, input.userId);
      });
    },

    async removeAccessGrant(input) {
      return connection.transaction(async (client) => {
        await lockUsers(client);
        const role = await lockMembershipRole(client, organizationId, input.userId);
        const grants = await client.query<{ workspace_id: string }>(
          `select workspace_id from access_grant where organization_id = $1 and user_id = $2`,
          [organizationId, input.userId],
        );
        if (!grants.rows.some((grant) => grant.workspace_id === input.workspaceId)) {
          throw new OperatorAdministrationError("not_found");
        }
        if (role === "member" && grants.rows.length <= 1) {
          throw new OperatorAdministrationError("last_access_grant");
        }
        await client.query(
          `delete from access_grant where organization_id = $1 and user_id = $2 and workspace_id = $3`,
          [organizationId, input.userId, input.workspaceId],
        );
        return requireRecord(client, input.userId);
      });
    },

    async setRole(input) {
      if (!isProvisionableRole(input.role)) {
        throw new OperatorAdministrationError("role_unavailable");
      }
      const nextRole = input.role;
      return connection.transaction(async (client) => {
        await lockUsers(client);
        const target = await client.query<{ state: UserState; role: MembershipRole }>(
          `select u.state, m.role
             from "user" u
             join member m on m.user_id = u.id and m.organization_id = $1
            where u.id = $2
            for update`,
          [organizationId, input.userId],
        );
        const current = target.rows[0];
        if (!current) {
          throw new OperatorAdministrationError("not_found");
        }
        if (nextRole === "Client Viewer" && input.workspaceIds?.length) {
          await insertAccessGrants(client, {
            organizationId,
            userId: input.userId,
            workspaceIds: input.workspaceIds,
            actorUserId: input.actorUserId,
          });
        }
        const grants = await client.query<{ count: string }>(
          `select count(*) from access_grant where organization_id = $1 and user_id = $2`,
          [organizationId, input.userId],
        );
        const decision = decideRoleChange({
          target: current,
          nextRole,
          activeOperatorCount: await countActiveOperators(client, organizationId),
          accessGrantCount: Number(grants.rows[0].count),
        });
        if (!decision.allowed) {
          throw new OperatorAdministrationError(decision.reason);
        }
        await client.query(
          `update member set role = $1 where organization_id = $2 and user_id = $3`,
          [nextRole === "Operator" ? "owner" : "member", organizationId, input.userId],
        );
        return requireRecord(client, input.userId);
      });
    },

    async setState(userId, nextState) {
      return connection.transaction(async (client) => {
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

        const decision = decideOperatorStateChange({
          target: current,
          nextState,
          activeOperatorCount: await countActiveOperators(client, organizationId),
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
