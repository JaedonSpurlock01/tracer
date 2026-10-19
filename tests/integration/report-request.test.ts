/**
 * -------------------------------------------------------------------------
 * @file   report-request.test.ts
 * @brief  Verifies which Workspaces and timezone a requested report covers.
 *
 * @description
 *  Checks that a global report request covers only Workspaces the actor
 *  reads, rejecting the whole request when any selected Workspace is not
 *  readable or the selection is empty, that a Workspace report request is
 *  fixed to its Workspace, and that the report timezone is the Workspace
 *  reporting timezone for one Workspace and the selected document
 *  timezone, defaulting to the requester's account timezone, for several.
 *
 * @remarks
 *  Workspaces and Access Grants are seeded directly, and actors are built
 *  directly, because readability comes from the readable Workspace helper
 *  over the database; session resolution has its own suites.
 *
 * @see
 *  data/report-request.ts
 *  data/workspace-authorization.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/data/authorization";
import { migrateDatabase } from "@/data/migrate";
import { ReportRequestError, resolveReportScope, type ReportScopeRequest } from "@/data/report-request";
import { createReadableWorkspaces } from "@/data/workspace-authorization";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;

function actor(input: { userId: string; role: Actor["role"]; timezone: string }): Actor {
  return { ...input, organizationId: "fleet", name: input.userId, email: `${input.userId}@example.com`, state: "Active" };
}

const operator = actor({ userId: "fleet-operator", role: "Operator", timezone: "America/Chicago" });
const viewer = actor({ userId: "fleet-viewer", role: "Client Viewer", timezone: "Europe/Berlin" });

const scope = (who: Actor, request: ReportScopeRequest) => resolveReportScope(createReadableWorkspaces(pool!, who), who, request);

async function seedWorkspace(id: string, name: string, timezone: string): Promise<void> {
  await pool!.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, created_at, updated_at) values ($1, 'fleet', $2, $3, 'Active', now(), now())`,
    [id, name, timezone],
  );
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrateDatabase(container.getConnectionUri());
  await pool.query("insert into organization (id, name, slug, created_at) values ('fleet', 'fleet', 'fleet', now())");
  await seedWorkspace("north", "North Plumbing", "America/New_York");
  await seedWorkspace("south", "South Roofing", "Asia/Tokyo");
  await seedWorkspace("west", "West Electric", "America/Los_Angeles");
  await pool.query(
    `insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at) values ('fleet-viewer', 'fleet-viewer', 'fleet-viewer@example.com', true, 'Active', 'Europe/Berlin', now(), now())`,
  );
  for (const workspaceId of ["north", "south"]) {
    await pool.query("insert into access_grant (id, organization_id, workspace_id, user_id, created_at) values ($1, 'fleet', $2, 'fleet-viewer', now())", [`grant-${workspaceId}`, workspaceId]);
  }
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe("Report scope", () => {
  it("rejects the whole request when any selected Workspace is ungranted or unknown", async () => {
    await expect(scope(viewer, { kind: "global", workspaceIds: ["north", "west"] })).rejects.toEqual(new ReportRequestError("workspace_unavailable"));
    await expect(scope(viewer, { kind: "workspace", workspaceId: "west" })).rejects.toEqual(new ReportRequestError("workspace_unavailable"));
    await expect(scope(operator, { kind: "global", workspaceIds: ["north", "missing"] })).rejects.toEqual(new ReportRequestError("workspace_unavailable"));
  });

  it("rejects an empty Workspace selection", async () => {
    await expect(scope(operator, { kind: "global", workspaceIds: [] })).rejects.toEqual(new ReportRequestError("empty_scope"));
  });

  it("uses the Workspace reporting timezone for a single-Workspace scope", async () => {
    expect(await scope(viewer, { kind: "workspace", workspaceId: "south" })).toEqual({ workspaces: [{ id: "south", name: "South Roofing" }], timeZone: "Asia/Tokyo" });
    expect(await scope(viewer, { kind: "global", workspaceIds: ["north"] })).toEqual({ workspaces: [{ id: "north", name: "North Plumbing" }], timeZone: "America/New_York" });
  });

  it("uses the selected document timezone for a multi-Workspace scope and defaults to the requester's account timezone", async () => {
    const workspaces = [{ id: "north", name: "North Plumbing" }, { id: "south", name: "South Roofing" }];
    expect(await scope(viewer, { kind: "global", workspaceIds: ["north", "south"], timeZone: "America/Denver" })).toEqual({ workspaces, timeZone: "America/Denver" });
    expect(await scope(viewer, { kind: "global", workspaceIds: ["north", "south"] })).toEqual({ workspaces, timeZone: "Europe/Berlin" });
  });

  it("deduplicates repeated Workspace ids so a repeated single Workspace keeps its reporting timezone", async () => {
    expect(await scope(operator, { kind: "global", workspaceIds: ["south", "south"], timeZone: "America/Denver" })).toEqual({ workspaces: [{ id: "south", name: "South Roofing" }], timeZone: "Asia/Tokyo" });
    expect((await scope(operator, { kind: "global", workspaceIds: ["west", "north", "west"] })).workspaces).toEqual([{ id: "west", name: "West Electric" }, { id: "north", name: "North Plumbing" }]);
  });

  it("rejects a document timezone that is not an IANA timezone", async () => {
    await expect(scope(viewer, { kind: "global", workspaceIds: ["north", "south"], timeZone: "Mars/Olympus" })).rejects.toEqual(new ReportRequestError("invalid_timezone"));
  });
});
