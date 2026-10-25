/**
 * -------------------------------------------------------------------------
 * @file   report-jobs.test.ts
 * @brief  Verifies report and Recording export jobs, their history, and downloads.
 *
 * @description
 *  Checks that a job covers only readable Workspaces, that a duplicate
 *  submission by the same requester returns the one existing unexpired
 *  job even when submitted concurrently, that a Failed or expired job does
 *  not block a new one, that Report history shows only the requester's
 *  jobs within metadata retention, and that a download is authorized only
 *  for the requester of a Completed job with unexpired artifacts who can
 *  still read every Workspace in its scope.
 *
 * @remarks
 *  Workspaces, users, and Access Grants are seeded directly, and actors are
 *  built directly, because readability comes from the readable Workspace
 *  helper over the database. Every instant is passed explicitly so expiry
 *  is deterministic. Every request matches at least one seeded Call with a
 *  retained Recording, because a report or export matching no Calls, and a
 *  Recording ZIP with no retained Recording, are rejected before a job is
 *  recorded. `pool.end()` resolves before its clients' sockets close, so
 *  stopping the container right after it can send a pooled client
 *  PostgreSQL's administrator shutdown (57P01) after the pool has dropped
 *  its error listener. Teardown therefore remembers every client the pool
 *  opens, waits for each socket to close after `pool.end()`, and only then
 *  stops the container; a client still ignores that one shutdown error in
 *  case the server closes first, and any other client error is thrown.
 *
 * @see
 *  data/report-jobs.ts
 *  data/report-request.ts
 *  data/workspace-authorization.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestPool } from "./test-pool";

import type { Actor } from "@/data/authorization";
import { emptyCallFilters } from "@/data/call-list-query";
import { migrateDatabase } from "@/data/migrate";
import {
  authorizeReportDownload,
  completeReportJob,
  createReportJob,
  failReportJob,
  listReportJobs,
  requestReportJob,
  type CallExportSelection,
  type ReportFileKind,
  ReportGenerationUnavailableError,
  type ReportGeneration,
  type ReportJobRequest,
} from "@/data/report-jobs";
import type { ReportPeriod } from "@/data/report-period";
import { ReportRequestError } from "@/data/report-request";
import { createReadableWorkspaces } from "@/data/workspace-authorization";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
const clients: PoolClient[] = [];

function actor(input: { userId: string; role: Actor["role"]; timezone: string }): Actor {
  return { ...input, organizationId: "fleet", name: input.userId, email: `${input.userId}@example.com`, state: "Active" };
}

const viewer = actor({ userId: "fleet-viewer", role: "Client Viewer", timezone: "Europe/Berlin" });

const requestedAt = new Date("2026-10-14T15:37:12.418Z");

const create = (who: Actor, request: ReportJobRequest, now = requestedAt) => createReportJob(pool!, who, createReadableWorkspaces(pool!, who), request, now);

async function seedWorkspace(id: string, name: string, timezone: string): Promise<void> {
  await pool!.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, created_at, updated_at) values ($1, 'fleet', $2, $3, 'Active', now(), now())`,
    [id, name, timezone],
  );
}

async function seedCalls(): Promise<void> {
  for (const workspaceId of ["north", "south"]) {
    await pool!.query(
      `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
       values ($1, 'fleet', $2, $3, 'Call Number', true, now(), now(), now(), now())`,
      [`${workspaceId}-number`, `PN${workspaceId.padEnd(32, "0")}`, workspaceId === "north" ? "+14155550113" : "+14155550127"],
    );
    await pool!.query(
      "insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at) select $1, 'fleet', $2, $3, phone_number, now(), now() from twilio_number where id = $3",
      [`${workspaceId}-assignment`, workspaceId, `${workspaceId}-number`],
    );
    await pool!.query("insert into flow_version (id, organization_id, workspace_id, version, graph, published_at) values ($1, 'fleet', $2, 1, '{}'::jsonb, now())", [`${workspaceId}-flow`, workspaceId]);
  }
  const calls: Array<[string, string, string, string, boolean]> = [
    ["call-1", "north", "2026-10-06T15:47:31.204Z", "Answered", true],
    ["call-3", "north", "2026-09-04T13:22:48.517Z", "Answered", true],
    ["north-june", "north", "2026-06-17T18:41:09.326Z", "Missed", false],
    ["call-2", "south", "2026-08-11T02:33:57.814Z", "Voicemail", true],
    ["call-4", "south", "2026-10-08T05:19:26.942Z", "Answered", true],
    ["call-unreachable", "south", "2026-09-12T07:58:13.061Z", "Missed", false],
  ];
  for (const [index, [id, workspaceId, startedAt, outcome, recorded]] of calls.entries()) {
    await pool!.query(
      `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, caller_number, state, outcome, outcome_reason, started_at, created_at, updated_at)
       select $1, 'fleet', $2, $2 || '-assignment', $2 || '-flow', $3, phone_number, '+12125550164', 'Completed', $4, 'flow_outcome', $5, now(), now() from number_assignment where id = $2 || '-assignment'`,
      [id, workspaceId, `CA${String(index + 1).padStart(32, "0")}`, outcome, startedAt],
    );
    if (!recorded) continue;
    await pool!.query(
      `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, transfer_state, r2_object_key, size_bytes, sha256, stored_at,
                              mp3_state, mp3_object_key, mp3_size_bytes, mp3_generated_at, created_at, updated_at)
       values ($1 || '-recording', 'fleet', $2, $1, $3, 'connected', 2, 'Stored', $1 || '.wav', 41_873, 'checksum', now(), 'Stored', $1 || '.mp3', 6_917, now(), now(), now())`,
      [id, workspaceId, `RE${String(index + 1).padStart(32, "0")}`],
    );
  }
}

async function seedUser(id: string, timezone: string): Promise<void> {
  await pool!.query(
    `insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at) values ($1, $1, $1 || '@example.com', true, 'Active', $2, now(), now())`,
    [id, timezone],
  );
}

async function grant(userId: string, workspaceId: string): Promise<void> {
  await pool!.query("insert into access_grant (id, organization_id, workspace_id, user_id, created_at) values ($1, 'fleet', $2, $3, now())", [`grant-${userId}-${workspaceId}`, workspaceId, userId]);
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = createTestPool(container.getConnectionUri());
  pool.on("connect", (client) => {
    clients.push(client);
    client.on("error", (error: Error & { code?: string }) => {
      if (error.code !== "57P01") throw error;
    });
  });
  await migrateDatabase(container.getConnectionUri());
  await pool.query("insert into organization (id, name, slug, created_at) values ('fleet', 'fleet', 'fleet', now())");
  await seedWorkspace("north", "North Plumbing", "America/New_York");
  await seedWorkspace("south", "South Roofing", "Asia/Tokyo");
  await seedWorkspace("west", "West Electric", "America/Los_Angeles");
  await seedUser("fleet-viewer", "Europe/Berlin");
  await grant("fleet-viewer", "north");
  await grant("fleet-viewer", "south");
  await seedCalls();
}, 120_000);

afterAll(async () => {
  const closed = clients.map((client) => {
    const stream = (client as unknown as { connection?: { stream?: { destroyed: boolean; once: (event: "close", listener: () => void) => void } } }).connection?.stream;
    return !stream || stream.destroyed ? Promise.resolve() : new Promise<void>((resolve) => stream.once("close", resolve));
  });
  await pool?.end();
  await Promise.all(closed);
  await container?.stop();
});

describe("Report job creation", () => {
  it("rejects a report or export that selects an ungranted Workspace and records no job", async () => {
    await expect(create(viewer, { kind: "report", scope: { kind: "global", workspaceIds: ["north", "west"] }, period: { kind: "previousWeek" }, files: ["pdf"] })).rejects.toEqual(
      new ReportRequestError("workspace_unavailable"),
    );
    await expect(create(viewer, { kind: "call_export", scope: { kind: "workspace", workspaceId: "west" }, selection: { kind: "call", callId: "call-1" }, file: "zip" })).rejects.toEqual(
      new ReportRequestError("workspace_unavailable"),
    );
    expect((await pool!.query("select count(*)::int as count from report_job")).rows[0].count).toBe(0);
  });

  it("queues a report job with its sorted Workspace scope, timezone, resolved period, files, and 90-day metadata expiry", async () => {
    const result = await create(viewer, { kind: "report", scope: { kind: "global", workspaceIds: ["south", "north"], timeZone: "America/Denver" }, period: { kind: "previousWeek" }, files: ["csv", "pdf"] });
    expect(result).toEqual({
      created: true,
      job: {
        id: expect.any(String),
        kind: "report",
        workspaceIds: ["north", "south"],
        timeZone: "America/Denver",
        parameters: { period: { kind: "previousWeek" }, window: { from: "2026-10-05", to: "2026-10-11" }, files: ["pdf", "csv"] },
        status: "Queued",
        failureReason: null,
        requestedAt,
        completedAt: null,
        artifactsExpireAt: null,
        metadataExpireAt: new Date("2027-01-12T15:37:12.418Z"),
      },
    });
  });

  it("rejects a report request that selects no files and records no job", async () => {
    const before = (await pool!.query("select count(*)::int as count from report_job")).rows[0].count;
    await expect(create(viewer, { kind: "report", scope: { kind: "workspace", workspaceId: "north" }, period: { kind: "previousMonth" }, files: [] })).rejects.toEqual(new ReportRequestError("empty_files"));
    expect((await pool!.query("select count(*)::int as count from report_job")).rows[0].count).toBe(before);
  });

  it("queues a Calls CSV export and a Recording ZIP export of the same selection as separate jobs", async () => {
    const selection: CallExportSelection = { kind: "filters", filters: { ...emptyCallFilters, outcomes: ["Voicemail"] } };
    const csv = await create(viewer, { kind: "call_export", scope: { kind: "workspace", workspaceId: "south" }, selection, file: "csv" });
    const zip = await create(viewer, { kind: "call_export", scope: { kind: "workspace", workspaceId: "south" }, selection, file: "zip" });
    expect(csv).toMatchObject({ created: true, job: { kind: "call_export", parameters: { selection, files: ["csv"] } } });
    expect(zip).toMatchObject({ created: true, job: { kind: "call_export", parameters: { selection, files: ["zip"] } } });
    expect(zip.job.id).not.toBe(csv.job.id);
  });

  it("queues a Recording export job for one Call in its Workspace reporting timezone", async () => {
    const result = await create(viewer, { kind: "call_export", scope: { kind: "workspace", workspaceId: "north" }, selection: { kind: "call", callId: "call-1" }, file: "zip" });
    expect(result.created).toBe(true);
    expect(result.job).toMatchObject({ kind: "call_export", workspaceIds: ["north"], timeZone: "America/New_York", parameters: { selection: { kind: "call", callId: "call-1" }, files: ["zip"] }, status: "Queued" });
  });

  it("returns the existing Queued job when the same requester resubmits the same normalized parameters", async () => {
    const first = await create(viewer, { kind: "report", scope: { kind: "global", workspaceIds: ["north", "south"] }, period: { kind: "custom", from: "2026-09-03", to: "2026-09-17" }, files: ["pdf"] });
    const again = await create(
      viewer,
      { kind: "report", scope: { kind: "global", workspaceIds: ["south", "north", "south"], timeZone: " Europe/Berlin " }, period: { kind: "custom", from: "2026-09-03", to: "2026-09-17" }, files: ["pdf", "pdf"] },
      new Date("2026-10-14T16:02:41.907Z"),
    );
    expect(again).toEqual({ created: false, job: first.job });
    const withCsv = await create(viewer, { kind: "report", scope: { kind: "global", workspaceIds: ["north", "south"] }, period: { kind: "custom", from: "2026-09-03", to: "2026-09-17" }, files: ["pdf", "csv"] });
    expect(withCsv.created).toBe(true);
    expect(withCsv.job.id).not.toBe(first.job.id);
  });

  it("records one logical job when the same requester submits the same parameters concurrently", async () => {
    const request: ReportJobRequest = { kind: "call_export", scope: { kind: "global", workspaceIds: ["north", "south"] }, selection: { kind: "filters", filters: { ...emptyCallFilters, outcomes: ["Answered"] } }, file: "zip" };
    const results = await Promise.all(Array.from({ length: 6 }, () => create(viewer, request)));
    expect(new Set(results.map(({ job }) => job.id)).size).toBe(1);
    expect(results.filter(({ created }) => created)).toHaveLength(1);
  });

  it("returns a Completed job while its artifacts are unexpired and creates a new job once they expire", async () => {
    const request: ReportJobRequest = { kind: "report", scope: { kind: "workspace", workspaceId: "south" }, period: { kind: "all" }, files: ["pdf"] };
    const { job } = await create(viewer, request);
    await completeReportJob(pool!, job.id, [{ file: "pdf", r2Key: `reports/${job.id}/report.pdf`, byteSize: 48_213, contentType: "application/pdf" }], new Date("2026-10-14T15:52:08.213Z"));
    const beforeExpiry = await create(viewer, request, new Date("2026-10-21T15:52:08.212Z"));
    expect(beforeExpiry).toMatchObject({ created: false, job: { id: job.id, status: "Completed", completedAt: new Date("2026-10-14T15:52:08.213Z"), artifactsExpireAt: new Date("2026-10-21T15:52:08.213Z") } });
    const atExpiry = await create(viewer, request, new Date("2026-10-21T15:52:08.213Z"));
    expect(atExpiry.created).toBe(true);
    expect(atExpiry.job.id).not.toBe(job.id);
  });

  it("does not let a Failed job block resubmission", async () => {
    const request: ReportJobRequest = { kind: "call_export", scope: { kind: "workspace", workspaceId: "south" }, selection: { kind: "call", callId: "call-2" }, file: "zip" };
    const { job } = await create(viewer, request);
    await failReportJob(pool!, job.id, "Recording unavailable");
    const resubmitted = await create(viewer, request, new Date("2026-10-14T15:43:19.064Z"));
    expect(resubmitted.created).toBe(true);
    expect(resubmitted.job.id).not.toBe(job.id);
  });
});

describe("Report generation requests", () => {
  function fakeGeneration(failure: Error | null = null): ReportGeneration & { requests: string[] } {
    const generation = {
      requests: [] as string[],
      async request(job: { id: string }) {
        generation.requests.push(job.id);
        if (failure) throw failure;
      },
    };
    return generation;
  }

  const submit = (request: ReportJobRequest, generation: ReportGeneration) => requestReportJob(pool!, viewer, createReadableWorkspaces(pool!, viewer), request, requestedAt, generation);

  it("requests generation for a newly queued job and not again for a duplicate submission", async () => {
    const generation = fakeGeneration();
    const request: ReportJobRequest = { kind: "report", scope: { kind: "workspace", workspaceId: "south" }, period: { kind: "custom", from: "2026-08-03", to: "2026-08-17" }, files: ["csv"] };

    const first = await submit(request, generation);
    const duplicate = await submit(request, generation);

    expect(first.created).toBe(true);
    expect(duplicate).toEqual({ created: false, job: first.job });
    expect(generation.requests).toEqual([first.job.id]);
  });

  it("records the job Failed when Trigger.dev cannot be reached, so a resubmission queues and requests a new job", async () => {
    const request: ReportJobRequest = { kind: "call_export", scope: { kind: "workspace", workspaceId: "south" }, selection: { kind: "call", callId: "call-unreachable" }, file: "csv" };
    const unavailable = fakeGeneration(new Error("Trigger.dev is unavailable"));

    await expect(submit(request, unavailable)).rejects.toEqual(new ReportGenerationUnavailableError());
    const failed = (await pool!.query("select status, failure_reason from report_job where id = $1", [unavailable.requests[0]])).rows[0];
    expect(failed).toEqual({ status: "Failed", failure_reason: "Report generation could not be started" });

    const generation = fakeGeneration();
    const retried = await submit(request, generation);
    expect(retried.created).toBe(true);
    expect(generation.requests).toEqual([retried.job.id]);
    expect(retried.job.id).not.toBe(unavailable.requests[0]);
  });
});

describe("Report history", () => {
  const ana = actor({ userId: "history-ana", role: "Client Viewer", timezone: "America/Chicago" });
  const ben = actor({ userId: "history-ben", role: "Operator", timezone: "America/Chicago" });

  it("lists only the requester's jobs, newest first, and hides jobs past metadata expiry", async () => {
    await seedUser(ana.userId, ana.timezone);
    await seedUser(ben.userId, ben.timezone);
    await grant(ana.userId, "north");
    const report = (period: ReportPeriod): ReportJobRequest => ({ kind: "report", scope: { kind: "workspace", workspaceId: "north" }, period, files: ["pdf"] });
    await create(ana, report({ kind: "previousMonth" }), new Date("2026-07-11T09:14:27.351Z"));
    const older = await create(ana, report({ kind: "custom", from: "2026-09-01", to: "2026-09-09" }), new Date("2026-10-02T11:48:06.519Z"));
    const newer = await create(ana, report({ kind: "previousWeek" }), new Date("2026-10-13T20:31:44.087Z"));
    const bens = await create(ben, report({ kind: "previousWeek" }), new Date("2026-10-13T20:31:44.087Z"));
    const now = new Date("2026-10-14T17:05:33.902Z");
    expect((await listReportJobs(pool!, ana, now)).map(({ id }) => id)).toEqual([newer.job.id, older.job.id]);
    expect((await listReportJobs(pool!, ben, now)).map(({ id }) => id)).toEqual([bens.job.id]);
  });
});

describe("Report downloads", () => {
  const completedAt = new Date("2026-10-14T15:48:51.276Z");
  const duringRetention = new Date("2026-10-19T08:27:03.645Z");

  async function completedReport(who: Actor, workspaceIds: string[]): Promise<string> {
    const { job } = await create(who, { kind: "report", scope: { kind: "global", workspaceIds, timeZone: "America/Denver" }, period: { kind: "previousMonth" }, files: ["pdf", "csv"] });
    await completeReportJob(
      pool!,
      job.id,
      [
        { file: "pdf", r2Key: `reports/${job.id}/report.pdf`, byteSize: 61_407, contentType: "application/pdf" },
        { file: "csv", r2Key: `reports/${job.id}/calls.csv`, byteSize: 9_318, contentType: "text/csv; charset=utf-8" },
      ],
      completedAt,
    );
    return job.id;
  }

  const authorize = (who: Actor, jobId: string, file: ReportFileKind, now = duringRetention) => authorizeReportDownload(pool!, who, createReadableWorkspaces(pool!, who), jobId, file, now);

  const cara = actor({ userId: "download-cara", role: "Client Viewer", timezone: "America/Chicago" });

  beforeAll(async () => {
    await seedUser(cara.userId, cara.timezone);
    await grant(cara.userId, "north");
    await grant(cara.userId, "south");
  });

  it("authorizes the requester's Completed artifact and names the file from the requested date in the report timezone", async () => {
    const jobId = await completedReport(cara, ["north", "south"]);
    expect(await authorize(cara, jobId, "csv")).toEqual({ r2Key: `reports/${jobId}/calls.csv`, contentType: "text/csv; charset=utf-8", filename: "tracer-report-2026-10-14.csv" });
    expect(await authorize(cara, jobId, "zip")).toBeNull();
  });

  it("refuses a download once the artifacts expire seven days after completion, and before the job completes", async () => {
    const jobId = await completedReport(cara, ["north"]);
    expect(await authorize(cara, jobId, "pdf", new Date("2026-10-21T15:48:51.275Z"))).not.toBeNull();
    expect(await authorize(cara, jobId, "pdf", new Date("2026-10-21T15:48:51.276Z"))).toBeNull();
    const queued = await create(cara, { kind: "call_export", scope: { kind: "workspace", workspaceId: "north" }, selection: { kind: "call", callId: "call-3" }, file: "zip" });
    expect(await authorize(cara, queued.job.id, "zip")).toBeNull();
  });

  it("blocks every artifact of a multi-Workspace job once the requester loses the Access Grant to one of its Workspaces", async () => {
    const eve = actor({ userId: "download-eve", role: "Client Viewer", timezone: "America/Chicago" });
    await seedUser(eve.userId, eve.timezone);
    await grant(eve.userId, "north");
    await grant(eve.userId, "south");
    const both = await completedReport(eve, ["north", "south"]);
    const northOnly = await completedReport(eve, ["north"]);
    expect(await authorize(eve, both, "pdf")).not.toBeNull();
    await pool!.query("delete from access_grant where user_id = $1 and workspace_id = 'south'", [eve.userId]);
    expect(await authorize(eve, both, "pdf")).toBeNull();
    expect(await authorize(eve, both, "csv")).toBeNull();
    expect(await authorize(eve, northOnly, "pdf")).not.toBeNull();
  });

  it("gives another user, even one who reads the same Workspaces, the same not-found result as a missing job", async () => {
    const operator = actor({ userId: "download-operator", role: "Operator", timezone: "America/Chicago" });
    await seedUser(operator.userId, operator.timezone);
    const jobId = await completedReport(cara, ["north", "south"]);
    expect(await authorize(operator, jobId, "pdf")).toBeNull();
    expect(await authorize(operator, "missing-job", "pdf")).toBeNull();
    expect(await authorize(cara, jobId, "pdf")).not.toBeNull();
  });

  it("names a Calls CSV export and a Recording ZIP export from the requested date in the Workspace reporting timezone", async () => {
    const selection: CallExportSelection = { kind: "call", callId: "call-4" };
    const csv = await create(cara, { kind: "call_export", scope: { kind: "workspace", workspaceId: "south" }, selection, file: "csv" }, new Date("2026-10-14T16:21:37.582Z"));
    const zip = await create(cara, { kind: "call_export", scope: { kind: "workspace", workspaceId: "south" }, selection, file: "zip" }, new Date("2026-10-14T16:21:37.582Z"));
    await completeReportJob(pool!, csv.job.id, [{ file: "csv", r2Key: `exports/${csv.job.id}/calls.csv`, byteSize: 2_417, contentType: "text/csv; charset=utf-8" }], completedAt);
    await completeReportJob(pool!, zip.job.id, [{ file: "zip", r2Key: `exports/${zip.job.id}/recordings.zip`, byteSize: 3_904_118, contentType: "application/zip" }], completedAt);
    expect(await authorize(cara, csv.job.id, "csv")).toEqual({ r2Key: `exports/${csv.job.id}/calls.csv`, contentType: "text/csv; charset=utf-8", filename: "tracer-calls-2026-10-15.csv" });
    expect(await authorize(cara, zip.job.id, "zip")).toEqual({ r2Key: `exports/${zip.job.id}/recordings.zip`, contentType: "application/zip", filename: "tracer-recordings-2026-10-15.zip" });
  });
});

