/**
 * -------------------------------------------------------------------------
 * @file   trigger-report-generation.test.ts
 * @brief  Verifies the Trigger.dev report generation request contract.
 *
 * @description
 *  Checks that a report generation request triggers the report generation
 *  task through the Trigger.dev REST API with the exact URL, authorization,
 *  payload, job-derived idempotency key, and queue TTL, and that a failure
 *  rejects without exposing the secret key.
 *
 * @remarks
 *  The job id and secret key are synthetic test data, and the response
 *  reuses the Trigger.dev trigger fixture.
 *
 * @see
 *  data/report-jobs.ts
 *  data/recording-processing.ts
 *  https://trigger.dev/docs/management/tasks/trigger
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it, vi } from "vitest";

import { createTriggerReportGeneration } from "@/data/report-jobs";

import fixture from "./fixtures/trigger/trigger-task.json";

const secretKey = "tr_dev_synthetic-secret-key";
const jobId = "5c0e9d2a-7b41-4f6e-a3d8-91f2c47b6e05";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Trigger.dev report generation", () => {
  it("triggers one report generation run with the job id, its job-derived idempotency key, and a 7-day queue TTL", async () => {
    const fetch = vi.fn().mockResolvedValue(response(fixture.response));
    const generation = createTriggerReportGeneration({ secretKey, fetch, baseUrl: "https://trigger.test" });

    await generation.request({ id: jobId });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://trigger.test/api/v1/tasks/report-generation/trigger");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: `Bearer ${secretKey}`, "content-type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ payload: { jobId }, options: { idempotencyKey: `report-generation:${jobId}`, ttl: "7d" } });
  });

  it("rejects a non-success response without exposing the secret key", async () => {
    const fetch = vi.fn().mockResolvedValue(response(fixture.unauthorized, 401));
    const generation = createTriggerReportGeneration({ secretKey, fetch, baseUrl: "https://trigger.test" });

    const error = await generation.request({ id: jobId }).catch((value: unknown) => value);

    expect((error as Error).message).toBe("Trigger.dev request failed (HTTP 401)");
    expect((error as Error).message).not.toContain(secretKey);
  });
});
