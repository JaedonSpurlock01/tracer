/**
 * -------------------------------------------------------------------------
 * @file   report-lifecycle.ts
 * @brief  Schedules the report job lifecycle sweep with Trigger.dev.
 *
 * @description
 *  Every 6 hours, records report and Calls export jobs stuck Queued or
 *  Generating for over 6 hours Failed, and deletes up to 100 jobs whose
 *  90-day metadata retention has ended, with their artifacts and any R2
 *  objects the lifecycle rule left behind.
 *
 * @remarks
 *  Registration stays thin so the sweep is tested as an ordinary function.
 *  A 6-hour cadence keeps the sweep to four short database wake-ups a day,
 *  so a stuck job is marked Failed between 6 and 12 hours after its
 *  request. It uses the same bucket-scoped R2 token as report generation,
 *  whose Object Write permission covers deletes.
 *
 * @see
 *  data/report-lifecycle.ts
 *  trigger/recording-recovery.ts
 *  https://trigger.dev/docs/tasks/scheduled
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { schedules } from "@trigger.dev/sdk";

import { createR2RecordingObjects } from "@/data/r2-objects";
import { sweepReportJobs } from "@/data/report-lifecycle";
import { requiredEnvironment, taskPool } from "@/trigger/environment";

export const reportLifecycle = schedules.task({
  id: "report-lifecycle-sweep",
  cron: "41 */6 * * *",
  run: async (payload) => {
    const pool = taskPool();
    try {
      return await sweepReportJobs(
        {
          pool,
          objects: createR2RecordingObjects({
            accountId: requiredEnvironment("R2_ACCOUNT_ID"),
            accessKeyId: requiredEnvironment("R2_ACCESS_KEY_ID"),
            secretAccessKey: requiredEnvironment("R2_SECRET_ACCESS_KEY"),
            bucket: requiredEnvironment("R2_BUCKET"),
          }),
        },
        payload.timestamp,
      );
    } finally {
      await pool.end();
    }
  },
});
