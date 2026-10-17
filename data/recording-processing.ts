/**
 * -------------------------------------------------------------------------
 * @file   recording-processing.ts
 * @brief  Requests Recording processing through the Trigger.dev REST API.
 *
 * @description
 *  Triggers one Recording transfer run per Recording by posting its id and
 *  Recording-derived idempotency key to Trigger.dev. Without a secret key the
 *  request does nothing, so the Recording stays Pending for the recovery
 *  sweep. A queued run waits up to 7 days, matching the sweep window.
 *
 * @remarks
 *  The Worker calls the REST endpoint with fetch instead of importing the
 *  Trigger.dev SDK. A short timeout keeps a slow Trigger.dev from stalling
 *  Twilio's webhook response, and errors carry only the HTTP status so the
 *  secret key never reaches logs. The explicit TTL replaces the Trigger.dev
 *  Dev environment's 10-minute default, because Staging and Preview runs
 *  execute only while the local dev CLI is running.
 *
 * @see
 *  data/recording.ts
 *  trigger/recording-transfer.ts
 *  https://trigger.dev/docs/management/tasks/trigger
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { RecordingProcessing } from "@/data/recording";

export const recordingTransferTaskId = "recording-transfer";

export function createTriggerRecordingProcessing(options: {
  secretKey: string | undefined;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}): RecordingProcessing {
  const request = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? "https://api.trigger.dev").replace(/\/$/, "");
  return {
    async request(recording) {
      if (!options.secretKey) return;
      let response: Response;
      try {
        response = await request(`${baseUrl}/api/v1/tasks/${recordingTransferTaskId}/trigger`, {
          method: "POST",
          headers: { Authorization: `Bearer ${options.secretKey}`, "content-type": "application/json" },
          body: JSON.stringify({ payload: { recordingId: recording.id }, options: { idempotencyKey: recording.idempotencyKey, ttl: "7d" } }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
        });
      } catch {
        throw new Error("Trigger.dev is unavailable");
      }
      if (!response.ok) {
        throw new Error(`Trigger.dev request failed (HTTP ${response.status})`);
      }
    },
  };
}
