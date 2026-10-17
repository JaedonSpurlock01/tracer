/**
 * -------------------------------------------------------------------------
 * @file   trigger-recording-processing.test.ts
 * @brief  Verifies the Trigger.dev Recording processing request contract.
 *
 * @description
 *  Checks that a Recording processing request triggers the Recording
 *  transfer task through the Trigger.dev REST API with the exact URL,
 *  authorization, payload, and idempotency key, and that failures reject
 *  without exposing the secret key.
 *
 * @remarks
 *  Fixture identifiers and the secret key are synthetic test data.
 *
 * @see
 *  data/recording-processing.ts
 *  https://trigger.dev/docs/management/tasks/trigger
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it, vi } from "vitest";

import { createTriggerRecordingProcessing } from "@/data/recording-processing";

import fixture from "./fixtures/trigger/trigger-task.json";

const secretKey = "tr_dev_synthetic-secret-key";
const recordingId = fixture.request.payload.recordingId;
const recording = { id: recordingId, organizationId: "organization-1", idempotencyKey: fixture.request.options.idempotencyKey };

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Trigger.dev Recording processing", () => {
  it("triggers one Recording transfer run with the Recording id, its idempotency key, and a 7-day queue TTL", async () => {
    const fetch = vi.fn().mockResolvedValue(response(fixture.response));
    const processing = createTriggerRecordingProcessing({ secretKey, fetch, baseUrl: "https://trigger.test" });

    await processing.request(recording);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://trigger.test/api/v1/tasks/${fixture.taskIdentifier}/trigger`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: `Bearer ${secretKey}`, "content-type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual(fixture.request);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects a non-success response without exposing the secret key", async () => {
    const fetch = vi.fn().mockResolvedValue(response(fixture.unauthorized, 401));
    const processing = createTriggerRecordingProcessing({ secretKey, fetch, baseUrl: "https://trigger.test" });

    const error = await processing.request(recording).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Trigger.dev request failed (HTTP 401)");
    expect((error as Error).message).not.toContain(secretKey);
  });

  it("rejects when Trigger.dev does not answer before the timeout", async () => {
    const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    }));
    const processing = createTriggerRecordingProcessing({ secretKey, fetch, baseUrl: "https://trigger.test", timeoutMs: 10 });

    const error = await processing.request(recording).catch((value: unknown) => value);

    expect((error as Error).message).toBe("Trigger.dev is unavailable");
    expect((error as Error).message).not.toContain(secretKey);
  });

  it("leaves the Recording Pending without calling Trigger.dev when no secret key is configured", async () => {
    const fetch = vi.fn();
    const processing = createTriggerRecordingProcessing({ secretKey: undefined, fetch });

    await expect(processing.request(recording)).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
