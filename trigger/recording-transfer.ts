/**
 * -------------------------------------------------------------------------
 * @file   recording-transfer.ts
 * @brief  Registers the Recording transfer task with Trigger.dev.
 *
 * @description
 *  Builds the database, Twilio media, R2, waveform request, transcription
 *  request, and MP3 request dependencies from environment variables and
 *  moves one Recording from Twilio to R2.
 *
 * @remarks
 *  Registration stays thin so the transfer behavior is tested as an
 *  ordinary function. The concurrency limit bounds load on Twilio, R2, and
 *  the database. Waveform generation, transcription, and MP3 derivation
 *  are requested through the same REST port as the recovery sweep so each
 *  shares one Recording-derived idempotency key; the SDK would scope a raw
 *  key to this run instead. A missing secret key skips the request rather
 *  than failing the transfer, leaving the waveform, MP3, or Transcript
 *  Pending for the sweep.
 *
 * @see
 *  data/recording-transfer.ts
 *  trigger.config.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { task } from "@trigger.dev/sdk";

import { createR2RecordingObjects } from "@/data/r2-objects";
import { createTriggerRecordingProcessing, recordingMp3TaskId, recordingTranscriptionTaskId, recordingTransferTaskId, recordingWaveformTaskId } from "@/data/recording-processing";
import { transferRecording } from "@/data/recording-transfer";
import { createTwilioRecordingMedia } from "@/data/twilio-client";
import { requiredEnvironment, taskPool } from "@/trigger/environment";

export const recordingTransfer = task({
  id: recordingTransferTaskId,
  concurrency: { total: 5 },
  run: async (payload: { recordingId: string }) => {
    const pool = taskPool();
    try {
      await transferRecording(
        {
          pool,
          masterKey: requiredEnvironment("TWILIO_CREDENTIAL_MASTER_KEY"),
          twilio: createTwilioRecordingMedia(),
          objects: createR2RecordingObjects({
            accountId: requiredEnvironment("R2_ACCOUNT_ID"),
            accessKeyId: requiredEnvironment("R2_ACCESS_KEY_ID"),
            secretAccessKey: requiredEnvironment("R2_SECRET_ACCESS_KEY"),
            bucket: requiredEnvironment("R2_BUCKET"),
          }),
          waveform: createTriggerRecordingProcessing({
            secretKey: process.env.TRIGGER_SECRET_KEY,
            baseUrl: process.env.TRIGGER_API_URL,
            taskId: recordingWaveformTaskId,
          }),
          transcription: createTriggerRecordingProcessing({
            secretKey: process.env.TRIGGER_SECRET_KEY,
            baseUrl: process.env.TRIGGER_API_URL,
            taskId: recordingTranscriptionTaskId,
          }),
          mp3: createTriggerRecordingProcessing({
            secretKey: process.env.TRIGGER_SECRET_KEY,
            baseUrl: process.env.TRIGGER_API_URL,
            taskId: recordingMp3TaskId,
          }),
          now: () => new Date(),
        },
        payload.recordingId,
      );
    } finally {
      await pool.end();
    }
  },
});
