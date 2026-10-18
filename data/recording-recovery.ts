/**
 * -------------------------------------------------------------------------
 * @file   recording-recovery.ts
 * @brief  Re-requests processing for Recordings whose transfer, waveform, Transcript, or Lead Assessment stalled.
 *
 * @description
 *  Finds Recordings that have been idle for over an hour and were created
 *  within the last 7 days, and either are not yet fully transferred and
 *  cleaned up, or are transferred with a waveform that is not Stored, a
 *  Transcript that is Pending or Failed, or a Lead Assessment that is
 *  Pending or Failed. It requests processing for the first and each
 *  stalled stage for the rest, each with its Recording-derived idempotency
 *  key.
 *
 * @remarks
 *  One bounded select over four partial indexes keeps the sweep to a single
 *  short database wake-up. An unfinished transfer gets only a processing
 *  request, because the transfer run requests waveform generation and
 *  transcription itself once the Recording is Stored. A Transcript can be
 *  Pending only once the Recording is Stored, and a Lead Assessment only
 *  once the Transcript is Completed, so the stage states alone select the
 *  right requests. The 7-day window stops a permanently broken Recording
 *  from being retried forever, and keeps the sweep far inside the 12-month
 *  media expiry. Reusing the same idempotency key means an in-progress run
 *  is not duplicated, while Trigger.dev releases the key of a failed run so
 *  the request starts a new one.
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

type StalledRecording = {
  id: string;
  organization_id: string;
  transfer_unfinished: boolean;
  waveform_unfinished: boolean;
  transcript_unfinished: boolean;
  lead_assessment_unfinished: boolean;
};

export async function sweepStuckRecordings(
  deps: {
    pool: Pool;
    recordingProcessing: RecordingProcessing;
    recordingWaveform: RecordingProcessing;
    recordingTranscription: RecordingProcessing;
    recordingLeadAssessment: RecordingProcessing;
  },
  now: Date,
): Promise<{ requested: number; failed: number }> {
  const result = await deps.pool.query<StalledRecording>(
    `select id, organization_id,
            twilio_cleanup_state <> 'Deleted' as transfer_unfinished,
            waveform_state <> 'Stored' as waveform_unfinished,
            coalesce(transcript_state in ('Pending', 'Failed'), false) as transcript_unfinished,
            coalesce(lead_assessment_state in ('Pending', 'Failed'), false) as lead_assessment_unfinished
       from recording
      where (twilio_cleanup_state <> 'Deleted'
             or waveform_state <> 'Stored'
             or transcript_state in ('Pending', 'Failed')
             or lead_assessment_state in ('Pending', 'Failed'))
        and created_at > $1::timestamptz - interval '7 days'
        and updated_at < $1::timestamptz - interval '1 hour'
      order by created_at
      limit 100`,
    [now],
  );
  let requested = 0;
  let failed = 0;
  async function request(processing: RecordingProcessing, row: StalledRecording, keyPrefix: string): Promise<void> {
    try {
      await processing.request({ id: row.id, organizationId: row.organization_id, idempotencyKey: `${keyPrefix}:${row.id}` });
      requested += 1;
    } catch {
      failed += 1;
    }
  }
  for (const row of result.rows) {
    if (row.transfer_unfinished) {
      await request(deps.recordingProcessing, row, "recording-processing");
      continue;
    }
    if (row.waveform_unfinished) await request(deps.recordingWaveform, row, "recording-waveform");
    if (row.transcript_unfinished) await request(deps.recordingTranscription, row, "recording-transcription");
    if (row.lead_assessment_unfinished) await request(deps.recordingLeadAssessment, row, "recording-lead-assessment");
  }
  return { requested, failed };
}
