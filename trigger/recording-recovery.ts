/**
 * -------------------------------------------------------------------------
 * @file   recording-recovery.ts
 * @brief  Schedules the Recording recovery sweep with Trigger.dev.
 *
 * @description
 *  Every 12 hours, re-requests processing for Recordings whose transfer or
 *  Twilio cleanup stalled, and waveform generation, transcription, or the
 *  Lead Assessment for transferred Recordings whose stage stalled.
 *
 * @remarks
 *  Registration stays thin so the sweep is tested as an ordinary function.
 *  It triggers through the same REST port as the Worker so the
 *  Recording-derived idempotency key matches the original request; the SDK
 *  would scope a raw key to this run instead.
 *
 * @see
 *  data/recording-recovery.ts
 *  https://trigger.dev/docs/tasks/scheduled
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { schedules } from "@trigger.dev/sdk";

import { createTriggerRecordingProcessing, recordingLeadAssessmentTaskId, recordingTranscriptionTaskId, recordingWaveformTaskId } from "@/data/recording-processing";
import { sweepStuckRecordings } from "@/data/recording-recovery";
import { requiredEnvironment, taskPool } from "@/trigger/environment";

export const recordingRecovery = schedules.task({
  id: "recording-recovery-sweep",
  cron: "17 */12 * * *",
  run: async (payload) => {
    const pool = taskPool();
    try {
      return await sweepStuckRecordings(
        {
          pool,
          recordingProcessing: createTriggerRecordingProcessing({
            secretKey: requiredEnvironment("TRIGGER_SECRET_KEY"),
            baseUrl: process.env.TRIGGER_API_URL,
          }),
          recordingWaveform: createTriggerRecordingProcessing({
            secretKey: requiredEnvironment("TRIGGER_SECRET_KEY"),
            baseUrl: process.env.TRIGGER_API_URL,
            taskId: recordingWaveformTaskId,
          }),
          recordingTranscription: createTriggerRecordingProcessing({
            secretKey: requiredEnvironment("TRIGGER_SECRET_KEY"),
            baseUrl: process.env.TRIGGER_API_URL,
            taskId: recordingTranscriptionTaskId,
          }),
          recordingLeadAssessment: createTriggerRecordingProcessing({
            secretKey: requiredEnvironment("TRIGGER_SECRET_KEY"),
            baseUrl: process.env.TRIGGER_API_URL,
            taskId: recordingLeadAssessmentTaskId,
          }),
        },
        payload.timestamp,
      );
    } finally {
      await pool.end();
    }
  },
});
