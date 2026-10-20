/**
 * -------------------------------------------------------------------------
 * @file   recording-recovery.ts
 * @brief  Re-requests processing for Recordings whose transfer, waveform, Transcript, Lead Assessment, or MP3 stalled.
 *
 * @description
 *  Finds Recordings that have been idle for over an hour and were created
 *  within the last 7 days, and either are not yet fully transferred and
 *  cleaned up, or are transferred with a waveform that is not Stored, a
 *  Transcript that is Pending or Failed, or a Lead Assessment that is
 *  Pending or Failed. It requests processing for the first and each
 *  stalled stage for the rest, each with its Recording-derived idempotency
 *  key. It also backfills the MP3 for any idle Stored Recording of any age
 *  whose media has not expired and whose MP3 is Pending, and retries a
 *  Failed MP3 within the same 7 days. A Recording whose media expired or
 *  was purged is never selected for any stage.
 *
 * @remarks
 *  One bounded select over five partial indexes keeps the sweep to a single
 *  short database wake-up. An unfinished transfer gets only a processing
 *  request, because the transfer run requests waveform generation and
 *  transcription itself once the Recording is Stored. A Transcript can be
 *  Pending only once the Recording is Stored, and a Lead Assessment only
 *  once the Transcript is Completed, so the stage states alone select the
 *  right requests. The 7-day window stops a permanently broken Recording
 *  from being retried forever, and keeps the sweep far inside the 12-month
 *  media expiry. The MP3 is exempt from the window while Pending so
 *  Recordings Stored before MP3 derivation existed are backfilled, up to
 *  100 Recordings a sweep; a Recording past the window gets only its MP3
 *  request, and an MP3 that then fails is left Failed rather than retried
 *  every sweep until media expiry. Reusing the same idempotency key means an in-progress run
 *  is not duplicated, while Trigger.dev releases the key of a failed run so
 *  the request starts a new one.
 *
 * @see
 *  data/recording-processing.ts
 *  data/recording-media.ts
 *  trigger/recording-recovery.ts
 *  https://trigger.dev/docs/idempotency#failed-runs-and-idempotency
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import type { RecordingProcessing } from "@/data/recording";
import { recordingMediaRetainedSql } from "@/data/recording-media";

const recentSql = "(r.created_at > $1::timestamptz - interval '7 days')";

const mp3UnfinishedSql = `(r.transfer_state = 'Stored'
             and (r.mp3_state = 'Pending' or (r.mp3_state = 'Failed' and ${recentSql})))`;

type StalledRecording = {
  id: string;
  organization_id: string;
  transfer_unfinished: boolean;
  waveform_unfinished: boolean;
  transcript_unfinished: boolean;
  lead_assessment_unfinished: boolean;
  mp3_unfinished: boolean;
};

export async function sweepStuckRecordings(
  deps: {
    pool: Pool;
    recordingProcessing: RecordingProcessing;
    recordingWaveform: RecordingProcessing;
    recordingTranscription: RecordingProcessing;
    recordingLeadAssessment: RecordingProcessing;
    recordingMp3: RecordingProcessing;
  },
  now: Date,
): Promise<{ requested: number; failed: number }> {
  const result = await deps.pool.query<StalledRecording>(
    `select r.id, r.organization_id,
            ${recentSql} and r.twilio_cleanup_state <> 'Deleted' as transfer_unfinished,
            ${recentSql} and r.waveform_state <> 'Stored' as waveform_unfinished,
            ${recentSql} and coalesce(r.transcript_state in ('Pending', 'Failed'), false) as transcript_unfinished,
            ${recentSql} and coalesce(r.lead_assessment_state in ('Pending', 'Failed'), false) as lead_assessment_unfinished,
            ${mp3UnfinishedSql} as mp3_unfinished
       from recording r
       join call c on c.id = r.call_id
      where ((${recentSql}
              and (r.twilio_cleanup_state <> 'Deleted'
                   or r.waveform_state <> 'Stored'
                   or r.transcript_state in ('Pending', 'Failed')
                   or r.lead_assessment_state in ('Pending', 'Failed')))
             or ${mp3UnfinishedSql})
        and ${recordingMediaRetainedSql("r", "c.started_at", "$1::timestamptz")}
        and r.updated_at < $1::timestamptz - interval '1 hour'
      order by r.created_at
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
    if (row.mp3_unfinished) await request(deps.recordingMp3, row, "recording-mp3");
  }
  return { requested, failed };
}
