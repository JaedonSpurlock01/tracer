/**
 * -------------------------------------------------------------------------
 * @file   recording-recovery.ts
 * @brief  Re-requests processing for Recordings whose transfer stalled.
 *
 * @description
 *  Finds Recordings that are not yet fully transferred and cleaned up, have
 *  been idle for over an hour, and were created within the last 7 days, and
 *  requests processing for each again with its Recording-derived
 *  idempotency key.
 *
 * @remarks
 *  One bounded select over a partial index keeps the sweep to a single
 *  short database wake-up. The 7-day window stops a permanently broken
 *  Recording from being retried forever. Reusing the same idempotency key
 *  means an in-progress run is not duplicated, while Trigger.dev releases
 *  the key of a failed run so the request starts a new one.
 *
 * @see
 *  data/recording-processing.ts
 *  trigger/recording-recovery.ts
 *  https://trigger.dev/docs/idempotency#failed-runs-and-idempotency
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import type { RecordingProcessing } from "@/data/recording";

export async function sweepStuckRecordings(
  deps: { pool: Pool; recordingProcessing: RecordingProcessing },
  now: Date,
): Promise<{ requested: number; failed: number }> {
  const result = await deps.pool.query<{ id: string; organization_id: string }>(
    `select id, organization_id
       from recording
      where twilio_cleanup_state <> 'Deleted'
        and created_at > $1::timestamptz - interval '7 days'
        and updated_at < $1::timestamptz - interval '1 hour'
      order by created_at
      limit 100`,
    [now],
  );
  let requested = 0;
  let failed = 0;
  for (const row of result.rows) {
    try {
      await deps.recordingProcessing.request({ id: row.id, organizationId: row.organization_id, idempotencyKey: `recording-processing:${row.id}` });
      requested += 1;
    } catch {
      failed += 1;
    }
  }
  return { requested, failed };
}
