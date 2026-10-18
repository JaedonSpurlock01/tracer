/**
 * -------------------------------------------------------------------------
 * @file   route.ts
 * @brief  Mounts the authenticated Activity endpoint.
 *
 * @description
 *  Creates a request-scoped Activity handler with Tracer runtime resources.
 *
 * @remarks
 *  Activity is read-only, so only GET is exported.
 *
 * @see
 *  data/activity-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createActivityHandler } from "@/data/activity-handler";
import { withTracerRuntime } from "@/data/tracer-runtime";

export async function GET(request: Request): Promise<Response> {
  return withTracerRuntime((runtime) => createActivityHandler(runtime)(request));
}
