/**
 * -------------------------------------------------------------------------
 * @file   report-lifecycle.ts
 * @brief  Fails stuck report jobs and deletes report job metadata past retention.
 *
 * @description
 *  Records a Queued or Generating report or Calls export job requested
 *  more than 6 hours ago Failed with the reason "Report generation did not
 *  finish", so Report history offers Retry instead of showing it in
 *  progress forever; a Completed or Failed job is never changed. Then
 *  deletes up to 100 jobs whose metadata retention has ended, oldest first,
 *  with their artifacts, after a best-effort delete of their private R2
 *  objects under `reports/{jobId}/` and of any unfinished Recording ZIP
 *  upload.
 *
 * @remarks
 *  Generation allows an hour per attempt and five attempts with at most a
 *  few minutes of backoff, so a run still alive after 6 hours is not going
 *  to finish; a late run then finds the job Failed and does nothing. The
 *  R2 lifecycle rule on `reports/` is the primary artifact expiry, 7 days
 *  after upload; this cleanup only catches objects the rule missed. Object
 *  keys follow from the job's files, so a Failed job's partial objects,
 *  which have no artifact row, are found too. Objects go first, while the
 *  job id still names them, and a failed object delete is counted but
 *  never blocks the row delete, because the job's artifacts expired long
 *  before its metadata and the lifecycle rule still reaches the object.
 *  Artifact rows go through the foreign key cascade, which runs with the
 *  table owner's privileges, so the runtime role needs DELETE only on
 *  `report_job`. The batch limit bounds R2 requests per sweep, and the
 *  rest are deleted on the next sweep.
 *
 * @see
 *  data/report-jobs.ts
 *  data/report-generation.ts
 *  data/report-artifact-lifecycle.ts
 *  trigger/report-lifecycle.ts
 *  trigger.config.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import type { ArtifactObjects } from "@/data/r2-objects";
import { reportCsvObjectKey, reportPdfObjectKey, reportZipObjectKey } from "@/data/report-artifact-lifecycle";
import type { ReportFileKind } from "@/data/report-jobs";

export const stuckReportJobReason = "Report generation did not finish";

const objectKeys: Readonly<Record<ReportFileKind, (jobId: string) => string>> = { pdf: reportPdfObjectKey, csv: reportCsvObjectKey, zip: reportZipObjectKey };

export const reportPurgeBatchSize = 100;

export async function sweepReportJobs(
  deps: { pool: Pool; objects: Pick<ArtifactObjects, "delete" | "abortMultipartUploads"> },
  now: Date,
): Promise<{ failed: number; purged: number; objectFailures: number }> {
  const failed = await deps.pool.query(
    `update report_job set status = 'Failed', failure_reason = $2
      where status in ('Queued', 'Generating') and requested_at < $1::timestamptz - interval '6 hours'`,
    [now, stuckReportJobReason],
  );
  const expired = await deps.pool.query<{ id: string; files: ReportFileKind[] }>(
    `select id, array(select jsonb_array_elements_text(parameters->'files')) as files
       from report_job
      where metadata_expire_at <= $1
      order by metadata_expire_at, id
      limit $2`,
    [now, reportPurgeBatchSize],
  );
  let objectFailures = 0;
  async function attempt(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch {
      objectFailures += 1;
    }
  }
  for (const job of expired.rows) {
    for (const file of job.files) {
      const key = objectKeys[file](job.id);
      if (file === "zip") await attempt(() => deps.objects.abortMultipartUploads(key));
      await attempt(() => deps.objects.delete(key));
    }
  }
  const purged = await deps.pool.query("delete from report_job where id = any($1::text[]) and metadata_expire_at <= $2", [expired.rows.map(({ id }) => id), now]);
  return { failed: failed.rowCount ?? 0, purged: purged.rowCount ?? 0, objectFailures };
}
