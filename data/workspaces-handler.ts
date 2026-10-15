/**
 * -------------------------------------------------------------------------
 * @file   workspaces-handler.ts
 * @brief  Exposes authenticated Workspace HTTP routes.
 *
 * @description
 *  Resolves Active Operators and maps Workspace list, create, edit, archive,
 *  and restore requests to the Organization-scoped service.
 *
 * @remarks
 *  Provider integrations are not touched by any Workspace route.
 *
 * @see
 *  data/workspaces.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import { AuthorizationError, requireActiveOperator } from "@/data/authorization";
import { createWorkspaces, WorkspacesError, type Workspaces } from "@/data/workspaces";
import { schema } from "@/data/schema";
import type { TracerAuth } from "@/data/tracer-auth";
import { workspaceStates, type WorkspaceState } from "@/data/workspace-policy";

export interface WorkspacesHandlerOptions {
  auth: TracerAuth;
  database: NodePgDatabase<typeof schema>;
  pool: Pool;
}

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function errorResponse(error: unknown): Response {
  if (error instanceof AuthorizationError) {
    return response({ error: error.status === 401 ? "unauthenticated" : "forbidden" }, error.status);
  }
  if (error instanceof WorkspacesError) {
    const status = error.code === "invalid_input" ? 400 : error.code === "not_found" ? 404 : 409;
    return response({ error: error.code }, status);
  }
  return response({ error: "invalid_input" }, 400);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkspacesError("invalid_input");
  return body as Record<string, unknown>;
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function createWorkspacesHandler(options: WorkspacesHandlerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const actor = await requireActiveOperator(options.auth, options.database, request.headers);
      const workspaces: Workspaces = createWorkspaces(options.pool, actor.organizationId);
      const route = new URL(request.url).pathname.replace(/^\/api\/workspaces\/?/, "");
      if (request.method === "GET" && route === "") {
        const url = new URL(request.url);
        const state = url.searchParams.get("state") ?? "All";
        if (state !== "All" && !workspaceStates.includes(state as WorkspaceState)) throw new WorkspacesError("invalid_input");
        return response(await workspaces.list({
          search: url.searchParams.get("search") ?? undefined,
          state: state as WorkspaceState | "All",
          page: parsePositiveInteger(url.searchParams.get("page")),
          pageSize: parsePositiveInteger(url.searchParams.get("pageSize")),
        }));
      }
      if (request.method === "POST" && route === "") {
        const body = await readBody(request);
        if (typeof body.name !== "string" || typeof body.reportingTimezone !== "string") throw new WorkspacesError("invalid_input");
        return response({ workspace: await workspaces.create({ name: body.name, reportingTimezone: body.reportingTimezone, actorUserId: actor.userId }) }, 201);
      }
      const match = route.match(/^([^/]+)(?:\/(archive|restore))?$/);
      if (!match) return response({ error: "not_found" }, 404);
      const id = match[1];
      if (request.method === "GET" && !match[2]) {
        const workspace = await workspaces.find(id);
        if (!workspace) throw new WorkspacesError("not_found");
        return response({ workspace });
      }
      if (request.method === "PATCH" && !match[2]) {
        const body = await readBody(request);
        const input: { name?: string; reportingTimezone?: string } = {};
        if (body.name !== undefined) {
          if (typeof body.name !== "string") throw new WorkspacesError("invalid_input");
          input.name = body.name;
        }
        if (body.reportingTimezone !== undefined) {
          if (typeof body.reportingTimezone !== "string") throw new WorkspacesError("invalid_input");
          input.reportingTimezone = body.reportingTimezone;
        }
        return response({ workspace: await workspaces.update(id, input) });
      }
      if (request.method === "POST" && match[2] === "archive") return response({ workspace: await workspaces.archive(id) });
      if (request.method === "POST" && match[2] === "restore") return response({ workspace: await workspaces.restore(id) });
      return response({ error: "not_found" }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
