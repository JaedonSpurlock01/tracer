/**
 * -------------------------------------------------------------------------
 * @file   workspaces-handler.ts
 * @brief  Exposes authenticated Workspace HTTP routes.
 *
 * @description
 *  Resolves Active Operators and maps Workspace and routing requests to their
 *  Organization-scoped services.
 *
 * @remarks
 *  Routing mutations remain in workspace-routing.ts rather than the Workspace
 *  lifecycle repository.
 *
 * @see
 *  data/workspace-routing.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import { AuthorizationError, requireActiveOperator } from "@/data/authorization";
import type { Integrations } from "@/data/integrations";
import { createWorkspaceRouting, RoutingError, type RoutingSettingsInput } from "@/data/workspace-routing";
import { createWorkspaces, WorkspacesError, type Workspaces } from "@/data/workspaces";
import type { TwilioClient } from "@/data/twilio-client";
import { schema } from "@/data/schema";
import type { TracerAuth } from "@/data/tracer-auth";
import { workspaceStates, type WorkspaceState } from "@/data/workspace-policy";

export interface WorkspacesHandlerOptions {
  auth: TracerAuth;
  database: NodePgDatabase<typeof schema>;
  pool: Pool;
  twilio: TwilioClient;
  integrations: (organizationId: string) => Integrations;
  baseURL: string;
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
  if (error instanceof RoutingError) {
    const status =
      error.code === "invalid_input"
        ? 400
        : error.code === "not_found"
          ? 404
          : error.code === "draft_invalid"
            ? 422
            : error.code === "provider_unavailable"
              ? 502
              : 409;
    const body: Record<string, unknown> = { error: error.code };
    if (error.issues) body.issues = error.issues;
    if (error.detail) body.detail = error.detail;
    return response(body, status);
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

function routingInput(body: Record<string, unknown>): RoutingSettingsInput {
  if (
    typeof body.destinationNumber !== "string" ||
    typeof body.recordingEnabled !== "boolean" ||
    typeof body.analysisEnabled !== "boolean" ||
    typeof body.spamGateEnabled !== "boolean" ||
    typeof body.whisperEnabled !== "boolean" ||
    (body.whisperMessage !== null && typeof body.whisperMessage !== "string") ||
    (body.disclosureVoice !== undefined && typeof body.disclosureVoice !== "string")
  ) {
    throw new RoutingError("invalid_input");
  }
  return {
    destinationNumber: body.destinationNumber,
    recordingEnabled: body.recordingEnabled,
    analysisEnabled: body.analysisEnabled,
    spamGateEnabled: body.spamGateEnabled,
    whisperEnabled: body.whisperEnabled,
    whisperMessage: body.whisperMessage,
    disclosureVoice: body.disclosureVoice as RoutingSettingsInput["disclosureVoice"],
  };
}

export function createWorkspacesHandler(options: WorkspacesHandlerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const actor = await requireActiveOperator(options.auth, options.database, request.headers);
      const workspaces: Workspaces = createWorkspaces(options.pool, actor.organizationId);
      const routing = createWorkspaceRouting({
        pool: options.pool,
        organizationId: actor.organizationId,
        twilio: options.twilio,
        integrations: options.integrations(actor.organizationId),
        workspaces,
        baseURL: options.baseURL,
      });
      const route = new URL(request.url).pathname.replace(/^\/api\/workspaces\/?/, "");
      if (request.method === "GET" && route === "") {
        const url = new URL(request.url);
        const state = url.searchParams.get("state") ?? "All";
        if (state !== "All" && !workspaceStates.includes(state as WorkspaceState)) throw new WorkspacesError("invalid_input");
        return response(
          await workspaces.list({
            search: url.searchParams.get("search") ?? undefined,
            state: state as WorkspaceState | "All",
            page: parsePositiveInteger(url.searchParams.get("page")),
            pageSize: parsePositiveInteger(url.searchParams.get("pageSize")),
          }),
        );
      }
      if (request.method === "POST" && route === "") {
        const body = await readBody(request);
        if (typeof body.name !== "string" || typeof body.reportingTimezone !== "string") throw new WorkspacesError("invalid_input");
        return response(
          { workspace: await workspaces.create({ name: body.name, reportingTimezone: body.reportingTimezone, actorUserId: actor.userId }) },
          201,
        );
      }
      if (request.method === "GET" && route === "numbers") return response({ numbers: await routing.listAvailableNumbers() });
      const match = route.match(/^([^/]+)(?:\/(.*))?$/);
      if (!match) return response({ error: "not_found" }, 404);
      const id = match[1];
      const subroute = match[2] ?? "";
      if (request.method === "GET" && subroute === "flow") return response(await routing.getFlow(id));
      if (request.method === "PUT" && subroute === "flow") {
        const body = await readBody(request);
        if (!("graph" in body)) throw new RoutingError("invalid_input");
        return response(await routing.saveDraft(id, body.graph, actor.userId));
      }
      if (request.method === "DELETE" && subroute === "flow") {
        await routing.discardDraft(id);
        return new Response(null, { status: 204 });
      }
      if (request.method === "PATCH" && subroute === "routing") {
        return response({ workspace: await routing.updateRoutingSettings(id, routingInput(await readBody(request)), actor.userId) });
      }
      if (request.method === "POST" && subroute === "flow/publish") return response({ workspace: await routing.publish(id, actor.userId) });
      const versionMatch = subroute.match(/^flow\/versions\/(\d+)$/);
      if (request.method === "GET" && versionMatch) return response(await routing.getVersion(id, Number(versionMatch[1])));
      if (request.method === "POST" && subroute === "activate") {
        const body = await readBody(request);
        if (typeof body.twilioNumberId !== "string") throw new RoutingError("invalid_input");
        return response({ workspace: await routing.activate(id, { twilioNumberId: body.twilioNumberId, actorUserId: actor.userId }) });
      }
      if (request.method === "GET" && subroute === "") {
        const workspace = await workspaces.find(id);
        if (!workspace) throw new WorkspacesError("not_found");
        return response({ workspace });
      }
      if (request.method === "PATCH" && subroute === "") {
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
      if (request.method === "POST" && subroute === "archive") return response({ workspace: await routing.archive(id) });
      if (request.method === "POST" && subroute === "restore") return response({ workspace: await workspaces.restore(id) });
      return response({ error: "not_found" }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
