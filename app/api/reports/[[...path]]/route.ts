/**
 * -------------------------------------------------------------------------
 * @file   route.ts
 * @brief  Mounts the authenticated Reports and Calls export endpoints.
 *
 * @description
 *  Creates a request-scoped Reports handler with Tracer runtime resources:
 *  the pool, the private R2 bucket that holds generated artifacts, and the
 *  Trigger.dev report generation request when it is configured.
 *
 * @remarks
 *  Report artifacts share the Recording R2 binding, since generation
 *  writes them to the same private bucket under their own prefix.
 *
 * @see
 *  data/reports-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createReportsHandler } from "@/data/reports-handler";
import { withTracerRuntime } from "@/data/tracer-runtime";

async function handle(request: Request): Promise<Response> {
  return withTracerRuntime((runtime) =>
    createReportsHandler({
      auth: runtime.auth,
      database: runtime.database,
      pool: runtime.pool,
      reportBucket: runtime.recordingBucket,
      reportGeneration: runtime.reportGeneration,
    })(request),
  );
}

export const GET = handle;
export const POST = handle;
