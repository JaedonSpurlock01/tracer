/**
 * -------------------------------------------------------------------------
 * @file   media-retention.ts
 * @brief  Schedules the Recording media expiry sweep with Trigger.dev.
 *
 * @description
 *  Once a day, deletes the Transcript, Lead Assessment evidence quotes and
 *  rationale, WAV, waveform peaks, and MP3 objects, and the Twilio copy of
 *  up to 100 Recordings whose media expired 12 months after their Call
 *  started or was purged by an Operator, and returns how many were
 *  selected, completed, and failed.
 *
 * @remarks
 *  Registration stays thin so the sweep is tested as an ordinary function.
 *  Expiry is measured in months, so a daily cadence removes content within
 *  a day of expiry with one short database wake-up, and a Recording whose
 *  cleanup failed is retried the next day. The minute is offset from the
 *  other sweeps. It uses the same bucket-scoped R2 token as the Recording
 *  workflows, whose Object Write permission covers deletes, and the same
 *  Twilio credential master key and REST client as the transfer task.
 *
 * @see
 *  data/media-retention.ts
 *  trigger/report-lifecycle.ts
 *  https://trigger.dev/docs/tasks/scheduled
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { schedules } from "@trigger.dev/sdk";

import { sweepRecordingMedia } from "@/data/media-retention";
import { createR2RecordingObjects } from "@/data/r2-objects";
import { createTwilioRecordingMedia } from "@/data/twilio-client";
import { requiredEnvironment, taskPool } from "@/trigger/environment";

export const mediaRetention = schedules.task({
  id: "media-retention-sweep",
  cron: "29 8 * * *",
  run: async (payload) => {
    const pool = taskPool();
    try {
      return await sweepRecordingMedia(
        {
          pool,
          objects: createR2RecordingObjects({
            accountId: requiredEnvironment("R2_ACCOUNT_ID"),
            accessKeyId: requiredEnvironment("R2_ACCESS_KEY_ID"),
            secretAccessKey: requiredEnvironment("R2_SECRET_ACCESS_KEY"),
            bucket: requiredEnvironment("R2_BUCKET"),
          }),
          twilio: createTwilioRecordingMedia(),
          masterKey: requiredEnvironment("TWILIO_CREDENTIAL_MASTER_KEY"),
        },
        payload.timestamp,
      );
    } finally {
      await pool.end();
    }
  },
});
