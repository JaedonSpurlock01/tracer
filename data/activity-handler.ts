/**
 * -------------------------------------------------------------------------
 * @file   activity-handler.ts
 * @brief  Exposes the authenticated Activity HTTP route.
 *
 * @description
 *  Resolves an Active actor and answers one page of Activity entries using
 *  the Activity search and filters from the request URL, with an optional
 *  `before` cursor for Load more or `through` cursor for a refresh of the
 *  loaded window.
 *
 * @remarks
 *  Responses are private and never cached, since they depend on the actor's
 *  current Access Grants. A malformed cursor is ignored, which reads the
 *  first page.
 *
 * @see
 *  data/activity.ts
 *  data/activity-query.ts
 *  data/calls-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Database } from "@/data/database";

import { createActivity } from "@/data/activity";
import { activityFiltersFromSearchParams, parseActivityCursor } from "@/data/activity-query";
import { AuthorizationError, requireActiveActor } from "@/data/authorization";
import type { TracerAuth } from "@/data/tracer-auth";

export interface ActivityHandlerOptions {
  auth: TracerAuth;
  database: Database;
}

const privateHeaders = { "cache-control": "private, no-store" };

export function createActivityHandler(options: ActivityHandlerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const actor = await requireActiveActor(options.auth, options.database, request.headers);
      const params = new URL(request.url).searchParams;
      const result = await createActivity(options.database, actor).list({
        filters: activityFiltersFromSearchParams(params),
        before: parseActivityCursor(params.get("before")),
        through: parseActivityCursor(params.get("through")),
      });
      return Response.json(result, { headers: privateHeaders });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return Response.json({ error: error.status === 401 ? "unauthenticated" : "forbidden" }, { status: error.status, headers: privateHeaders });
      }
      throw error;
    }
  };
}
