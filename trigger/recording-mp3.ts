/**
 * -------------------------------------------------------------------------
 * @file   recording-mp3.ts
 * @brief  Registers the Recording MP3 task with Trigger.dev.
 *
 * @description
 *  Builds the database, R2, and ffmpeg dependencies from environment
 *  variables and derives one Stored Recording's downloadable MP3 into R2.
 *
 * @remarks
 *  Registration stays thin so the MP3 behavior is tested as an ordinary
 *  function. The task runs on its own default task queue, and its
 *  concurrency limit bounds R2 and database load while the recovery sweep backfills
 *  Recordings Stored before MP3 derivation existed. The transfer task and
 *  the recovery sweep request this task through the REST API with a
 *  Recording-derived idempotency key. The ffmpeg CLI comes from the ffmpeg
 *  build extension in deployed images, which also sets FFMPEG_PATH; the
 *  local Dev runner needs ffmpeg installed on its PATH.
 *
 * @see
 *  data/recording-mp3.ts
 *  data/ffmpeg.ts
 *  trigger.config.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { task } from "@trigger.dev/sdk";

import { createFfmpegMp3Encoder } from "@/data/ffmpeg";
import { createR2RecordingObjects } from "@/data/r2-objects";
import { recordingMp3TaskId } from "@/data/recording-processing";
import { generateRecordingMp3 } from "@/data/recording-mp3";
import { requiredEnvironment, taskDatabase } from "@/trigger/environment";

export const recordingMp3 = task({
  id: recordingMp3TaskId,
  concurrency: { total: 5 },
  run: async (payload: { recordingId: string }) => {
    const database = taskDatabase();
    try {
      await generateRecordingMp3(
        {
          database,
          objects: createR2RecordingObjects({
            accountId: requiredEnvironment("R2_ACCOUNT_ID"),
            accessKeyId: requiredEnvironment("R2_ACCESS_KEY_ID"),
            secretAccessKey: requiredEnvironment("R2_SECRET_ACCESS_KEY"),
            bucket: requiredEnvironment("R2_BUCKET"),
          }),
          encoder: createFfmpegMp3Encoder({ command: process.env.FFMPEG_PATH }),
          now: () => new Date(),
        },
        payload.recordingId,
      );
    } finally {
      await database.close();
    }
  },
});
