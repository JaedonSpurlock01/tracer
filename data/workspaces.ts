/**
 * -------------------------------------------------------------------------
 * @file   workspaces.ts
 * @brief  Provides Organization-scoped Workspace operations.
 *
 * @description
 *  Creates, lists, updates, archives, and restores Workspaces while keeping
 *  lifecycle changes independent from Twilio and other provider systems.
 *
 * @remarks
 *  Every query includes the owning Organization and mutations use an advisory
 *  lock to serialize concurrent Workspace changes.
 *
 * @see
 *  data/workspace-policy.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { isValidIanaTimezone } from "@/data/auth-policy";
import {
  decideArchive,
  decideRestore,
  initialWorkspaceState,
  normalizeWorkspaceName,
  type WorkspaceState,
} from "@/data/workspace-policy";

export interface WorkspaceRecord {
  id: string;
  name: string;
  reportingTimezone: string;
  state: WorkspaceState;
  destinationNumber: string | null;
  recordingEnabled: boolean;
  analysisEnabled: boolean;
  spamGateEnabled: boolean;
  whisperEnabled: boolean;
  whisperMessage: string | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export type WorkspacesErrorCode = "invalid_input" | "name_taken" | "not_found" | "state_unchanged" | "archive_unavailable";

export class WorkspacesError extends Error {
  constructor(public readonly code: WorkspacesErrorCode) {
    super(code);
    this.name = "WorkspacesError";
  }
}

export interface WorkspaceListQuery {
  search?: string;
  state?: WorkspaceState | "All";
  page?: number;
  pageSize?: number;
}

export interface WorkspaceListResult {
  workspaces: WorkspaceRecord[];
  total: number;
  page: number;
  pageSize: number;
  counts: { setupRequired: number; active: number; archived: number };
}

export interface Workspaces {
  list(query: WorkspaceListQuery): Promise<WorkspaceListResult>;
  create(input: { name: string; reportingTimezone: string; actorUserId: string }): Promise<WorkspaceRecord>;
  find(id: string): Promise<WorkspaceRecord | null>;
  update(id: string, input: { name?: string; reportingTimezone?: string }): Promise<WorkspaceRecord>;
  archive(id: string): Promise<WorkspaceRecord>;
  restore(id: string): Promise<WorkspaceRecord>;
  countActive(): Promise<number>;
}

type WorkspaceRow = {
  id: string;
  name: string;
  reporting_timezone: string;
  state: WorkspaceState;
  destination_number: string | null;
  recording_enabled: boolean;
  analysis_enabled: boolean;
  spam_gate_enabled: boolean;
  whisper_enabled: boolean;
  whisper_message: string | null;
  created_by_id: string | null;
  created_by_name: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
};

const recordQuery = `
  select w.id, w.name, w.reporting_timezone, w.state, w.destination_number,
         w.recording_enabled, w.analysis_enabled, w.spam_gate_enabled,
         w.whisper_enabled, w.whisper_message, w.created_by_user_id as created_by_id,
         u.name as created_by_name, w.created_at, w.updated_at, w.archived_at
    from workspace w
    left join "user" u on u.id = w.created_by_user_id
   where w.organization_id = $1
`;

function toRecord(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    name: row.name,
    reportingTimezone: row.reporting_timezone,
    state: row.state,
    destinationNumber: row.destination_number,
    recordingEnabled: row.recording_enabled,
    analysisEnabled: row.analysis_enabled,
    spamGateEnabled: row.spam_gate_enabled,
    whisperEnabled: row.whisper_enabled,
    whisperMessage: row.whisper_message,
    createdBy: row.created_by_id && row.created_by_name ? { id: row.created_by_id, name: row.created_by_name } : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    archivedAt: row.archived_at?.toISOString() ?? null,
  };
}

async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
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

function normalizeQuery(query: WorkspaceListQuery): { search: string; state: WorkspaceState | "All"; page: number; pageSize: number } {
  const page = Number.isInteger(query.page) && (query.page ?? 0) > 0 ? query.page! : 1;
  const pageSize = Number.isInteger(query.pageSize) && (query.pageSize ?? 0) > 0 ? Math.min(query.pageSize!, 50) : 10;
  const state = query.state ?? "All";
  if (state !== "All" && !["Setup Required", "Active", "Archived"].includes(state)) {
    throw new WorkspacesError("invalid_input");
  }
  return { search: query.search?.trim() ?? "", state, page, pageSize };
}

function validateNameAndTimezone(name: string | undefined, timezone: string | undefined): { name: string; timezone: string } {
  const normalizedName = typeof name === "string" ? normalizeWorkspaceName(name) : null;
  const normalizedTimezone = typeof timezone === "string" ? timezone.trim() : "";
  if (!normalizedName || !isValidIanaTimezone(normalizedTimezone)) {
    throw new WorkspacesError("invalid_input");
  }
  return { name: normalizedName, timezone: normalizedTimezone };
}

function isNameConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

export function createWorkspaces(pool: Pool, organizationId: string): Workspaces {
  const lock = `tracer:workspaces:${organizationId}`;

  async function selectRecord(connection: Pool | PoolClient, id: string): Promise<WorkspaceRecord | null> {
    const result = await connection.query<WorkspaceRow>(`${recordQuery} and w.id = $2 limit 1`, [organizationId, id]);
    return result.rows[0] ? toRecord(result.rows[0]) : null;
  }

  async function lockOrganization(client: PoolClient): Promise<void> {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [lock]);
  }

  return {
    async list(query) {
      const normalized = normalizeQuery(query);
      const values: unknown[] = [organizationId];
      const conditions = ["w.organization_id = $1"];
      if (normalized.search) {
        values.push(`%${normalized.search}%`);
        conditions.push(`(w.name ilike $${values.length} or coalesce(w.destination_number, '') ilike $${values.length})`);
      }
      if (normalized.state !== "All") {
        values.push(normalized.state);
        conditions.push(`w.state = $${values.length}`);
      }
      const where = conditions.join(" and ");
      const count = await pool.query<{ count: string }>(`select count(*) from workspace w where ${where}`, values);
      values.push((normalized.page - 1) * normalized.pageSize, normalized.pageSize);
      const rows = await pool.query<WorkspaceRow>(`${recordQuery} and ${conditions.slice(1).join(" and ") || "true"} order by w.name, w.id offset $${values.length - 1} limit $${values.length}`, values);
      const totals = await pool.query<{ state: WorkspaceState; count: string }>(
        "select state, count(*) from workspace where organization_id = $1 group by state",
        [organizationId],
      );
      const counts = { setupRequired: 0, active: 0, archived: 0 };
      for (const row of totals.rows) {
        if (row.state === "Setup Required") counts.setupRequired = Number(row.count);
        if (row.state === "Active") counts.active = Number(row.count);
        if (row.state === "Archived") counts.archived = Number(row.count);
      }
      return { workspaces: rows.rows.map(toRecord), total: Number(count.rows[0]?.count ?? 0), page: normalized.page, pageSize: normalized.pageSize, counts };
    },

    async create(input) {
      const validated = validateNameAndTimezone(input.name, input.reportingTimezone);
      const now = new Date();
      try {
        return await withTransaction(pool, async (client) => {
          await lockOrganization(client);
          const workspaceId = randomUUID();
          await client.query(
            `insert into workspace (id, organization_id, name, reporting_timezone, state, created_by_user_id, created_at, updated_at)
             values ($1, $2, $3, $4, $5, $6, $7, $7)`,
            [workspaceId, organizationId, validated.name, validated.timezone, initialWorkspaceState, input.actorUserId, now],
          );
          const result = await client.query<WorkspaceRow>(`${recordQuery} and w.id = $2 limit 1`, [organizationId, workspaceId]);
          if (!result.rows[0]) throw new WorkspacesError("not_found");
          return toRecord(result.rows[0]);
        });
      } catch (error) {
        if (isNameConflict(error)) throw new WorkspacesError("name_taken");
        throw error;
      }
    },

    async find(id) {
      return selectRecord(pool, id);
    },

    async update(id, input) {
      if (input.name === undefined && input.reportingTimezone === undefined) throw new WorkspacesError("invalid_input");
      const name = input.name === undefined ? undefined : normalizeWorkspaceName(input.name);
      const timezone = input.reportingTimezone === undefined ? undefined : input.reportingTimezone.trim();
      if ((input.name !== undefined && !name) || (timezone !== undefined && !isValidIanaTimezone(timezone))) {
        throw new WorkspacesError("invalid_input");
      }
      try {
        return await withTransaction(pool, async (client) => {
          await lockOrganization(client);
          const current = await client.query<{ id: string }>("select id from workspace where organization_id = $1 and id = $2 for update", [organizationId, id]);
          if (!current.rows[0]) throw new WorkspacesError("not_found");
          const now = new Date();
          const result = await client.query(
            `update workspace set name = coalesce($3, name), reporting_timezone = coalesce($4, reporting_timezone), updated_at = $5
              where organization_id = $1 and id = $2`,
            [organizationId, id, name ?? null, timezone ?? null, now],
          );
          if (!result.rowCount) throw new WorkspacesError("not_found");
          const updated = await client.query<WorkspaceRow>(`${recordQuery} and w.id = $2 limit 1`, [organizationId, id]);
          return toRecord(updated.rows[0]);
        });
      } catch (error) {
        if (isNameConflict(error)) throw new WorkspacesError("name_taken");
        throw error;
      }
    },

    async archive(id) {
      return withTransaction(pool, async (client) => {
        await lockOrganization(client);
        const target = await client.query<{ state: WorkspaceState }>("select state from workspace where organization_id = $1 and id = $2 for update", [organizationId, id]);
        const current = target.rows[0];
        if (!current) throw new WorkspacesError("not_found");
        const decision = decideArchive(current.state);
        if (!decision.allowed) throw new WorkspacesError(decision.reason);
        const now = new Date();
        await client.query("update workspace set state = $3, archived_at = $4, updated_at = $4 where organization_id = $1 and id = $2", [organizationId, id, decision.nextState, now]);
        const updated = await selectRecord(client, id);
        if (!updated) throw new WorkspacesError("not_found");
        return updated;
      });
    },

    async restore(id) {
      return withTransaction(pool, async (client) => {
        await lockOrganization(client);
        const target = await client.query<{ state: WorkspaceState }>("select state from workspace where organization_id = $1 and id = $2 for update", [organizationId, id]);
        const current = target.rows[0];
        if (!current) throw new WorkspacesError("not_found");
        const decision = decideRestore(current.state);
        if (!decision.allowed) throw new WorkspacesError(decision.reason);
        const now = new Date();
        await client.query("update workspace set state = $3, archived_at = null, updated_at = $4 where organization_id = $1 and id = $2", [organizationId, id, decision.nextState, now]);
        const updated = await selectRecord(client, id);
        if (!updated) throw new WorkspacesError("not_found");
        return updated;
      });
    },

    async countActive() {
      const result = await pool.query<{ count: string }>("select count(*) from workspace where organization_id = $1 and state = 'Active'", [organizationId]);
      return Number(result.rows[0]?.count ?? 0);
    },
  };
}
