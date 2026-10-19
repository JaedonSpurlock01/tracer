/**
 * -------------------------------------------------------------------------
 * @file   report-artifact-lifecycle.ts
 * @brief  Plans the R2 lifecycle rule that expires generated report artifacts.
 *
 * @description
 *  Defines the `report-artifacts` rule, which deletes objects under
 *  `reports/` 7 days after upload and aborts their incomplete multipart
 *  uploads after 1 day, and plans a bucket's rule set around it: the rule
 *  is added after the existing rules, or replaces a drifted rule of the
 *  same name in place, and an identical rule means nothing changes. Also
 *  names each artifact's object key under that prefix, so the rule and the
 *  keys generation writes cannot drift apart.
 *
 * @remarks
 *  The Cloudflare lifecycle API replaces a bucket's whole rule set on PUT,
 *  so planning keeps every other rule, including Cloudflare's default
 *  multipart abort rule. The 7 days match the artifact expiry recorded on
 *  the job, measured from completion, while R2 measures from upload, which
 *  is at most the generation run's duration earlier. The rule shape
 *  matches what `wrangler r2 bucket lifecycle add` writes.
 *
 * @see
 *  scripts/configure-report-lifecycle.ts
 *  data/report-jobs.ts
 *  https://developers.cloudflare.com/r2/buckets/object-lifecycles/
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
const daySeconds = 86400;

const reportArtifactPrefix = "reports/";

export function reportCsvObjectKey(jobId: string): string {
  return `${reportArtifactPrefix}${jobId}/calls.csv`;
}

export function reportPdfObjectKey(jobId: string): string {
  return `${reportArtifactPrefix}${jobId}/report.pdf`;
}

export function reportZipObjectKey(jobId: string): string {
  return `${reportArtifactPrefix}${jobId}/recordings.zip`;
}

export interface R2LifecycleRule {
  id: string;
  enabled: boolean;
  conditions: { prefix?: string };
  deleteObjectsTransition?: { condition: { type: string; maxAge?: number; date?: string } };
  abortMultipartUploadsTransition?: { condition: { type: string; maxAge?: number } };
  storageClassTransitions?: unknown[];
}

export const reportArtifactLifecycleRule: R2LifecycleRule = {
  id: "report-artifacts",
  enabled: true,
  conditions: { prefix: reportArtifactPrefix },
  deleteObjectsTransition: { condition: { maxAge: 7 * daySeconds, type: "Age" } },
  abortMultipartUploadsTransition: { condition: { maxAge: daySeconds, type: "Age" } },
};

export type ReportArtifactLifecyclePlan = { status: "already_configured" } | { status: "update"; rules: R2LifecycleRule[] };

function ruleSignature(rule: R2LifecycleRule): string {
  return JSON.stringify([
    rule.id,
    rule.enabled,
    rule.conditions.prefix ?? "",
    rule.deleteObjectsTransition?.condition.type,
    rule.deleteObjectsTransition?.condition.maxAge,
    rule.deleteObjectsTransition?.condition.date,
    rule.abortMultipartUploadsTransition?.condition.type,
    rule.abortMultipartUploadsTransition?.condition.maxAge,
    rule.storageClassTransitions?.length ?? 0,
  ]);
}

export function planReportArtifactLifecycle(existing: readonly R2LifecycleRule[]): ReportArtifactLifecyclePlan {
  if (existing.some((rule) => ruleSignature(rule) === ruleSignature(reportArtifactLifecycleRule))) return { status: "already_configured" };
  if (!existing.some((rule) => rule.id === reportArtifactLifecycleRule.id)) return { status: "update", rules: [...existing, reportArtifactLifecycleRule] };
  return { status: "update", rules: existing.map((rule) => (rule.id === reportArtifactLifecycleRule.id ? reportArtifactLifecycleRule : rule)) };
}
