/**
 * -------------------------------------------------------------------------
 * @file   recording-recovery.ts
 * @brief  Re-requests processing for Recordings whose transfer or waveform stalled.
 *
 * @description
 *  Finds Recordings that have been idle for over an hour and were created
 *  within the last 7 days, and either are not yet fully transferred and
 *  cleaned up or are transferred without Stored waveform peaks. It requests
 *  processing for the first and waveform generation for the second, each
 *  with its Recording-derived idempotency key.
 *
 * @remarks
 *  One bounded select over two partial indexes keeps the sweep to a single
 *  short database wake-up. An unfinished transfer gets only a processing
 *  request, because the transfer run requests waveform generation itself
 *  once the Recording is Stored. The 7-day window stops a permanently broken
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
  deps: { pool: Pool; recordingProcessing: RecordingProcessing; recordingWaveform: RecordingProcessing },
  now: Date,
): Promise<{ requested: number; failed: number }> {
  const result = await deps.pool.query<{ id: string; organization_id: string; transfer_unfinished: boolean }>(
    `select id, organization_id, twilio_cleanup_state <> 'Deleted' as transfer_unfinished
       from recording
      where (twilio_cleanup_state <> 'Deleted' or waveform_state <> 'Stored')
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
      if (row.transfer_unfinished) {
        await deps.recordingProcessing.request({ id: row.id, organizationId: row.organization_id, idempotencyKey: `recording-processing:${row.id}` });
      } else {
        await deps.recordingWaveform.request({ id: row.id, organizationId: row.organization_id, idempotencyKey: `recording-waveform:${row.id}` });
      }
      requested += 1;
    } catch {
      failed += 1;
    }
  }
  return { requested, failed };
}
