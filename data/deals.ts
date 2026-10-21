/**
 * -------------------------------------------------------------------------
 * @file   deals.ts
 * @brief  Creates, edits, ends, and reads a Workspace's Deals.
 *
 * @description
 *  A Deal is a Workspace's agreement with its business: Monthly, Weekly,
 *  or Per Lead with an amount in cents, a start date, and an optional end
 *  date. Operators read the current open Deal and the history, create a
 *  Deal (ending any open one on the new start date), change an open
 *  Deal's kind, amount, or start date, and end an open Deal on a date.
 *  Every call requires an Active Operator; Client Viewers never read a
 *  Deal.
 *
 * @remarks
 *  At most one open Deal per Workspace is enforced by a partial unique
 *  index, and the create runs in one transaction under a per-Workspace
 *  advisory lock so a race still leaves one open Deal. Ended Deals stay
 *  as history and are never deleted, so the runtime role needs no DELETE
 *  grant. Dates are calendar dates without a timezone, as the Product
 *  Owner enters them.
 *
 * @see
 *  data/cost-revenue.ts
 *  data/pricing.ts
 *  CONTEXT.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { AuthorizationError, type Actor } from "@/data/authorization";
import { dealKinds, type DealKind } from "@/data/pricing";
import { canManageWorkspaces } from "@/data/workspace-authorization";

export interface DealRecord {
  id: string;
  workspaceId: string;
  kind: DealKind;
  amountCents: number;
  startedOn: string;
  endedOn: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DealsErrorCode = "invalid_input" | "not_found" | "deal_ended";

export class DealsError extends Error {
  constructor(public readonly code: DealsErrorCode) {
    super(code);
    this.name = "DealsError";
  }
}

export interface Deals {
  current(workspaceId: string): Promise<DealRecord | null>;
  history(workspaceId: string): Promise<DealRecord[]>;
  create(input: { workspaceId: string; kind: unknown; amountCents: unknown; startedOn: unknown }): Promise<DealRecord>;
  update(dealId: string, input: { workspaceId: string; kind?: unknown; amountCents?: unknown; startedOn?: unknown }): Promise<DealRecord>;
  end(dealId: string, input: { workspaceId: string; endedOn: unknown }): Promise<DealRecord>;
}

type DealRow = { id: string; workspace_id: string; kind: DealKind; amount_cents: number; started_on: string; ended_on: string | null; created_at: Date; updated_at: Date };

const dealColumns = "id, workspace_id, kind, amount_cents, started_on::text as started_on, ended_on::text as ended_on, created_at, updated_at";

function toDeal(row: DealRow): DealRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    amountCents: row.amount_cents,
    startedOn: row.started_on,
    endedOn: row.ended_on,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function parseCalendarDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DealsError("invalid_input");
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new DealsError("invalid_input");
  return value;
}

function parseKind(value: unknown): DealKind {
  if (typeof value !== "string" || !dealKinds.includes(value as DealKind)) throw new DealsError("invalid_input");
  return value as DealKind;
}

function parseAmount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new DealsError("invalid_input");
  return value;
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

export function createDeals(pool: Pool, actor: Actor): Deals {
  if (!canManageWorkspaces(actor)) throw new AuthorizationError(403);
  const organizationId = actor.organizationId;

  async function requireWorkspace(client: Pool | PoolClient, workspaceId: string): Promise<void> {
    const workspace = await client.query("select 1 from workspace where organization_id = $1 and id = $2", [organizationId, workspaceId]);
    if (!workspace.rowCount) throw new DealsError("not_found");
  }

  async function findOpen(client: Pool | PoolClient, dealId: string, workspaceId: string): Promise<DealRow> {
    const result = await client.query<DealRow>(`select ${dealColumns} from deal where id = $1 and workspace_id = $2 and organization_id = $3`, [dealId, workspaceId, organizationId]);
    const row = result.rows[0];
    if (!row) throw new DealsError("not_found");
    if (row.ended_on !== null) throw new DealsError("deal_ended");
    return row;
  }

  return {
    async current(workspaceId) {
      await requireWorkspace(pool, workspaceId);
      const result = await pool.query<DealRow>(`select ${dealColumns} from deal where workspace_id = $1 and organization_id = $2 and ended_on is null`, [workspaceId, organizationId]);
      return result.rows[0] ? toDeal(result.rows[0]) : null;
    },

    async history(workspaceId) {
      await requireWorkspace(pool, workspaceId);
      const result = await pool.query<DealRow>(`select ${dealColumns} from deal where workspace_id = $1 and organization_id = $2 order by started_on desc, created_at desc`, [workspaceId, organizationId]);
      return result.rows.map(toDeal);
    },

    async create(input) {
      const kind = parseKind(input.kind);
      const amountCents = parseAmount(input.amountCents);
      const startedOn = parseCalendarDate(input.startedOn);
      return withTransaction(pool, async (client) => {
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`tracer:deals:${input.workspaceId}`]);
        await requireWorkspace(client, input.workspaceId);
        const now = new Date();
        await client.query(
          "update deal set ended_on = greatest(started_on, $3::date), updated_at = $4 where workspace_id = $1 and organization_id = $2 and ended_on is null",
          [input.workspaceId, organizationId, startedOn, now],
        );
        const inserted = await client.query<DealRow>(
          `insert into deal (id, organization_id, workspace_id, kind, amount_cents, started_on, created_by_user_id, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6::date, $7, $8, $8) returning ${dealColumns}`,
          [randomUUID(), organizationId, input.workspaceId, kind, amountCents, startedOn, actor.userId, now],
        );
        return toDeal(inserted.rows[0]);
      });
    },

    async update(dealId, input) {
      const kind = input.kind === undefined ? undefined : parseKind(input.kind);
      const amountCents = input.amountCents === undefined ? undefined : parseAmount(input.amountCents);
      const startedOn = input.startedOn === undefined ? undefined : parseCalendarDate(input.startedOn);
      const current = await findOpen(pool, dealId, input.workspaceId);
      const updated = await pool.query<DealRow>(
        `update deal set kind = $2, amount_cents = $3, started_on = $4::date, updated_at = $5 where id = $1 and ended_on is null returning ${dealColumns}`,
        [dealId, kind ?? current.kind, amountCents ?? current.amount_cents, startedOn ?? current.started_on, new Date()],
      );
      if (!updated.rows[0]) throw new DealsError("not_found");
      return toDeal(updated.rows[0]);
    },

    async end(dealId, input) {
      const endedOn = parseCalendarDate(input.endedOn);
      const current = await findOpen(pool, dealId, input.workspaceId);
      if (endedOn < current.started_on) throw new DealsError("invalid_input");
      const ended = await pool.query<DealRow>(`update deal set ended_on = $2::date, updated_at = $3 where id = $1 and ended_on is null returning ${dealColumns}`, [dealId, endedOn, new Date()]);
      if (!ended.rows[0]) throw new DealsError("not_found");
      return toDeal(ended.rows[0]);
    },
  };
}
