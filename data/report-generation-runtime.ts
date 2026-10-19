/**
 * -------------------------------------------------------------------------
 * @file   report-generation-runtime.ts
 * @brief  Selects the runtime report generation provider boundary.
 *
 * @description
 *  Uses the accepting E2E fake only when explicitly enabled outside
 *  production; otherwise requests Trigger.dev runs when a secret key is
 *  set, and offers no generation without one.
 *
 * @remarks
 *  Production cannot select the fake even if an environment flag is
 *  accidentally present.
 *
 * @see
 *  data/e2e-trigger-fake.ts
 *  data/report-jobs.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createE2eReportGeneration } from "@/data/e2e-trigger-fake";
import { createTriggerReportGeneration, type ReportGeneration } from "@/data/report-jobs";

export function createRuntimeReportGeneration(triggerSecretKey: string | undefined): ReportGeneration | undefined {
  if (process.env.E2E_TRIGGER_FAKE === "true" && process.env.NODE_ENV !== "production") return createE2eReportGeneration();
  return triggerSecretKey ? createTriggerReportGeneration({ secretKey: triggerSecretKey }) : undefined;
}
