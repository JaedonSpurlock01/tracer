/**
 * -------------------------------------------------------------------------
 * @file   route.ts
 * @brief  Mounts authenticated Workspace endpoints.
 *
 * @description
 *  Creates a request-scoped Workspace handler with Tracer runtime resources.
 *
 * @remarks
 *  Workspace operations do not construct or call a Twilio client.
 *
 * @see
 *  data/workspaces-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createWorkspacesHandler } from "@/data/workspaces-handler";
import { withTracerRuntime } from "@/data/tracer-runtime";

async function handle(request: Request): Promise<Response> {
  return withTracerRuntime((runtime) => createWorkspacesHandler(runtime)(request));
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
