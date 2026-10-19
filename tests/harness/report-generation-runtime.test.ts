/**
 * -------------------------------------------------------------------------
 * @file   report-generation-runtime.test.ts
 * @brief  Verifies the explicit E2E Trigger.dev report generation boundary.
 *
 * @description
 *  Ensures the accepting report generation fake is selected only with the
 *  E2E flag and a non-production runtime, that production with the flag
 *  still requests the Trigger.dev run, and that no generation exists
 *  without either the flag or a secret key.
 *
 * @remarks
 *  Environment state is restored after every selection check.
 *
 * @see
 *  data/report-generation-runtime.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRuntimeReportGeneration } from "@/data/report-generation-runtime";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Report generation runtime selection", () => {
  it("selects the fake only with the E2E flag outside production", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("E2E_TRIGGER_FAKE", "true");
    vi.stubEnv("NODE_ENV", "development");
    await expect(createRuntimeReportGeneration("tr_dev_secret")!.request({ id: "job-1" })).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();

    vi.stubEnv("NODE_ENV", "production");
    await expect(createRuntimeReportGeneration("tr_prod_secret")!.request({ id: "job-1" })).rejects.toThrow();
    expect(fetch).toHaveBeenCalled();
    expect(createRuntimeReportGeneration(undefined)).toBeUndefined();
  });

  it("requires a secret key without the E2E flag", () => {
    vi.stubEnv("E2E_TRIGGER_FAKE", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(createRuntimeReportGeneration(undefined)).toBeUndefined();
    expect(createRuntimeReportGeneration("tr_dev_secret")).toBeDefined();
  });
});
