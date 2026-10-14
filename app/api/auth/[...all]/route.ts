/**
 * -------------------------------------------------------------------------
 * @file   route.ts
 * @brief  Mounts Better Auth's Tracer authentication endpoints.
 *
 * @description
 *  Delegates each authentication request to the request-scoped Tracer runtime.
 *
 * @remarks
 *  Runtime credentials and provider boundaries remain inside the runtime.
 *
 * @see
 *  data/tracer-runtime.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { toNextJsHandler } from "better-auth/next-js";

import { withTracerRuntime } from "@/data/tracer-runtime";

async function handle(request: Request): Promise<Response> {
  return withTracerRuntime(({ auth }) => {
    const handlers = toNextJsHandler(auth);
    switch (request.method) {
      case "GET":
        return handlers.GET(request);
      case "POST":
        return handlers.POST(request);
      case "PUT":
        return handlers.PUT(request);
      case "PATCH":
        return handlers.PATCH(request);
      case "DELETE":
        return handlers.DELETE(request);
      default:
        return Promise.resolve(new Response("Method Not Allowed", { status: 405 }));
    }
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
