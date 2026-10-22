/**
 * -------------------------------------------------------------------------
 * @file   business.ts
 * @brief  Reads and saves the Business behind a Workspace.
 *
 * @description
 *  A Business is the client a Workspace serves: its name, the contact's
 *  first and last name and email, its niche, its own website, and its
 *  city with the latitude and longitude chosen from a city lookup. Each
 *  Workspace has at most one Business, saved whole with every field
 *  optional. Every call requires an Active Operator; Client Viewers
 *  never read a Business.
 *
 * @remarks
 *  A save upserts the one row per Workspace under the unique index on
 *  workspace_id. The city point is stored only when a lookup result was
 *  chosen, so a typed city without a point shows no map. The runtime
 *  role never deletes a Business; clearing every field is the way to
 *  remove one.
 *
 * @see
 *  data/places-client.ts
 *  data/deals.ts
 *  CONTEXT.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import { AuthorizationError, type Actor } from "@/data/authorization";
import { canManageWorkspaces } from "@/data/workspace-authorization";

export interface BusinessRecord {
  workspaceId: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  niche: string | null;
  website: string | null;
  city: string | null;
  cityPoint: { latitude: number; longitude: number } | null;
  updatedAt: string;
}

export interface BusinessInput {
  name?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  niche?: unknown;
  website?: unknown;
  city?: unknown;
  cityPoint?: unknown;
}

export type BusinessErrorCode = "invalid_input" | "not_found";

export class BusinessError extends Error {
  constructor(public readonly code: BusinessErrorCode) {
    super(code);
    this.name = "BusinessError";
  }
}

export interface Businesses {
  find(workspaceId: string): Promise<BusinessRecord | null>;
  save(workspaceId: string, input: BusinessInput): Promise<BusinessRecord>;
}

type BusinessRow = {
  workspace_id: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  niche: string | null;
  website: string | null;
  city: string | null;
  city_latitude: number | null;
  city_longitude: number | null;
  updated_at: Date;
};

const columns = "workspace_id, name, first_name, last_name, email, niche, website, city, city_latitude, city_longitude, updated_at";

function toBusiness(row: BusinessRow): BusinessRecord {
  return {
    workspaceId: row.workspace_id,
    name: row.name,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    niche: row.niche,
    website: row.website,
    city: row.city,
    cityPoint: row.city_latitude !== null && row.city_longitude !== null ? { latitude: row.city_latitude, longitude: row.city_longitude } : null,
    updatedAt: row.updated_at.toISOString(),
  };
}

function parseText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new BusinessError("invalid_input");
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new BusinessError("invalid_input");
  return trimmed || null;
}

function parseEmail(value: unknown): string | null {
  const email = parseText(value, 200);
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BusinessError("invalid_input");
  return email;
}

/** Accepts a web address with or without its scheme and stores it as an https URL. */
export function parseWebsite(value: unknown): string | null {
  const text = parseText(value, 200);
  if (text === null) return null;
  const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new BusinessError("invalid_input");
  }
  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".") || url.username || url.password) throw new BusinessError("invalid_input");
  return url.href;
}

function parsePoint(value: unknown): { latitude: number; longitude: number } | null {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object") throw new BusinessError("invalid_input");
  const { latitude, longitude } = value as { latitude?: unknown; longitude?: unknown };
  if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new BusinessError("invalid_input");
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new BusinessError("invalid_input");
  return { latitude, longitude };
}

export function createBusinesses(pool: Pool, actor: Actor): Businesses {
  if (!canManageWorkspaces(actor)) throw new AuthorizationError(403);
  const organizationId = actor.organizationId;

  async function requireWorkspace(workspaceId: string): Promise<void> {
    const workspace = await pool.query("select 1 from workspace where organization_id = $1 and id = $2", [organizationId, workspaceId]);
    if (!workspace.rowCount) throw new BusinessError("not_found");
  }

  return {
    async find(workspaceId) {
      await requireWorkspace(workspaceId);
      const result = await pool.query<BusinessRow>(`select ${columns} from business where workspace_id = $1 and organization_id = $2`, [workspaceId, organizationId]);
      return result.rows[0] ? toBusiness(result.rows[0]) : null;
    },

    async save(workspaceId, input) {
      const name = parseText(input.name, 120);
      const firstName = parseText(input.firstName, 80);
      const lastName = parseText(input.lastName, 80);
      const email = parseEmail(input.email);
      const niche = parseText(input.niche, 80);
      const website = parseWebsite(input.website);
      const city = parseText(input.city, 160);
      const point = city === null ? null : parsePoint(input.cityPoint);
      await requireWorkspace(workspaceId);
      const result = await pool.query<BusinessRow>(
        `insert into business (id, organization_id, workspace_id, name, first_name, last_name, email, niche, website, city, city_latitude, city_longitude, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
         on conflict (workspace_id) do update set
           name = excluded.name, first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email, niche = excluded.niche,
           website = excluded.website, city = excluded.city, city_latitude = excluded.city_latitude, city_longitude = excluded.city_longitude, updated_at = now()
         returning ${columns}`,
        [randomUUID(), organizationId, workspaceId, name, firstName, lastName, email, niche, website, city, point?.latitude ?? null, point?.longitude ?? null],
      );
      return toBusiness(result.rows[0]);
    },
  };
}
