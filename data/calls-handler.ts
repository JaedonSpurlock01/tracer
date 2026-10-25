/**
 * -------------------------------------------------------------------------
 * @file   calls-handler.ts
 * @brief  Exposes the authenticated Calls list HTTP route.
 *
 * @description
 *  Resolves an Active actor and answers one page of global Calls, or of one
 *  Workspace's Calls when `workspaceId` is given, using the page,
 *  allow-listed sort, search, and filters from the request URL.
 *
 * @remarks
 *  An ungranted, missing, or other-Organization Workspace answers the same
 *  Not Found as Call Detail. Responses are private and never cached, since
 *  they depend on the actor's current Access Grants.
 *
 * @see
 *  data/calls.ts
 *  data/call-list-query.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import { AuthorizationError, requireActiveActor } from "@/data/authorization";
import { callListQueryFromSearchParams } from "@/data/call-list-query";
import { createCallList } from "@/data/calls";
import type { TracerAuth } from "@/data/tracer-auth";

export interface CallsHandlerOptions {
  auth: TracerAuth;
  pool: Pool;
}

const privateHeaders = { "cache-control": "private, no-store" };

export function createCallsHandler(options: CallsHandlerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const actor = await requireActiveActor(options.auth, options.pool, request.headers);
      const params = new URL(request.url).searchParams;
      const result = await createCallList(options.pool, actor).list({ ...callListQueryFromSearchParams(params), workspaceId: params.get("workspaceId") ?? undefined });
      if (!result) return Response.json({ error: "not_found" }, { status: 404, headers: privateHeaders });
      return Response.json(result, { headers: privateHeaders });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return Response.json({ error: error.status === 401 ? "unauthenticated" : "forbidden" }, { status: error.status, headers: privateHeaders });
      }
      throw error;
    }
  };
}
