/**
 * -------------------------------------------------------------------------
 * @file   route.ts
 * @brief  Mounts the authenticated Operator administration endpoints.
 *
 * @description
 *  Creates the request-scoped administration handler for Organization user
 *  listing, provisioning, state changes, and access delivery.
 *
 * @remarks
 *  Authorization and database resources are resolved per request.
 *
 * @see
 *  data/operator-administration-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createOperatorAdministrationHandler } from "@/data/operator-administration-handler";
import { withTracerRuntime } from "@/data/tracer-runtime";

async function handle(request: Request): Promise<Response> {
  return withTracerRuntime((runtime) => createOperatorAdministrationHandler({
    ...runtime,
    signInUrl: new URL("/sign-in", runtime.baseURL).toString(),
  })(request));
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
