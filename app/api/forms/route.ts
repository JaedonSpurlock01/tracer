/**
 * -------------------------------------------------------------------------
 * @file   route.ts
 * @brief  Mounts the public Form Submission endpoint for linked Sites.
 *
 * @description
 *  Creates the request-scoped forms handler that stores and forwards a
 *  Site's contact form submission.
 *
 * @remarks
 *  This endpoint carries no session; the handler authenticates every
 *  request with the Site's Form key instead.
 *
 * @see
 *  data/forms-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createFormsHandler } from "@/data/forms-handler";
import { withTracerRuntime } from "@/data/tracer-runtime";

async function handle(request: Request): Promise<Response> {
  return withTracerRuntime((runtime) => createFormsHandler({ pool: runtime.pool, email: runtime.email })(request));
}

export const POST = handle;
