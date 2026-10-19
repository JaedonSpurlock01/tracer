/**
 * -------------------------------------------------------------------------
 * @file   report-generation.ts
 * @brief  Registers the report generation task with Trigger.dev.
 *
 * @description
 *  Builds the database and R2 dependencies from environment variables and
 *  generates one report or Calls export job's files into private R2. Once
 *  every retry is exhausted, the failure hook records the job Failed with a
 *  concise reason.
 *
 * @remarks
 *  Registration stays thin so generation is tested as an ordinary function.
 *  The Worker requests this task through the REST API with the
 *  job-derived idempotency key `report-generation:{jobId}`. The task's own
 *  queue is dedicated to report generation, and its concurrency limit keeps
 *  large reports from crowding the database and R2. Retries rerun
 *  generation safely because a rerun rewrites the same object keys and a
 *  Completed job is left as it is.
 *
 * @see
 *  data/report-generation.ts
 *  data/report-jobs.ts
 *  trigger.config.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { task } from "@trigger.dev/sdk";

import { createR2RecordingObjects } from "@/data/r2-objects";
import { generateReportJob, recordReportGenerationFailure } from "@/data/report-generation";
import { reportGenerationTaskId } from "@/data/report-jobs";
import { requiredEnvironment, taskPool } from "@/trigger/environment";

export const reportGeneration = task({
  id: reportGenerationTaskId,
  concurrency: { total: 2 },
  run: async (payload: { jobId: string }) => {
    const pool = taskPool();
    try {
      await generateReportJob(
        {
          pool,
          objects: createR2RecordingObjects({
            accountId: requiredEnvironment("R2_ACCOUNT_ID"),
            accessKeyId: requiredEnvironment("R2_ACCESS_KEY_ID"),
            secretAccessKey: requiredEnvironment("R2_SECRET_ACCESS_KEY"),
            bucket: requiredEnvironment("R2_BUCKET"),
          }),
          now: () => new Date(),
        },
        payload.jobId,
      );
    } finally {
      await pool.end();
    }
  },
  onFailure: async ({ payload, error }) => {
    const pool = taskPool();
    try {
      await recordReportGenerationFailure(pool, payload.jobId, error);
    } finally {
      await pool.end();
    }
  },
});
