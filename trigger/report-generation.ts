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
 *  generation safely because a rerun rewrites the same object keys, aborts
 *  a stale Recording ZIP multipart upload before restarting it, and leaves
 *  a Completed job as it is. A Recording ZIP of up to 500 MP3s, each up to
 *  about 115 MB for a 4-hour Call at 64 kbps, moves one MP3 at a time, so
 *  the task overrides the 300-second default with an hour of compute and
 *  uses the 1 vCPU, 1 GB small-2x machine to hold one MP3 and
 *  an 8 MiB part beside the Node runtime.
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
  maxDuration: 3600,
  machine: "small-2x",
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
