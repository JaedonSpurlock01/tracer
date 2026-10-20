/**
 * -------------------------------------------------------------------------
 * @file   fake-trigger-report-run.ts
 * @brief  Completes one report or Calls export job as the Trigger.dev task would.
 *
 * @description
 *  Runs the report generation task body for the job id in argv against the
 *  E2E database, writing each file to the local R2 bucket with Wrangler,
 *  which the dev server's R2 binding reads.
 *
 * @remarks
 *  The browser journey spawns this through tsx because Playwright's own
 *  JSX transform targets component tests and cannot render the PDF. It
 *  writes only single-object files, so a Recording ZIP is refused rather
 *  than half-supported.
 *
 * @see
 *  tests/e2e/report-generation.spec.ts
 *  trigger/report-generation.ts
 *  data/e2e-trigger-fake.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Pool } from "pg";

import type { ArtifactObjects } from "@/data/r2-objects";
import { generateReportJob, recordReportGenerationFailure } from "@/data/report-generation";

const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:5433/tracer_e2e";

function localArtifactObjects(directory: string): ArtifactObjects {
  const unsupported = async (): Promise<never> => {
    throw new Error("The browser journey writes only single-object report files");
  };
  return {
    async put(key, body, _object, contentType) {
      const file = path.join(directory, key.replaceAll("/", "_"));
      writeFileSync(file, body);
      execFileSync(
        "corepack",
        ["pnpm", "exec", "wrangler", "r2", "object", "put", `tracer-recordings-test/${key}`, "--file", file, "--content-type", contentType ?? "application/octet-stream", "--local", "--config", "wrangler.test.jsonc"],
        { stdio: "pipe" },
      );
    },
    head: async () => null,
    get: async () => null,
    createMultipartUpload: unsupported,
    abortMultipartUploads: unsupported,
    delete: unsupported,
  };
}

const jobId = process.argv[2];
if (!jobId) throw new Error("A report job id is required");
const pool = new Pool({ connectionString: databaseUrl });
const directory = mkdtempSync(path.join(tmpdir(), "tracer-e2e-report-"));
try {
  await generateReportJob({ pool, objects: localArtifactObjects(directory), now: () => new Date() }, jobId);
} catch (error) {
  await recordReportGenerationFailure(pool, jobId, error);
  throw error;
} finally {
  rmSync(directory, { recursive: true, force: true });
  await pool.end();
}
