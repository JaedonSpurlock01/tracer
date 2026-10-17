/**
 * -------------------------------------------------------------------------
 * @file   recording-waveform.ts
 * @brief  Registers the Recording waveform task with Trigger.dev.
 *
 * @description
 *  Builds the database, R2, and audiowaveform dependencies from environment
 *  variables and generates one Stored Recording's waveform peaks into R2.
 *
 * @remarks
 *  Registration stays thin so the waveform behavior is tested as an
 *  ordinary function. The transfer task and the recovery sweep request this
 *  task through the REST API with a Recording-derived idempotency key. The
 *  audiowaveform CLI comes from the Audio Waveform build extension in
 *  deployed images; the local Dev runner needs it installed on its PATH.
 *
 * @see
 *  data/recording-waveform.ts
 *  data/audiowaveform.ts
 *  trigger.config.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { task } from "@trigger.dev/sdk";

import { createAudiowaveformPeakGenerator } from "@/data/audiowaveform";
import { createR2RecordingObjects } from "@/data/r2-objects";
import { recordingWaveformTaskId } from "@/data/recording-processing";
import { generateRecordingWaveform } from "@/data/recording-waveform";
import { requiredEnvironment, taskPool } from "@/trigger/environment";

export const recordingWaveform = task({
  id: recordingWaveformTaskId,
  concurrency: { total: 5 },
  run: async (payload: { recordingId: string }) => {
    const pool = taskPool();
    try {
      await generateRecordingWaveform(
        {
          pool,
          objects: createR2RecordingObjects({
            accountId: requiredEnvironment("R2_ACCOUNT_ID"),
            accessKeyId: requiredEnvironment("R2_ACCESS_KEY_ID"),
            secretAccessKey: requiredEnvironment("R2_SECRET_ACCESS_KEY"),
            bucket: requiredEnvironment("R2_BUCKET"),
          }),
          peaks: createAudiowaveformPeakGenerator(),
          now: () => new Date(),
        },
        payload.recordingId,
      );
    } finally {
      await pool.end();
    }
  },
});
