/**
 * -------------------------------------------------------------------------
 * @file   report-artifact-lifecycle.test.ts
 * @brief  Verifies the planned R2 lifecycle rules for generated report artifacts.
 *
 * @description
 *  Checks that the `report-artifacts` rule expires objects under `reports/`
 *  after 7 days and aborts their incomplete multipart uploads after 1 day,
 *  that planning keeps every other rule on the bucket, including
 *  Cloudflare's default multipart abort rule, that an identical rule
 *  already in place is reported as configured with nothing to change, and
 *  that a drifted rule of the same name is replaced in place.
 *
 * @remarks
 *  Existing rules use the shape the Cloudflare R2 lifecycle API returns.
 *
 * @see
 *  data/report-artifact-lifecycle.ts
 *  scripts/configure-report-lifecycle.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { planReportArtifactLifecycle, reportArtifactLifecycleRule, type R2LifecycleRule } from "@/data/report-artifact-lifecycle";

const defaultMultipartAbortRule: R2LifecycleRule = {
  id: "Default Multipart Abort Rule",
  enabled: true,
  conditions: { prefix: "" },
  abortMultipartUploadsTransition: { condition: { maxAge: 604800, type: "Age" } },
};

describe("Report artifact lifecycle rule", () => {
  it("adds the reports/ rule after the bucket's existing rules", () => {
    expect(reportArtifactLifecycleRule).toEqual({
      id: "report-artifacts",
      enabled: true,
      conditions: { prefix: "reports/" },
      deleteObjectsTransition: { condition: { maxAge: 7 * 86400, type: "Age" } },
      abortMultipartUploadsTransition: { condition: { maxAge: 86400, type: "Age" } },
    });
    expect(planReportArtifactLifecycle([defaultMultipartAbortRule])).toEqual({
      status: "update",
      rules: [defaultMultipartAbortRule, reportArtifactLifecycleRule],
    });
  });

  it("reports the bucket as already configured when an identical reports/ rule exists", () => {
    const applied: R2LifecycleRule = {
      id: "report-artifacts",
      enabled: true,
      conditions: { prefix: "reports/" },
      abortMultipartUploadsTransition: { condition: { type: "Age", maxAge: 86400 } },
      deleteObjectsTransition: { condition: { type: "Age", maxAge: 604800 } },
      storageClassTransitions: [],
    };

    expect(planReportArtifactLifecycle([defaultMultipartAbortRule, applied])).toEqual({ status: "already_configured" });
  });

  it("replaces a drifted rule of the same name in place and keeps every other rule", () => {
    const drifted: R2LifecycleRule = { id: "report-artifacts", enabled: true, conditions: { prefix: "reports/" }, deleteObjectsTransition: { condition: { type: "Age", maxAge: 30 * 86400 } } };
    const recordings: R2LifecycleRule = { id: "recordings-archive", enabled: false, conditions: { prefix: "organizations/" } };

    expect(planReportArtifactLifecycle([defaultMultipartAbortRule, drifted, recordings])).toEqual({
      status: "update",
      rules: [defaultMultipartAbortRule, reportArtifactLifecycleRule, recordings],
    });
  });
});
