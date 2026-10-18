/**
 * -------------------------------------------------------------------------
 * @file   route.ts
 * @brief  Mounts the authenticated Calls list endpoint.
 *
 * @description
 *  Creates a request-scoped Calls handler with Tracer runtime resources.
 *
 * @remarks
 *  The Calls list is read-only, so only GET is exported.
 *
 * @see
 *  data/calls-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createCallsHandler } from "@/data/calls-handler";
import { withTracerRuntime } from "@/data/tracer-runtime";

export async function GET(request: Request): Promise<Response> {
  return withTracerRuntime((runtime) => createCallsHandler(runtime)(request));
}
