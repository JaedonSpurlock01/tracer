/**
 * -------------------------------------------------------------------------
 * @file   workspaces.ts
 * @brief  Provides Organization-scoped Workspace operations.
 *
 * @description
 *  Creates, lists, updates, archives, and restores Workspaces while keeping
 *  lifecycle changes independent from Twilio and other provider systems.
 *  Archiving ends the Workspace's open Site Link.
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

import type { Database, Queryable, Transaction } from "@/data/database";

import { isValidIanaTimezone } from "@/data/auth-policy";
import {
  decideArchive,
  decideRestore,
  initialWorkspaceState,
  normalizeWorkspaceName,
  workspaceStates,
  type WorkspaceState,
} from "@/data/workspace-policy";

export interface WorkspaceRecord {
  id: string;
  name: string;
  reportingTimezone: string;
  state: WorkspaceState;
  destinationNumber: string | null;
  trackingNumber: string | null;
  numberAssignmentStartedAt: string | null;
  /** A number this Workspace left without its Twilio voice configuration being restored, until it is attached again. */
  voiceRestoreNeeded: string | null;
  publishedFlowVersion: { version: number; publishedAt: string } | null;
  hasDraft: boolean;
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

export function workspaceListQueryFromSearchParams(params: Readonly<Record<string, string | string[] | undefined>>): {
  search: string;
  state: WorkspaceState | "All";
  page: number;
} {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const state = first(params.state);
  const page = Number(first(params.page));
  return {
    search: first(params.search).trim(),
    state: workspaceStates.includes(state as WorkspaceState) ? (state as WorkspaceState) : "All",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
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
  tracking_number: string | null;
  number_assignment_started_at: Date | null;
  voice_restore_needed: string | null;
  published_flow_version: number | null;
  published_flow_published_at: Date | null;
  has_draft: boolean;
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
         na.phone_number as tracking_number, na.started_at as number_assignment_started_at,
         vr.phone_number as voice_restore_needed,
         fv.version as published_flow_version, fv.published_at as published_flow_published_at,
         exists (select 1 from call_flow_draft d where d.workspace_id = w.id and d.organization_id = w.organization_id) as has_draft,
         w.recording_enabled, w.analysis_enabled, w.spam_gate_enabled,
         w.whisper_enabled, w.whisper_message, w.created_by_user_id as created_by_id,
         u.name as created_by_name, w.created_at, w.updated_at, w.archived_at
    from workspace w
    left join "user" u on u.id = w.created_by_user_id
    left join number_assignment na on na.workspace_id = w.id and na.organization_id = w.organization_id and na.ended_at is null
    left join lateral (
      select version, published_at
        from flow_version
       where workspace_id = w.id and organization_id = w.organization_id
       order by version desc
       limit 1
    ) fv on true
    left join lateral (
      select skipped.phone_number
        from number_assignment skipped
       where skipped.workspace_id = w.id and skipped.organization_id = w.organization_id
         and skipped.voice_restore_skipped_at is not null
         and not exists (select 1 from number_assignment later where later.twilio_number_id = skipped.twilio_number_id and later.started_at > skipped.started_at)
       order by skipped.ended_at desc
       limit 1
    ) vr on true
   where w.organization_id = $1
`;

function toRecord(row: WorkspaceRow): WorkspaceRecord {
  return {
    id: row.id,
    name: row.name,
    reportingTimezone: row.reporting_timezone,
    state: row.state,
    destinationNumber: row.destination_number,
    trackingNumber: row.tracking_number,
    numberAssignmentStartedAt: row.number_assignment_started_at?.toISOString() ?? null,
    voiceRestoreNeeded: row.voice_restore_needed,
    publishedFlowVersion: row.published_flow_version === null || row.published_flow_published_at === null
      ? null
      : { version: Number(row.published_flow_version), publishedAt: row.published_flow_published_at.toISOString() },
    hasDraft: row.has_draft,
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

export const endOpenSiteLinkSql = "update site_link set ended_at = $3 where organization_id = $1 and workspace_id = $2 and ended_at is null";

export interface WorkspaceGrantScope {
  grantedToUserId: string;
  readableStates: readonly WorkspaceState[];
}

/** The reads every actor may use: an Operator over the Organization, a Client Viewer over granted Workspaces. */
export function createWorkspaceReads(connection: Queryable, organizationId: string, grantScope?: WorkspaceGrantScope): Pick<Workspaces, "list" | "find"> {
  function scopeConditions(values: unknown[]): string[] {
    if (!grantScope) return [];
    values.push(grantScope.grantedToUserId, grantScope.readableStates);
    return [
      `exists (select 1 from access_grant g where g.workspace_id = w.id and g.organization_id = w.organization_id and g.user_id = $${values.length - 1})`,
      `w.state = any($${values.length}::text[])`,
    ];
  }

  function toScopedRecord(row: WorkspaceRow): WorkspaceRecord {
    const record = toRecord(row);
    return grantScope ? { ...record, createdBy: null } : record;
  }

  async function selectRecord(connection: Queryable, id: string): Promise<WorkspaceRecord | null> {
    const values: unknown[] = [organizationId, id];
    const conditions = ["w.id = $2", ...scopeConditions(values)];
    const result = await connection.query<WorkspaceRow>(`${recordQuery} and ${conditions.join(" and ")} limit 1`, values);
    return result.rows[0] ? toScopedRecord(result.rows[0]) : null;
  }

  return {
    async list(query) {
      const normalized = normalizeQuery(query);
      const values: unknown[] = [organizationId];
      const conditions = ["w.organization_id = $1", ...scopeConditions(values)];
      const scopeValues = [...values];
      const scopeWhere = conditions.join(" and ");
      if (normalized.search) {
        values.push(`%${normalized.search}%`);
        conditions.push(`(w.name ilike $${values.length} or coalesce(w.destination_number, '') ilike $${values.length})`);
      }
      if (normalized.state !== "All") {
        values.push(normalized.state);
        conditions.push(`w.state = $${values.length}`);
      }
      const where = conditions.join(" and ");
      const countValues = [...values];
      values.push((normalized.page - 1) * normalized.pageSize, normalized.pageSize);
      const [count, rows, totals] = await Promise.all([
        connection.query<{ count: string }>(`select count(*) from workspace w where ${where}`, countValues),
        connection.query<WorkspaceRow>(`${recordQuery} and ${conditions.slice(1).join(" and ") || "true"} order by w.name, w.id offset $${values.length - 1} limit $${values.length}`, values),
        connection.query<{ state: WorkspaceState; count: string }>(
          `select w.state, count(*) from workspace w where ${scopeWhere} group by w.state`,
          scopeValues,
        ),
      ]);
      const counts = { setupRequired: 0, active: 0, archived: 0 };
      for (const row of totals.rows) {
        if (row.state === "Setup Required") counts.setupRequired = Number(row.count);
        if (row.state === "Active") counts.active = Number(row.count);
        if (row.state === "Archived") counts.archived = Number(row.count);
      }
      return { workspaces: rows.rows.map(toScopedRecord), total: Number(count.rows[0]?.count ?? 0), page: normalized.page, pageSize: normalized.pageSize, counts };
    },

    async find(id) {
      return selectRecord(connection, id);
    },
  };
}

export function createWorkspaces(database: Database, organizationId: string, grantScope?: WorkspaceGrantScope): Workspaces {
  const lock = `tracer:workspaces:${organizationId}`;
  const transaction = <T>(operation: (client: Transaction) => Promise<T>) => database.transaction(operation, { lock });

  return {
    ...createWorkspaceReads(database, organizationId, grantScope),

    async create(input) {
      const validated = validateNameAndTimezone(input.name, input.reportingTimezone);
      const now = new Date();
      try {
        return await transaction(async (client) => {
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

    async update(id, input) {
      if (input.name === undefined && input.reportingTimezone === undefined) throw new WorkspacesError("invalid_input");
      const name = input.name === undefined ? undefined : normalizeWorkspaceName(input.name);
      const timezone = input.reportingTimezone === undefined ? undefined : input.reportingTimezone.trim();
      if ((input.name !== undefined && !name) || (timezone !== undefined && !isValidIanaTimezone(timezone))) {
        throw new WorkspacesError("invalid_input");
      }
      try {
        return await transaction(async (client) => {
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
      return transaction(async (client) => {
        const target = await client.query<{ state: WorkspaceState }>("select state from workspace where organization_id = $1 and id = $2 for update", [organizationId, id]);
        const current = target.rows[0];
        if (!current) throw new WorkspacesError("not_found");
        const decision = decideArchive(current.state);
        if (!decision.allowed) throw new WorkspacesError(decision.reason);
        const now = new Date();
        await client.query("update workspace set state = $3, archived_at = $4, updated_at = $4 where organization_id = $1 and id = $2", [organizationId, id, decision.nextState, now]);
        await client.query(endOpenSiteLinkSql, [organizationId, id, now]);
        const updated = await createWorkspaceReads(client, organizationId, grantScope).find(id);
        if (!updated) throw new WorkspacesError("not_found");
        return updated;
      });
    },

    async restore(id) {
      return transaction(async (client) => {
        const target = await client.query<{ state: WorkspaceState }>("select state from workspace where organization_id = $1 and id = $2 for update", [organizationId, id]);
        const current = target.rows[0];
        if (!current) throw new WorkspacesError("not_found");
        const decision = decideRestore(current.state);
        if (!decision.allowed) throw new WorkspacesError(decision.reason);
        const now = new Date();
        await client.query("update workspace set state = $3, archived_at = null, updated_at = $4 where organization_id = $1 and id = $2", [organizationId, id, decision.nextState, now]);
        const updated = await createWorkspaceReads(client, organizationId, grantScope).find(id);
        if (!updated) throw new WorkspacesError("not_found");
        return updated;
      });
    },

    async countActive() {
      const result = await database.query<{ count: string }>("select count(*) from workspace where organization_id = $1 and state = 'Active'", [organizationId]);
      return Number(result.rows[0]?.count ?? 0);
    },
  };
}
