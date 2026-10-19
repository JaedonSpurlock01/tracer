/**
 * -------------------------------------------------------------------------
 * @file   configure-report-lifecycle.ts
 * @brief  Configures the R2 lifecycle rule that expires generated report artifacts.
 *
 * @description
 *  Usage: `tsx scripts/configure-report-lifecycle.ts <bucket> [--apply]`.
 *  Without `--apply` it is a dry run: it prints the `report-artifacts`
 *  rule (objects under `reports/` expire after 7 days, incomplete multipart
 *  uploads abort after 1 day) and, when Cloudflare credentials are present,
 *  reads the bucket's rules and prints whether the bucket is already
 *  configured or the rule set it would write. With `--apply` it writes that
 *  rule set, or reports "already configured" and changes nothing.
 *
 * @remarks
 *  Requires `CLOUDFLARE_ACCOUNT_ID` and a `CLOUDFLARE_API_TOKEN` allowed to
 *  edit R2 bucket settings for `--apply`. The lifecycle API replaces the
 *  whole rule set, so the plan keeps every other rule, including
 *  Cloudflare's default multipart abort rule. The token is never printed.
 *
 * @see
 *  data/report-artifact-lifecycle.ts
 *  https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/lifecycle/
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { planReportArtifactLifecycle, reportArtifactLifecycleRule, type R2LifecycleRule } from "../data/report-artifact-lifecycle";

const arguments_ = process.argv.slice(2);
const apply = arguments_.includes("--apply");
const bucket = arguments_.find((argument) => !argument.startsWith("--"));

if (!bucket || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
  throw new Error("Usage: tsx scripts/configure-report-lifecycle.ts <bucket> [--apply]");
}

console.log(`Rule for ${bucket}:\n${JSON.stringify(reportArtifactLifecycleRule, null, 2)}`);

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;

if (!accountId || !apiToken) {
  if (apply) throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required with --apply");
  console.log("Dry run: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to compare with the bucket's current rules.");
  process.exit(0);
}

const lifecycleUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/lifecycle`;

async function cloudflare<T>(init: RequestInit): Promise<T> {
  const response = await fetch(lifecycleUrl, { ...init, headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json", ...init.headers } });
  const body = (await response.json()) as { success: boolean; result: T; errors?: Array<{ code: number; message: string }> };
  if (!response.ok || !body.success) throw new Error(`Cloudflare lifecycle request failed (HTTP ${response.status}): ${JSON.stringify(body.errors ?? [])}`);
  return body.result;
}

const current = await cloudflare<{ rules?: R2LifecycleRule[] }>({ method: "GET" });
const plan = planReportArtifactLifecycle(current.rules ?? []);

if (plan.status === "already_configured") {
  console.log(`${bucket}: already configured; nothing changed.`);
} else if (!apply) {
  console.log(`Dry run: ${bucket} would be updated to these rules (rerun with --apply):\n${JSON.stringify(plan.rules, null, 2)}`);
} else {
  await cloudflare({ method: "PUT", headers: { "cf-r2-data-catalog-check": "true" }, body: JSON.stringify({ rules: plan.rules }) });
  console.log(`${bucket}: report-artifacts rule configured.`);
}
