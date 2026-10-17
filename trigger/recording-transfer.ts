/**
 * -------------------------------------------------------------------------
 * @file   recording-transfer.ts
 * @brief  Registers the Recording transfer task with Trigger.dev.
 *
 * @description
 *  Builds the database, Twilio media, and R2 dependencies from environment
 *  variables and moves one Recording from Twilio to R2.
 *
 * @remarks
 *  Registration stays thin so the transfer behavior is tested as an
 *  ordinary function. The concurrency limit bounds load on Twilio, R2, and
 *  the database.
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
import { recordingTransferTaskId } from "@/data/recording-processing";
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
          now: () => new Date(),
        },
        payload.recordingId,
      );
    } finally {
      await pool.end();
    }
  },
});
