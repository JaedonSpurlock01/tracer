/**
 * -------------------------------------------------------------------------
 * @file   report-generation.test.ts
 * @brief  Verifies report PDF and Calls CSV generation for report and Calls export jobs.
 *
 * @description
 *  Runs report generation against a real PostgreSQL database with a fake
 *  private R2 boundary, and checks the stored CSV and its artifact, start
 *  times in the job's report timezone across Workspaces, the Workspace
 *  column, Lead Review precedence in the effective Lead classification,
 *  that Calls outside the job's Workspaces never appear even when the
 *  export filters name them, that an export of a Call outside them is never
 *  queued, idempotent reruns, and failure recording. A
 *  PDF and CSV report completes only with both artifacts, and its PDF
 *  bytes and extracted text name the Workspaces, period, timezone, and
 *  Total Calls; a PDF-only single-Workspace report has no comparison.
 *
 * @remarks
 *  Jobs are created through the report job domain so their stored
 *  parameters are real. Call instants are non-round, and a small page size
 *  makes generation walk several pages. Workspaces, users, and Access
 *  Grants are seeded directly. PDF text is extracted with the dev-only
 *  pdfjs-dist, so the check reads the rendered file rather than the model.
 *
 * @see
 *  data/report-generation.ts
 *  data/report-csv.ts
 *  data/report-pdf.tsx
 *  data/report-jobs.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createHash } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/data/authorization";
import { generateInitialCallFlow } from "@/data/call-flow";
import { emptyCallFilters } from "@/data/call-list-query";
import { migrateDatabase } from "@/data/migrate";
import { R2ObjectError, type ArtifactObjects, type StoredObject } from "@/data/r2-objects";
import { generateReportJob, recordReportGenerationFailure } from "@/data/report-generation";
import { createReportJob, type ReportJobRequest } from "@/data/report-jobs";
import { ReportRequestError } from "@/data/report-request";
import { createReadableWorkspaces } from "@/data/workspace-authorization";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;

const requestedAt = new Date("2026-10-14T15:37:12.418Z");

const viewer: Actor = { userId: "report-viewer", organizationId: "fleet", role: "Client Viewer", timezone: "Europe/Berlin", name: "Report Viewer", email: "report-viewer@example.com", state: "Active" };

const header =
  "\uFEFFCall ID,Workspace,Tracking Number Dialed,Caller Number,Started At,Call Outcome,Total Duration Seconds,Connected Duration Seconds,Effective Lead Classification,AI Lead Score,Lead Review,Recording Availability,Transcript Availability\r\n";

interface FakeR2 extends ArtifactObjects {
  objects: Map<string, { bytes: Uint8Array; contentType: string }>;
  puts: string[];
  putFailure: Error | null;
}

function fakeR2(): FakeR2 {
  const r2: FakeR2 = {
    objects: new Map(),
    puts: [],
    putFailure: null,
    async head(key): Promise<StoredObject | null> {
      const object = r2.objects.get(key);
      return object ? { sizeBytes: object.bytes.byteLength, sha256: createHash("sha256").update(object.bytes).digest("hex") } : null;
    },
    async put(key, body, object, contentType = "audio/wav") {
      r2.puts.push(key);
      if (r2.putFailure) throw r2.putFailure;
      expect(object).toEqual({ sizeBytes: body.byteLength, sha256: createHash("sha256").update(body).digest("hex") });
      r2.objects.set(key, { bytes: body, contentType });
    },
    async get(key) {
      return r2.objects.get(key)?.bytes ?? null;
    },
    async createMultipartUpload() {
      throw new Error("A report PDF or Calls CSV uploads with one PUT");
    },
    async abortMultipartUploads() {},
  };
  return r2;
}

const text = (r2: FakeR2, key: string) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(r2.objects.get(key)?.bytes);

async function pdfText(bytes: Uint8Array): Promise<string[]> {
  const document = await getDocument({ data: bytes.slice() }).promise;
  const pages: string[] = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const content = await (await document.getPage(number)).getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).filter(Boolean).join(" "));
  }
  return pages;
}

const generate = (r2: FakeR2, jobId: string) => generateReportJob({ pool: pool!, objects: r2, now: () => new Date("2026-10-14T15:41:27.906Z"), pageSize: 2 }, jobId);

const create = async (request: ReportJobRequest) => (await createReportJob(pool!, viewer, createReadableWorkspaces(pool!, viewer), request, requestedAt)).job;

const graph = generateInitialCallFlow({ destinationNumber: "+14155550199", recordingEnabled: true, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });

async function seedWorkspace(id: string, name: string, timezone: string, trackingNumber: string): Promise<void> {
  await pool!.query(`insert into workspace (id, organization_id, name, reporting_timezone, state, created_at, updated_at) values ($1, 'fleet', $2, $3, 'Active', now(), now())`, [id, name, timezone]);
  await pool!.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ($1, 'fleet', $2, $3, 'Call Number', true, now(), now(), now(), now())`,
    [`${id}-number`, `PN${id.padEnd(32, "0")}`, trackingNumber],
  );
  await pool!.query(
    `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at) values ($1, 'fleet', $2, $3, $4, now(), now())`,
    [`${id}-assignment`, id, `${id}-number`, trackingNumber],
  );
  await pool!.query(`insert into flow_version (id, organization_id, workspace_id, version, graph, published_at) values ($1, 'fleet', $2, 1, $3, now())`, [`${id}-flow`, id, JSON.stringify(graph)]);
}

interface SeedCall {
  id: string;
  workspaceId: string;
  trackingNumber: string;
  callerNumber: string;
  startedAt: string;
  outcome: "Answered" | "Voicemail" | "Missed";
  connectedSeconds?: number;
  totalSeconds: number;
  transcript?: "Completed" | "Skipped" | null;
  assessment?: { classification: string; score: number };
  review?: string;
}

let seeded = 0;

async function seedCall(input: SeedCall): Promise<void> {
  seeded += 1;
  const answered = input.outcome === "Answered";
  await pool!.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, caller_number,
                       state, outcome, outcome_reason, started_at, answered_at, ended_at, duration_seconds, created_at, updated_at)
     values ($1, 'fleet', $2, $3, $4, $5, $6, $7, 'Completed', $8, 'flow_outcome', $9::timestamptz,
             case when $10::boolean then $9::timestamptz + make_interval(secs => $11::int - $12::int) end, $9::timestamptz + make_interval(secs => $11::int), $11::int, now(), now())`,
    [input.id, input.workspaceId, `${input.workspaceId}-assignment`, `${input.workspaceId}-flow`, `CA${String(seeded).padStart(32, "0")}`, input.trackingNumber, input.callerNumber,
      input.outcome, input.startedAt, answered, input.totalSeconds, input.connectedSeconds ?? 0],
  );
  if (input.transcript === undefined) return;
  await pool!.query(
    `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, transfer_state, r2_object_key, size_bytes, sha256, stored_at,
                            waveform_state, waveform_object_key, waveform_generated_at, transcript_state, transcript_skip_reason, transcript_completed_at, lead_assessment_state, created_at, updated_at)
     values ($1, 'fleet', $2, $3, $4, $5, 2, 41, 'Stored', $6, 2048, 'checksum', now(), 'Stored', $6 || '.peaks.json', now(),
             $7, case when $7 = 'Skipped' then 'too_short' end, case when $7 = 'Completed' then now() end, case when $7 = 'Completed' then 'Completed' end, now(), now())`,
    [`${input.id}-recording`, input.workspaceId, input.id, `RE${String(seeded).padStart(32, "0")}`, input.outcome === "Voicemail" ? "voicemail" : "connected", `recordings/${input.id}.wav`, input.transcript],
  );
  if (input.assessment) {
    await pool!.query(
      `insert into lead_assessment (id, organization_id, call_id, recording_id, classification, score, summary, rationale, model, input_tokens, output_tokens, cost_usd, processed_at)
       values ($1, 'fleet', $2, $3, $4, $5, 'Caller asked for a quote.', 'Clear service need.', 'gpt-5-mini', 900, 120, 0.000465, now())`,
      [`${input.id}-assessment`, input.id, `${input.id}-recording`, input.assessment.classification, input.assessment.score],
    );
  }
  if (input.review) await pool!.query("insert into lead_review (call_id, organization_id, classification, reviewed_at) values ($1, 'fleet', $2, now())", [input.id, input.review]);
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrateDatabase(container.getConnectionUri());
  await pool.query("insert into organization (id, name, slug, created_at) values ('fleet', 'fleet', 'fleet', now())");
  await seedWorkspace("north", "North Plumbing", "America/New_York", "+14155550113");
  await seedWorkspace("south", "South Roofing, Inc.", "Asia/Tokyo", "+14155550127");
  await seedWorkspace("west", "West Electric", "America/Los_Angeles", "+14155550139");
  await pool.query(`insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at) values ('report-viewer', 'Report Viewer', 'report-viewer@example.com', true, 'Active', 'Europe/Berlin', now(), now())`);
  for (const workspaceId of ["north", "south"]) {
    await pool.query("insert into access_grant (id, organization_id, workspace_id, user_id, created_at) values ($1, 'fleet', $2, 'report-viewer', now())", [`grant-${workspaceId}`, workspaceId]);
  }
  await seedCall({ id: "north-before-week", workspaceId: "north", trackingNumber: "+14155550113", callerNumber: "+12125550164", startedAt: "2026-10-05T05:59:12.611Z", outcome: "Missed", totalSeconds: 23 });
  await seedCall({ id: "north-week-start", workspaceId: "north", trackingNumber: "+14155550113", callerNumber: "+12125550171", startedAt: "2026-10-05T06:00:03.317Z", outcome: "Missed", totalSeconds: 19 });
  await seedCall({
    id: "north-reviewed",
    workspaceId: "north",
    trackingNumber: "+14155550113",
    callerNumber: "+12125550187",
    startedAt: "2026-10-06T15:47:31.204Z",
    outcome: "Answered",
    totalSeconds: 317,
    connectedSeconds: 283,
    transcript: "Completed",
    assessment: { classification: "Good Lead", score: 37 },
    review: "Not Good Lead",
  });
  await seedCall({
    id: "south-voicemail",
    workspaceId: "south",
    trackingNumber: "+14155550127",
    callerNumber: "+818055501942",
    startedAt: "2026-10-09T01:12:48.553Z",
    outcome: "Voicemail",
    totalSeconds: 74,
    transcript: "Skipped",
  });
  await seedCall({
    id: "south-assessed",
    workspaceId: "south",
    trackingNumber: "+14155550127",
    callerNumber: "+818055501977",
    startedAt: "2026-10-11T23:58:41.096Z",
    outcome: "Answered",
    totalSeconds: 146,
    connectedSeconds: 131,
    transcript: "Completed",
    assessment: { classification: "Uncertain", score: 58 },
  });
  await seedCall({ id: "south-after-week", workspaceId: "south", trackingNumber: "+14155550127", callerNumber: "+818055501903", startedAt: "2026-10-12T06:00:00.004Z", outcome: "Missed", totalSeconds: 11 });
  await seedCall({
    id: "north-expired",
    workspaceId: "north",
    trackingNumber: "+14155550113",
    callerNumber: "+12125550133",
    startedAt: "2025-09-17T14:03:52.781Z",
    outcome: "Answered",
    totalSeconds: 208,
    connectedSeconds: 196,
    transcript: "Completed",
    assessment: { classification: "Good Lead", score: 91 },
  });
  await seedCall({ id: "south-late", workspaceId: "south", trackingNumber: "+14155550127", callerNumber: "+818055501918", startedAt: "2026-10-12T20:30:17.482Z", outcome: "Missed", totalSeconds: 37 });
  await seedCall({ id: "west-answered", workspaceId: "west", trackingNumber: "+14155550139", callerNumber: "+13105550148", startedAt: "2026-10-07T18:22:09.731Z", outcome: "Answered", totalSeconds: 95, connectedSeconds: 88 });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe("Report CSV generation", () => {
  it("writes every Call started in the period across the job's Workspaces with start times in the document timezone and Lead Review precedence", async () => {
    const job = await create({ kind: "report", scope: { kind: "global", workspaceIds: ["north", "south"], timeZone: "America/Denver" }, period: { kind: "previousWeek" }, files: ["csv"] });
    const r2 = fakeR2();

    await generate(r2, job.id);

    const key = `reports/${job.id}/calls.csv`;
    expect(r2.puts).toEqual([key]);
    expect(r2.objects.get(key)?.contentType).toBe("text/csv; charset=utf-8");
    expect(text(r2, key)).toBe(
      header +
        "north-week-start,North Plumbing,+14155550113,+12125550171,2026-10-05T00:00:03-06:00,Missed,19,0,None,,No,Unavailable,Unavailable\r\n" +
        "north-reviewed,North Plumbing,+14155550113,+12125550187,2026-10-06T09:47:31-06:00,Answered,317,283,Not Good Lead,37,Yes,Ready,Available\r\n" +
        `south-voicemail,"South Roofing, Inc.",+14155550127,+818055501942,2026-10-08T19:12:48-06:00,Voicemail,74,0,None,,No,Ready,Skipped\r\n` +
        `south-assessed,"South Roofing, Inc.",+14155550127,+818055501977,2026-10-11T17:58:41-06:00,Answered,146,131,Uncertain,58,No,Ready,Available\r\n`,
    );
    const stored = await pool!.query("select status, completed_at, artifacts_expire_at from report_job where id = $1", [job.id]);
    expect(stored.rows[0]).toEqual({ status: "Completed", completed_at: new Date("2026-10-14T15:41:27.906Z"), artifacts_expire_at: new Date("2026-10-21T15:41:27.906Z") });
    const artifacts = await pool!.query("select file_kind, r2_key, byte_size::int as byte_size, content_type from report_artifact where job_id = $1", [job.id]);
    expect(artifacts.rows).toEqual([{ file_kind: "csv", r2_key: key, byte_size: r2.objects.get(key)!.bytes.byteLength, content_type: "text/csv; charset=utf-8" }]);
  });

  it("writes a filtered Calls export from only the job's Workspaces even when the filters name another Workspace", async () => {
    const job = await create({
      kind: "call_export",
      scope: { kind: "workspace", workspaceId: "north" },
      selection: { kind: "filters", filters: { ...emptyCallFilters, workspaceIds: ["north", "west"], outcomes: ["Answered"] } },
      file: "csv",
    });
    const r2 = fakeR2();

    await generate(r2, job.id);

    expect(text(r2, `reports/${job.id}/calls.csv`)).toBe(
      header +
        "north-expired,North Plumbing,+14155550113,+12125550133,2025-09-17T10:03:52-04:00,Answered,208,196,Good Lead,91,No,Expired,Expired\r\n" +
        "north-reviewed,North Plumbing,+14155550113,+12125550187,2026-10-06T11:47:31-04:00,Answered,317,283,Not Good Lead,37,Yes,Ready,Available\r\n",
    );
    expect((await pool!.query("select status from report_job where id = $1", [job.id])).rows[0].status).toBe("Completed");
  });

  it("writes one selected Call, and refuses to queue an export of a Call outside the job's Workspaces", async () => {
    const r2 = fakeR2();
    const own = await create({ kind: "call_export", scope: { kind: "workspace", workspaceId: "south" }, selection: { kind: "call", callId: "south-voicemail" }, file: "csv" });

    await generate(r2, own.id);

    expect(text(r2, `reports/${own.id}/calls.csv`)).toBe(
      header + `south-voicemail,"South Roofing, Inc.",+14155550127,+818055501942,2026-10-09T10:12:48+09:00,Voicemail,74,0,None,,No,Ready,Skipped\r\n`,
    );
    await expect(create({ kind: "call_export", scope: { kind: "workspace", workspaceId: "south" }, selection: { kind: "call", callId: "west-answered" }, file: "csv" })).rejects.toEqual(
      new ReportRequestError("no_matching_calls"),
    );
  });

  it("leaves a Completed job and its artifact unchanged when Trigger.dev delivers the run again", async () => {
    const job = await create({ kind: "report", scope: { kind: "workspace", workspaceId: "north" }, period: { kind: "all" }, files: ["csv"] });
    const r2 = fakeR2();
    await generate(r2, job.id);
    const first = text(r2, `reports/${job.id}/calls.csv`);

    await generateReportJob({ pool: pool!, objects: r2, now: () => new Date("2026-10-14T16:02:51.337Z") }, job.id);

    expect(r2.puts).toEqual([`reports/${job.id}/calls.csv`]);
    expect(text(r2, `reports/${job.id}/calls.csv`)).toBe(first);
    expect(first.split("\r\n").map((line) => line.split(",")[0]).slice(1, -1)).toEqual(["north-expired", "north-before-week", "north-week-start", "north-reviewed"]);
    expect((await pool!.query("select completed_at from report_job where id = $1", [job.id])).rows[0].completed_at).toEqual(new Date("2026-10-14T15:41:27.906Z"));
    expect((await pool!.query("select count(*)::int as count from report_artifact where job_id = $1", [job.id])).rows[0].count).toBe(1);
  });

  it("keeps a job Generating when the upload fails and completes it on the rerun by overwriting the same key", async () => {
    const job = await create({ kind: "report", scope: { kind: "workspace", workspaceId: "south" }, period: { kind: "previousWeek" }, files: ["csv"] });
    const r2 = fakeR2();
    r2.putFailure = new R2ObjectError(503);

    await expect(generate(r2, job.id)).rejects.toEqual(new R2ObjectError(503));
    expect((await pool!.query("select status from report_job where id = $1", [job.id])).rows[0].status).toBe("Generating");

    r2.putFailure = null;
    await generate(r2, job.id);

    expect(r2.puts).toEqual([`reports/${job.id}/calls.csv`, `reports/${job.id}/calls.csv`]);
    expect(text(r2, `reports/${job.id}/calls.csv`)).toBe(
      header + `south-voicemail,"South Roofing, Inc.",+14155550127,+818055501942,2026-10-09T10:12:48+09:00,Voicemail,74,0,None,,No,Ready,Skipped\r\n`,
    );
    expect((await pool!.query("select status from report_job where id = $1", [job.id])).rows[0].status).toBe("Completed");
  });

  it("records a concise failure reason once retries are exhausted, after which a late rerun changes nothing", async () => {
    const job = await create({ kind: "call_export", scope: { kind: "workspace", workspaceId: "north" }, selection: { kind: "call", callId: "north-reviewed" }, file: "csv" });
    const r2 = fakeR2();
    r2.putFailure = new R2ObjectError(503);
    const error = await generate(r2, job.id).catch((value: unknown) => value);

    await recordReportGenerationFailure(pool!, job.id, error);
    await recordReportGenerationFailure(pool!, (await create({ kind: "report", scope: { kind: "workspace", workspaceId: "south" }, period: { kind: "all" }, files: ["csv"] })).id, new Error("connection string postgres://secret"));
    r2.putFailure = null;
    await generate(r2, job.id);

    expect((await pool!.query("select status, failure_reason from report_job where id = $1", [job.id])).rows[0]).toEqual({ status: "Failed", failure_reason: "R2 request failed (HTTP 503)" });
    expect((await pool!.query("select failure_reason from report_job where kind = 'report' and status = 'Failed'")).rows).toEqual([{ failure_reason: "Report generation failed" }]);
    expect(r2.puts).toEqual([`reports/${job.id}/calls.csv`]);
    expect((await pool!.query("select count(*)::int as count from report_artifact where job_id = $1", [job.id])).rows[0].count).toBe(0);
  });

  it("completes a PDF and CSV report only once both files exist, with the PDF naming its Workspaces, period, timezone, and Total Calls", async () => {
    const job = await create({ kind: "report", scope: { kind: "global", workspaceIds: ["north", "south"], timeZone: "America/Denver" }, period: { kind: "previousWeek" }, files: ["pdf", "csv"] });
    const r2 = fakeR2();

    await generate(r2, job.id);

    const pdfKey = `reports/${job.id}/report.pdf`;
    const csvKey = `reports/${job.id}/calls.csv`;
    expect([...r2.objects.keys()].sort()).toEqual([csvKey, pdfKey]);
    const pdf = r2.objects.get(pdfKey)!;
    expect(pdf.contentType).toBe("application/pdf");
    expect(new TextDecoder().decode(pdf.bytes.subarray(0, 5))).toBe("%PDF-");
    const pages = await pdfText(pdf.bytes);
    expect(pages[0]).toContain("North Plumbing");
    expect(pages[0]).toContain("South Roofing, Inc.");
    expect(pages[0]).toContain("Previous Week");
    expect(pages[0]).toContain("Oct 5, 2026 - Oct 11, 2026");
    expect(pages[0]).toContain("America/Denver");
    expect(pages[1]).toContain("Combined summary");
    expect(pages[1]).toContain("Total Calls 4");
    expect(pages.join("\n")).toContain("Lead Assessment (estimate)");
    expect((await pool!.query("select status from report_job where id = $1", [job.id])).rows[0].status).toBe("Completed");
    const artifacts = await pool!.query("select file_kind, r2_key, byte_size::int as byte_size, content_type from report_artifact where job_id = $1 order by file_kind", [job.id]);
    expect(artifacts.rows).toEqual([
      { file_kind: "csv", r2_key: csvKey, byte_size: r2.objects.get(csvKey)!.bytes.byteLength, content_type: "text/csv; charset=utf-8" },
      { file_kind: "pdf", r2_key: pdfKey, byte_size: pdf.bytes.byteLength, content_type: "application/pdf" },
    ]);
  });

  it("completes a PDF-only single-Workspace report with just its PDF, titled by the Workspace and without a Workspace comparison", async () => {
    const job = await create({ kind: "report", scope: { kind: "workspace", workspaceId: "north" }, period: { kind: "all" }, files: ["pdf"] });
    const r2 = fakeR2();

    await generate(r2, job.id);

    expect(r2.puts).toEqual([`reports/${job.id}/report.pdf`]);
    const pages = await pdfText(r2.objects.get(`reports/${job.id}/report.pdf`)!.bytes);
    expect(pages[0]).toContain("All Time");
    expect(pages[0]).toContain("America/New_York");
    expect(pages[1]).toContain("North Plumbing");
    expect(pages[1]).toContain("Total Calls 4");
    expect(pages.join("\n")).not.toContain("Workspace comparison");
    expect((await pool!.query("select file_kind from report_artifact where job_id = $1", [job.id])).rows).toEqual([{ file_kind: "pdf" }]);
    expect((await pool!.query("select status from report_job where id = $1", [job.id])).rows[0].status).toBe("Completed");
  });

  it("keeps a PDF report Generating when its upload fails and completes it on the rerun by overwriting the same key", async () => {
    const job = await create({ kind: "report", scope: { kind: "workspace", workspaceId: "south" }, period: { kind: "previousWeek" }, files: ["pdf"] });
    const r2 = fakeR2();
    r2.putFailure = new R2ObjectError(503);

    await expect(generate(r2, job.id)).rejects.toEqual(new R2ObjectError(503));
    expect((await pool!.query("select status from report_job where id = $1", [job.id])).rows[0].status).toBe("Generating");

    r2.putFailure = null;
    await generate(r2, job.id);

    expect(r2.puts).toEqual([`reports/${job.id}/report.pdf`, `reports/${job.id}/report.pdf`]);
    expect((await pool!.query("select status from report_job where id = $1", [job.id])).rows[0].status).toBe("Completed");
    expect((await pool!.query("select count(*)::int as count from report_artifact where job_id = $1", [job.id])).rows[0].count).toBe(1);
  });

  it("uses the requester's account timezone for a global Calls export, as global Calls does, even for one Workspace", async () => {
    const job = await create({
      kind: "call_export",
      scope: { kind: "global", workspaceIds: ["south"] },
      selection: { kind: "filters", filters: { ...emptyCallFilters, startedFrom: "2026-10-12", startedTo: "2026-10-12" } },
      file: "csv",
    });
    const r2 = fakeR2();

    await generate(r2, job.id);

    expect(job.timeZone).toBe("Europe/Berlin");
    expect((await pool!.query("select time_zone from report_job where id = $1", [job.id])).rows[0].time_zone).toBe("Europe/Berlin");
    expect(text(r2, `reports/${job.id}/calls.csv`)).toBe(
      header +
        `south-assessed,"South Roofing, Inc.",+14155550127,+818055501977,2026-10-12T01:58:41+02:00,Answered,146,131,Uncertain,58,No,Ready,Available\r\n` +
        `south-after-week,"South Roofing, Inc.",+14155550127,+818055501903,2026-10-12T08:00:00+02:00,Missed,11,0,None,,No,Unavailable,Unavailable\r\n` +
        `south-late,"South Roofing, Inc.",+14155550127,+818055501918,2026-10-12T22:30:17+02:00,Missed,37,0,None,,No,Unavailable,Unavailable\r\n`,
    );
  });
});
