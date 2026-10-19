/**
 * -------------------------------------------------------------------------
 * @file   e2e-trigger-fake.ts
 * @brief  Provides the non-production E2E Trigger.dev report generation fake.
 *
 * @description
 *  Accepts a report or Calls export generation request without contacting
 *  Trigger.dev, so the job is recorded Queued exactly as after a started
 *  run. The browser journey then completes the job by running the report
 *  generation task body against the E2E database and local R2.
 *
 * @remarks
 *  Runtime selection is separately gated by E2E_TRIGGER_FAKE and production
 *  mode. The fake never renders or stores files itself, so the Worker
 *  bundle never carries the PDF renderer.
 *
 * @see
 *  data/report-generation-runtime.ts
 *  tests/e2e/report-generation.spec.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { ReportGeneration } from "@/data/report-jobs";

export function createE2eReportGeneration(): ReportGeneration {
  return {
    async request() {},
  };
}
