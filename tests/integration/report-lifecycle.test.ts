/**
 * -------------------------------------------------------------------------
 * @file   report-lifecycle.test.ts
 * @brief  Verifies the report job lifecycle sweep.
 *
 * @description
 *  Runs the sweep under the least-privilege runtime role against a real
 *  PostgreSQL database and checks that a Queued or Generating job requested
 *  more than 6 hours ago is recorded Failed with a concise reason, while a
 *  younger job and a Completed or already Failed job are left as they are,
 *  and that a job whose metadata retention has ended is deleted with its
 *  artifacts after its R2 objects are deleted and a stale Recording ZIP
 *  upload aborted, even when those R2 requests fail, at most 100 jobs a
 *  sweep. Running as the runtime role also proves its DELETE grant and the
 *  artifact cascade.
 *
 * @remarks
 *  Jobs are seeded directly through the migration role. Instants are
 *  non-round. Private R2 is a fake at the provider boundary that records
 *  each delete and multipart abort.
 *
 * @see
 *  data/report-lifecycle.ts
 *  data/runtime-role.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/data/migrate";
import type { ArtifactObjects } from "@/data/r2-objects";
import { sweepReportJobs } from "@/data/report-lifecycle";
import { provisionRuntimeRole, runtimeRole } from "@/data/runtime-role";

const now = new Date("2026-10-18T09:41:23.417Z");
const before = (ms: number) => new Date(now.getTime() - ms);
const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;

let container: StartedPostgreSqlContainer | undefined;
let owner: Pool | undefined;
let runtime: Pool | undefined;

interface FakeR2 extends Pick<ArtifactObjects, "delete" | "abortMultipartUploads"> {
  deletes: string[];
  aborts: string[];
  failingKeys: Set<string>;
}

function fakeR2(): FakeR2 {
  const r2: FakeR2 = {
    deletes: [],
    aborts: [],
    failingKeys: new Set(),
    async delete(key) {
      r2.deletes.push(key);
      if (r2.failingKeys.has(key)) throw new Error("R2 request failed (HTTP 503)");
    },
    async abortMultipartUploads(key) {
      r2.aborts.push(key);
      if (r2.failingKeys.has(key)) throw new Error("R2 request failed (HTTP 503)");
    },
  };
  return r2;
}

type SeedJob = {
  kind?: "report" | "call_export";
  files?: Array<"pdf" | "csv" | "zip">;
  status: "Queued" | "Generating" | "Completed" | "Failed";
  requestedAt: Date;
  metadataExpireAt?: Date;
};

async function seedJob(job: SeedJob): Promise<string> {
  const id = randomUUID();
  const kind = job.kind ?? "report";
  const files = job.files ?? ["pdf", "csv"];
  const completed = job.status === "Completed";
  await owner!.query(
    `insert into report_job (id, organization_id, requester_user_id, kind, workspace_ids, time_zone, parameters, fingerprint, status, failure_reason,
                             requested_at, completed_at, artifacts_expire_at, metadata_expire_at)
     values ($1, 'fleet', 'report-viewer', $2, array['north'], 'America/Chicago', $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      kind,
      JSON.stringify(kind === "report" ? { period: { kind: "previousWeek" }, window: { from: "2026-10-05", to: "2026-10-11" }, files } : { selection: { kind: "call", callId: "north-call" }, files }),
      `fingerprint-${id}`,
      job.status,
      job.status === "Failed" ? "Report generation failed" : null,
      job.requestedAt,
      completed ? new Date(job.requestedAt.getTime() + 4 * 60 * 1000 + 17_311) : null,
      completed ? new Date(job.requestedAt.getTime() + 7 * dayMs + 4 * 60 * 1000 + 17_311) : null,
      job.metadataExpireAt ?? new Date(job.requestedAt.getTime() + 90 * dayMs),
    ],
  );
  if (completed) {
    for (const file of files) {
      await owner!.query("insert into report_artifact (job_id, file_kind, r2_key, byte_size, content_type) values ($1, $2, $3, 4129, 'application/octet-stream')", [
        id,
        file,
        `reports/${id}/${{ pdf: "report.pdf", csv: "calls.csv", zip: "recordings.zip" }[file]}`,
      ]);
    }
  }
  return id;
}

async function job(id: string): Promise<{ status: string; failure_reason: string | null } | undefined> {
  return (await owner!.query<{ status: string; failure_reason: string | null }>("select status, failure_reason from report_job where id = $1", [id])).rows[0];
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  await migrateDatabase(container.getConnectionUri());
  owner = new Pool({ connectionString: container.getConnectionUri() });
  const password = "B".repeat(64);
  await provisionRuntimeRole(owner, password);
  const runtimeUrl = new URL(container.getConnectionUri());
  runtimeUrl.username = runtimeRole;
  runtimeUrl.password = password;
  runtime = new Pool({ connectionString: runtimeUrl.toString() });
  await owner.query("insert into organization (id, name, slug, created_at) values ('fleet', 'fleet', 'fleet', now())");
  await owner.query(`insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at) values ('report-viewer', 'Report Viewer', 'report-viewer@example.com', true, 'Active', 'America/Chicago', now(), now())`);
}, 120_000);

beforeEach(async () => {
  await owner!.query("delete from report_job");
});

afterAll(async () => {
  await runtime?.end();
  await owner?.end();
  await container?.stop();
});

describe("Report job lifecycle sweep", () => {
  it("records Queued and Generating jobs requested more than 6 hours ago Failed, and leaves younger, Completed, and Failed jobs as they are", async () => {
    const youngQueued = await seedJob({ status: "Queued", requestedAt: before(6 * hourMs - 1_317) });
    const stuckQueued = await seedJob({ status: "Queued", requestedAt: before(6 * hourMs + 713) });
    const youngGenerating = await seedJob({ status: "Generating", requestedAt: before(5 * hourMs + 59 * 60 * 1000 + 41_207) });
    const stuckGenerating = await seedJob({ status: "Generating", requestedAt: before(9 * hourMs + 12_419) });
    const completed = await seedJob({ status: "Completed", requestedAt: before(2 * dayMs + 3_571) });
    const failed = await seedJob({ status: "Failed", requestedAt: before(3 * dayMs + 8_093) });

    const result = await sweepReportJobs({ pool: runtime!, objects: fakeR2() }, now);

    expect(result.failed).toBe(2);
    await expect(job(youngQueued)).resolves.toEqual({ status: "Queued", failure_reason: null });
    await expect(job(stuckQueued)).resolves.toEqual({ status: "Failed", failure_reason: "Report generation did not finish" });
    await expect(job(youngGenerating)).resolves.toEqual({ status: "Generating", failure_reason: null });
    await expect(job(stuckGenerating)).resolves.toEqual({ status: "Failed", failure_reason: "Report generation did not finish" });
    await expect(job(completed)).resolves.toEqual({ status: "Completed", failure_reason: null });
    await expect(job(failed)).resolves.toEqual({ status: "Failed", failure_reason: "Report generation failed" });

    await expect(sweepReportJobs({ pool: runtime!, objects: fakeR2() }, now)).resolves.toMatchObject({ failed: 0 });
  });

  it("deletes jobs whose metadata retention has ended with their artifacts, after deleting their R2 objects and aborting a stale Recording ZIP upload", async () => {
    const report = await seedJob({ status: "Completed", files: ["pdf", "csv"], requestedAt: before(90 * dayMs + 2_311), metadataExpireAt: before(2_311) });
    const exportJob = await seedJob({ kind: "call_export", files: ["zip"], status: "Failed", requestedAt: before(91 * dayMs + 5_903), metadataExpireAt: now });
    const retained = await seedJob({ status: "Completed", files: ["csv"], requestedAt: before(89 * dayMs + 86_398_100), metadataExpireAt: new Date(now.getTime() + 1_900) });
    const r2 = fakeR2();

    const result = await sweepReportJobs({ pool: runtime!, objects: r2 }, now);

    expect(result).toMatchObject({ purged: 2, objectFailures: 0 });
    await expect(job(report)).resolves.toBeUndefined();
    await expect(job(exportJob)).resolves.toBeUndefined();
    await expect(job(retained)).resolves.toEqual({ status: "Completed", failure_reason: null });
    const artifacts = await owner!.query<{ job_id: string }>("select job_id from report_artifact");
    expect(artifacts.rows).toEqual([{ job_id: retained }]);
    expect(r2.deletes.sort()).toEqual([`reports/${exportJob}/recordings.zip`, `reports/${report}/calls.csv`, `reports/${report}/report.pdf`].sort());
    expect(r2.aborts).toEqual([`reports/${exportJob}/recordings.zip`]);
  });

  it("still deletes a job's metadata when deleting its R2 objects or aborting its upload fails", async () => {
    const exportJob = await seedJob({ kind: "call_export", files: ["zip"], status: "Completed", requestedAt: before(93 * dayMs + 4_127), metadataExpireAt: before(3 * dayMs + 4_127) });
    const report = await seedJob({ status: "Failed", files: ["pdf", "csv"], requestedAt: before(92 * dayMs + 619), metadataExpireAt: before(2 * dayMs + 619) });
    const r2 = fakeR2();
    r2.failingKeys.add(`reports/${exportJob}/recordings.zip`);
    r2.failingKeys.add(`reports/${report}/report.pdf`);

    const result = await sweepReportJobs({ pool: runtime!, objects: r2 }, now);

    expect(result).toMatchObject({ purged: 2, objectFailures: 3 });
    expect(r2.deletes).toContain(`reports/${report}/calls.csv`);
    await expect(job(exportJob)).resolves.toBeUndefined();
    await expect(job(report)).resolves.toBeUndefined();
    await expect(owner!.query("select job_id from report_artifact")).resolves.toMatchObject({ rows: [] });
  });

  it("deletes at most 100 expired jobs a sweep, oldest retention end first, and the rest on the next sweep", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 103; index += 1) {
      ids.push(await seedJob({ status: "Failed", files: ["csv"], requestedAt: before(120 * dayMs - index * 61_013), metadataExpireAt: before(30 * dayMs - index * 61_013) }));
    }
    const r2 = fakeR2();

    await expect(sweepReportJobs({ pool: runtime!, objects: r2 }, now)).resolves.toMatchObject({ purged: 100 });
    const remaining = await owner!.query<{ id: string }>("select id from report_job order by metadata_expire_at");
    expect(remaining.rows.map(({ id }) => id)).toEqual(ids.slice(100));
    expect(r2.deletes).toHaveLength(100);

    await expect(sweepReportJobs({ pool: runtime!, objects: r2 }, now)).resolves.toMatchObject({ purged: 3 });
    await expect(owner!.query("select id from report_job")).resolves.toMatchObject({ rows: [] });
  });

  it("deletes the R2 objects of artifacts a purge expired early on every sweep until the lifecycle rule would have removed them", async () => {
    const purgedZip = await seedJob({ kind: "call_export", files: ["zip"], status: "Completed", requestedAt: before(2 * dayMs + 7_219) });
    const failingZip = await seedJob({ kind: "call_export", files: ["zip"], status: "Completed", requestedAt: before(3 * dayMs + 1_481) });
    const oldPurgedZip = await seedJob({ kind: "call_export", files: ["zip"], status: "Completed", requestedAt: before(8 * dayMs + 3_907) });
    const naturallyExpired = await seedJob({ kind: "call_export", files: ["zip"], status: "Completed", requestedAt: before(7 * dayMs + 4 * 60 * 1000 + 17_311 + 1_000) });
    const unexpired = await seedJob({ kind: "call_export", files: ["zip"], status: "Completed", requestedAt: before(dayMs + 5_113) });
    await owner!.query("update report_job set artifacts_expire_at = $2 where id = any($1::text[])", [[purgedZip, failingZip], before(3_600_000 + 2_017)]);
    await owner!.query("update report_job set artifacts_expire_at = completed_at + interval '1 day' where id = $1", [oldPurgedZip]);
    const r2 = fakeR2();
    r2.failingKeys.add(`reports/${failingZip}/recordings.zip`);

    await expect(sweepReportJobs({ pool: runtime!, objects: r2 }, now)).resolves.toEqual({ failed: 0, purged: 0, objectFailures: 1 });

    expect(r2.deletes.sort()).toEqual([`reports/${purgedZip}/recordings.zip`, `reports/${failingZip}/recordings.zip`].sort());
    r2.failingKeys.clear();
    r2.deletes.length = 0;
    await expect(sweepReportJobs({ pool: runtime!, objects: r2 }, now)).resolves.toEqual({ failed: 0, purged: 0, objectFailures: 0 });
    expect(r2.deletes.sort()).toEqual([`reports/${purgedZip}/recordings.zip`, `reports/${failingZip}/recordings.zip`].sort());
    for (const id of [purgedZip, failingZip, oldPurgedZip, naturallyExpired, unexpired]) await expect(job(id)).resolves.toEqual({ status: "Completed", failure_reason: null });
  });
});
