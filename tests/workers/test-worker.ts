/**
 * -------------------------------------------------------------------------
 * @file   test-worker.ts
 * @brief  Exposes App Router handlers to Worker tests.
 *
 * @description
 *  Routes test HTTP requests to Tracer's public health handler in workerd.
 *
 * @remarks
 *  This adapter keeps production route behavior testable without a full build.
 *
 * @see
 *  app/health/route.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { GET as getHealth } from "../../app/health/route";
import { handleDatabaseSmoke } from "../../app/internal/smoke/database/route";

const testWorker = {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (path === "/health") {
      return getHealth();
    }

    if (path === "/internal/smoke/database") {
      return handleDatabaseSmoke(request, {});
    }

    return new Response(null, { status: 404 });
  },
};

export default testWorker;
