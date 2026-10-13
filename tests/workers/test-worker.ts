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

const testWorker = {
  fetch(request: Request): Response {
    if (new URL(request.url).pathname === "/health") {
      return getHealth();
    }

    return new Response(null, { status: 404 });
  },
};

export default testWorker;
