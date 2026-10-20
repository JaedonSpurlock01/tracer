/**
 * -------------------------------------------------------------------------
 * @file   recording-export.test.ts
 * @brief  Verifies the Recording export preview, its limits, and Recording ZIP generation.
 *
 * @description
 *  Runs against a real PostgreSQL database with a fake private R2 boundary.
 *  Checks the export preview counts of matched Calls, retained Recordings,
 *  expired media, Calls without a Recording, and Recordings still
 *  processing or failed; that a Recording ZIP above 500 retained
 *  Recordings or with none is rejected before a job is recorded while a
 *  Calls CSV is not capped; that a report or export matching no Calls is
 *  rejected; and that the ZIP holds one MP3 per retained Recording under
 *  deterministic names beside a manifest that counts and names every
 *  omitted Recording, only from the job's Workspaces. A single-Call Export
 *  Call adds its Transcript and Lead Assessment. A job's Calls are frozen
 *  at its request time, so later Calls never join it. A rerun aborts the stale
 *  multipart upload and restarts, and a failure aborts the upload.
 *
 * @remarks
 *  Jobs are created through the report job domain so their parameters and
 *  limits are real. Call instants and MP3 bytes are fixed, non-round
 *  fixture data, and a small page size makes generation walk several
 *  pages. The archive is read back with the dev-only fflate reader.
 *
 * @see
 *  data/report-jobs.ts
 *  data/report-selection.ts
 *  data/report-generation.ts
 *  data/zip-writer.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createHash } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { unzipSync } from "fflate";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Actor } from "@/data/authorization";
import { generateInitialCallFlow } from "@/data/call-flow";
import { emptyCallFilters } from "@/data/call-list-query";
import { migrateDatabase } from "@/data/migrate";
import { R2ObjectError, type ArtifactObjects, type MultipartUpload, type StoredObject } from "@/data/r2-objects";
import { generateReportJob, recordReportGenerationFailure } from "@/data/report-generation";
import { createReportJob, previewReportJob, type ReportJobRequest } from "@/data/report-jobs";
import { ReportRequestError } from "@/data/report-request";
import { createReadableWorkspaces } from "@/data/workspace-authorization";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;

const requestedAt = new Date("2026-10-14T15:37:12.418Z");

const viewer: Actor = { userId: "export-viewer", organizationId: "fleet", role: "Client Viewer", timezone: "Europe/Berlin", name: "Export Viewer", email: "export-viewer@example.com", state: "Active" };

const graph = generateInitialCallFlow({ destinationNumber: "+14155550199", recordingEnabled: true, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });

const create = async (request: ReportJobRequest) => (await createReportJob(pool!, viewer, createReadableWorkspaces(pool!, viewer), request, requestedAt)).job;

const jobCount = async () => (await pool!.query<{ count: number }>("select count(*)::int as count from report_job")).rows[0].count;

interface FakeR2 extends ArtifactObjects {
  objects: Map<string, { bytes: Uint8Array; contentType: string }>;
  uploads: Array<{ key: string; state: "Open" | "Completed" | "Aborted" }>;
  staleAborts: string[];
  getFailure: Error | null;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  chunks.reduce((offset, chunk) => (bytes.set(chunk, offset), offset + chunk.byteLength), 0);
  return bytes;
}

function fakeR2(): FakeR2 {
  const r2: FakeR2 = {
    objects: new Map(),
    uploads: [],
    staleAborts: [],
    getFailure: null,
    async head(key): Promise<StoredObject | null> {
      const object = r2.objects.get(key);
      return object ? { sizeBytes: object.bytes.byteLength, sha256: createHash("sha256").update(object.bytes).digest("hex") } : null;
    },
    async put(key, body, _object, contentType = "audio/wav") {
      r2.objects.set(key, { bytes: body, contentType });
    },
    async get(key) {
      if (r2.getFailure) throw r2.getFailure;
      return r2.objects.get(key)?.bytes ?? null;
    },
    async createMultipartUpload(key, contentType): Promise<MultipartUpload> {
      const upload = { key, state: "Open" as FakeR2["uploads"][number]["state"] };
      r2.uploads.push(upload);
      const chunks: Uint8Array[] = [];
      return {
        async write(chunk) {
          chunks.push(chunk.slice());
        },
        async complete() {
          const bytes = concat(chunks);
          r2.objects.set(key, { bytes, contentType });
          upload.state = "Completed";
          return { sizeBytes: bytes.byteLength };
        },
        async abort() {
          upload.state = "Aborted";
        },
      };
    },
    async abortMultipartUploads(key) {
      r2.staleAborts.push(key);
    },
    async delete(key) {
      r2.objects.delete(key);
    },
  };
  for (const callId of ["north-expired", "north-reviewed", "north-voicemail", "south-answered", "west-answered"]) r2.objects.set(`recordings/${callId}.mp3`, { bytes: mp3Bytes(callId), contentType: "audio/mpeg" });
  return r2;
}

const generatedAt = new Date("2026-10-14T15:41:27.906Z");

const generate = (r2: FakeR2, jobId: string) => generateReportJob({ pool: pool!, objects: r2, now: () => generatedAt, pageSize: 2 }, jobId);

const archive = (r2: FakeR2, jobId: string) => unzipSync(r2.objects.get(`reports/${jobId}/recordings.zip`)!.bytes);

const manifestHeader =
  "\uFEFFCall ID,Workspace,Tracking Number Dialed,Caller Number,Started At,Call Outcome,Total Duration Seconds,Connected Duration Seconds,Effective Lead Classification,AI Lead Score,Lead Review,Recording Availability,Transcript Availability,Recording File,Recording Export\r\n";

const decode = (bytes: Uint8Array | undefined) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

const preview = (request: ReportJobRequest) => previewReportJob(pool!, viewer, createReadableWorkspaces(pool!, viewer), request, requestedAt);

const mp3Bytes = (callId: string) => Uint8Array.from({ length: 1_237 + callId.length * 17 }, (_, index) => (index * 29 + callId.charCodeAt(index % callId.length)) % 256);

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

type RecordingFixture = "retained" | "transferring" | "mp3Pending" | "transferFailed" | "mp3Failed";

interface SeedCall {
  id: string;
  workspaceId: string;
  startedAt: string;
  outcome: "Answered" | "Voicemail" | "Missed";
  recording?: RecordingFixture;
}

let seeded = 0;

async function seedCall(input: SeedCall): Promise<void> {
  seeded += 1;
  const trackingNumber = (await pool!.query("select phone_number from number_assignment where workspace_id = $1", [input.workspaceId])).rows[0].phone_number;
  await pool!.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, caller_number,
                       state, outcome, outcome_reason, started_at, answered_at, ended_at, duration_seconds, created_at, updated_at)
     values ($1, 'fleet', $2, $3, $4, $5, $6, $7, 'Completed', $8, 'flow_outcome', $9::timestamptz,
             case when $8 = 'Answered' then $9::timestamptz + interval '6 seconds' end, $9::timestamptz + interval '143 seconds', 143, now(), now())`,
    [input.id, input.workspaceId, `${input.workspaceId}-assignment`, `${input.workspaceId}-flow`, `CA${String(seeded).padStart(32, "0")}`, trackingNumber, `+1212555${String(1000 + seeded).slice(-4)}`, input.outcome, input.startedAt],
  );
  if (!input.recording) return;
  const transfer = input.recording === "transferring" ? "Pending" : input.recording === "transferFailed" ? "Failed" : "Stored";
  const mp3 = input.recording === "retained" ? "Stored" : input.recording === "mp3Failed" ? "Failed" : "Pending";
  await pool!.query(
    `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, transfer_state,
                            r2_object_key, size_bytes, sha256, stored_at, waveform_state, waveform_object_key, waveform_generated_at,
                            mp3_state, mp3_object_key, mp3_size_bytes, mp3_generated_at, created_at, updated_at)
     values ($1, 'fleet', $2, $3, $4, $5, 2, 137, $6,
             case when $6 = 'Stored' then $7 || '.wav' end, case when $6 = 'Stored' then 22_027 end, case when $6 = 'Stored' then 'checksum' end, case when $6 = 'Stored' then now() end,
             case when $6 = 'Stored' then 'Stored' else 'Pending' end, case when $6 = 'Stored' then $7 || '.peaks.json' end, case when $6 = 'Stored' then now() end,
             $8, case when $8 = 'Stored' then $7 || '.mp3' end, case when $8 = 'Stored' then $9::bigint end, case when $8 = 'Stored' then now() end, now(), now())`,
    [`${input.id}-recording`, input.workspaceId, input.id, `RE${String(seeded).padStart(32, "0")}`, input.outcome === "Voicemail" ? "voicemail" : "connected", transfer, `recordings/${input.id}`, mp3, mp3Bytes(input.id).byteLength],
  );
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrateDatabase(container.getConnectionUri());
  await pool.query("insert into organization (id, name, slug, created_at) values ('fleet', 'fleet', 'fleet', now())");
  await seedWorkspace("north", "North Plumbing", "America/New_York", "+14155550113");
  await seedWorkspace("south", "South Roofing", "Asia/Tokyo", "+14155550127");
  await seedWorkspace("west", "West Electric", "America/Los_Angeles", "+14155550139");
  await seedWorkspace("bulk", "Bulk Moving", "America/Chicago", "+14155550151");
  await pool.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, caller_number,
                       state, outcome, outcome_reason, started_at, answered_at, ended_at, duration_seconds, created_at, updated_at)
     select 'bulk-' || n, 'fleet', 'bulk', 'bulk-assignment', 'bulk-flow', 'CABULK' || lpad(n::text, 28, '0'), '+14155550151', '+13125550' || lpad(n::text, 3, '0'),
            'Completed', case when n = 317 then 'Voicemail' else 'Answered' end, 'flow_outcome', started, started + interval '4 seconds', started + interval '97 seconds', 97, now(), now()
       from generate_series(1, 501) as n, lateral (select timestamptz '2026-08-03T09:17:23.461Z' + n * interval '1 hour 13 minutes' as started) s`,
  );
  await pool.query(
    `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, transfer_state, r2_object_key, size_bytes, sha256, stored_at,
                            waveform_state, waveform_object_key, waveform_generated_at, mp3_state, mp3_object_key, mp3_size_bytes, mp3_generated_at, created_at, updated_at)
     select c.id || '-recording', 'fleet', 'bulk', c.id, 'REBULK' || c.id, 'connected', 2, 91, 'Stored', 'recordings/' || c.id || '.wav', 14_221, 'checksum', now(),
            'Stored', 'recordings/' || c.id || '.peaks.json', now(), 'Stored', 'recordings/' || c.id || '.mp3', 731_903, now(), now(), now()
       from call c where c.workspace_id = 'bulk'`,
  );
  await pool.query(`insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at) values ('export-viewer', 'Export Viewer', 'export-viewer@example.com', true, 'Active', 'Europe/Berlin', now(), now())`);
  for (const workspaceId of ["north", "south", "bulk"]) {
    await pool.query("insert into access_grant (id, organization_id, workspace_id, user_id, created_at) values ($1, 'fleet', $2, 'export-viewer', now())", [`grant-${workspaceId}`, workspaceId]);
  }
  await seedCall({ id: "north-expired", workspaceId: "north", startedAt: "2025-08-14T16:27:53.902Z", outcome: "Answered", recording: "retained" });
  await seedCall({ id: "north-reviewed", workspaceId: "north", startedAt: "2026-09-21T14:12:37.418Z", outcome: "Answered", recording: "retained" });
  await pool.query(
    `update recording set transcript_state = 'Completed', transcript_audio_ms = 137_000, transcript_cost_usd = 0.0137, transcript_completed_at = now(), lead_assessment_state = 'Completed'
      where id = 'north-reviewed-recording'`,
  );
  await pool.query("insert into transcript (recording_id, organization_id, call_id, turns, model, created_at) values ('north-reviewed-recording', 'fleet', 'north-reviewed', $1, 'whisper-1', now())", [
    JSON.stringify([
      { speaker: "Caller", startMs: 1_240, endMs: 6_815, text: "Hi, my water heater is leaking into the garage." },
      { speaker: "Business", startMs: 7_302, endMs: 11_987, text: "We can send someone this afternoon." },
      { speaker: "Caller", startMs: 3_663_418, endMs: 3_666_051, text: "Great, the address is 41 Maple Court." },
    ]),
  ]);
  await pool.query(
    `insert into lead_assessment (id, organization_id, call_id, recording_id, classification, score, summary, rationale, model, input_tokens, output_tokens, cost_usd, processed_at)
     values ('north-reviewed-assessment', 'fleet', 'north-reviewed', 'north-reviewed-recording', 'Good Lead', 83, 'Caller needs a leaking water heater repaired today.', 'Urgent, in-area service request.', 'gpt-5-mini', 912, 137, 0.000502, '2026-09-21T14:19:52.731Z')`,
  );
  await pool.query("insert into lead_assessment_evidence (lead_assessment_id, position, turn_index, start_ms, quote) values ('north-reviewed-assessment', 0, 0, 1240, 'my water heater is leaking')");
  await pool.query(
    "insert into lead_review (call_id, organization_id, classification, note, reviewer_user_id, reviewed_at) values ('north-reviewed', 'fleet', 'Not Good Lead', 'Caller was a supplier, not a customer.', 'export-viewer', '2026-09-22T08:03:17.592Z')",
  );
  await seedCall({ id: "north-missed", workspaceId: "north", startedAt: "2026-09-22T11:05:19.664Z", outcome: "Missed" });
  await seedCall({ id: "north-voicemail", workspaceId: "north", startedAt: "2026-09-23T19:48:05.271Z", outcome: "Voicemail", recording: "retained" });
  await seedCall({ id: "north-transferring", workspaceId: "north", startedAt: "2026-09-24T13:31:46.105Z", outcome: "Answered", recording: "transferring" });
  await seedCall({ id: "north-encoding", workspaceId: "north", startedAt: "2026-09-25T15:02:11.587Z", outcome: "Answered", recording: "mp3Pending" });
  await seedCall({ id: "north-transfer-failed", workspaceId: "north", startedAt: "2026-09-26T17:44:58.033Z", outcome: "Answered", recording: "transferFailed" });
  await seedCall({ id: "north-encoding-failed", workspaceId: "north", startedAt: "2026-09-26T20:09:14.276Z", outcome: "Answered", recording: "mp3Failed" });
  await seedCall({ id: "north-vanished", workspaceId: "north", startedAt: "2026-09-27T12:19:33.749Z", outcome: "Answered", recording: "retained" });
  await seedCall({ id: "south-answered", workspaceId: "south", startedAt: "2026-09-28T02:16:41.358Z", outcome: "Answered", recording: "retained" });
  await seedCall({ id: "west-answered", workspaceId: "west", startedAt: "2026-09-29T21:53:07.926Z", outcome: "Answered", recording: "retained" });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe("Recording export preview", () => {
  it("counts matched Calls, retained Recordings, expired media, Calls without a Recording, and Recordings still processing or failed", async () => {
    await expect(preview({ kind: "call_export", scope: { kind: "workspace", workspaceId: "north" }, selection: { kind: "filters", filters: emptyCallFilters }, file: "zip" })).resolves.toEqual({
      matchedCalls: 9,
      retainedRecordings: 3,
      expiredMedia: 1,
      callsWithoutRecording: 1,
      processingRecordings: 2,
      failedRecordings: 2,
    });
  });
});

describe("Recording export limits", () => {
  it("rejects a Recording ZIP above 500 retained Recordings before recording a job, and accepts exactly 500", async () => {
    const before = await jobCount();
    await expect(create({ kind: "call_export", scope: { kind: "workspace", workspaceId: "bulk" }, selection: { kind: "filters", filters: emptyCallFilters }, file: "zip" })).rejects.toEqual(
      new ReportRequestError("export_too_large"),
    );
    expect(await jobCount()).toBe(before);

    const answered = await create({ kind: "call_export", scope: { kind: "workspace", workspaceId: "bulk" }, selection: { kind: "filters", filters: { ...emptyCallFilters, outcomes: ["Answered"] } }, file: "zip" });
    expect(answered.status).toBe("Queued");
  });

  it("rejects a Recording ZIP whose matched Calls have no retained Recording before recording a job", async () => {
    const before = await jobCount();
    await expect(create({ kind: "call_export", scope: { kind: "workspace", workspaceId: "north" }, selection: { kind: "call", callId: "north-expired" }, file: "zip" })).rejects.toEqual(
      new ReportRequestError("no_recordings"),
    );
    await expect(
      create({ kind: "call_export", scope: { kind: "workspace", workspaceId: "north" }, selection: { kind: "filters", filters: { ...emptyCallFilters, outcomes: ["Missed"] } }, file: "zip" }),
    ).rejects.toEqual(new ReportRequestError("no_recordings"));
    expect(await jobCount()).toBe(before);
  });

  it("does not cap a Calls CSV export of the same selection", async () => {
    const csv = await create({ kind: "call_export", scope: { kind: "workspace", workspaceId: "bulk" }, selection: { kind: "filters", filters: emptyCallFilters }, file: "csv" });
    expect(csv.status).toBe("Queued");
  });
});

describe("No matching Calls", () => {
  it("rejects a report, a Calls CSV export, or a Recording ZIP that matches no Calls in its Workspaces before recording a job", async () => {
    const before = await jobCount();
    const empty = new ReportRequestError("no_matching_calls");
    await expect(create({ kind: "report", scope: { kind: "workspace", workspaceId: "south" }, period: { kind: "custom", from: "2026-07-06", to: "2026-07-19" }, files: ["pdf", "csv"] })).rejects.toEqual(empty);
    await expect(create({ kind: "call_export", scope: { kind: "workspace", workspaceId: "south" }, selection: { kind: "call", callId: "west-answered" }, file: "csv" })).rejects.toEqual(empty);
    await expect(
      create({ kind: "call_export", scope: { kind: "global", workspaceIds: ["north", "south"] }, selection: { kind: "filters", filters: { ...emptyCallFilters, outcomes: ["Blocked"] } }, file: "zip" }),
    ).rejects.toEqual(empty);
    expect(await jobCount()).toBe(before);
  });
});

describe("Recording ZIP generation", () => {
  it("stores one MP3 per retained Recording under deterministic names beside a manifest that counts and names every omitted Recording", async () => {
    const job = await create({ kind: "call_export", scope: { kind: "workspace", workspaceId: "north" }, selection: { kind: "filters", filters: emptyCallFilters }, file: "zip" });
    const r2 = fakeR2();

    await generate(r2, job.id);

    const key = `reports/${job.id}/recordings.zip`;
    expect(r2.staleAborts).toEqual([key]);
    expect(r2.uploads).toEqual([{ key, state: "Completed" }]);
    expect(r2.objects.get(key)?.contentType).toBe("application/zip");
    const files = archive(r2, job.id);
    expect(Object.keys(files).sort()).toEqual(["manifest.csv", "recordings/20260921-101237_north-reviewed.mp3", "recordings/20260923-154805_north-voicemail.mp3"]);
    expect(files["recordings/20260921-101237_north-reviewed.mp3"]).toEqual(mp3Bytes("north-reviewed"));
    expect(files["recordings/20260923-154805_north-voicemail.mp3"]).toEqual(mp3Bytes("north-voicemail"));
    expect(decode(files["manifest.csv"])).toBe(
      manifestHeader +
        "north-expired,North Plumbing,+14155550113,+12125551001,2025-08-14T12:27:53-04:00,Answered,143,137,None,,No,Expired,Unavailable,,Expired\r\n" +
        "north-reviewed,North Plumbing,+14155550113,+12125551002,2026-09-21T10:12:37-04:00,Answered,143,137,Not Good Lead,83,Yes,Ready,Available,recordings/20260921-101237_north-reviewed.mp3,Included\r\n" +
        "north-missed,North Plumbing,+14155550113,+12125551003,2026-09-22T07:05:19-04:00,Missed,143,0,None,,No,Unavailable,Unavailable,,No Recording\r\n" +
        "north-voicemail,North Plumbing,+14155550113,+12125551004,2026-09-23T15:48:05-04:00,Voicemail,143,0,None,,No,Ready,Unavailable,recordings/20260923-154805_north-voicemail.mp3,Included\r\n" +
        "north-transferring,North Plumbing,+14155550113,+12125551005,2026-09-24T09:31:46-04:00,Answered,143,137,None,,No,Processing,Unavailable,,Processing\r\n" +
        "north-encoding,North Plumbing,+14155550113,+12125551006,2026-09-25T11:02:11-04:00,Answered,143,137,None,,No,Ready,Unavailable,,Processing\r\n" +
        "north-transfer-failed,North Plumbing,+14155550113,+12125551007,2026-09-26T13:44:58-04:00,Answered,143,137,None,,No,Failed,Unavailable,,Failed\r\n" +
        "north-encoding-failed,North Plumbing,+14155550113,+12125551008,2026-09-26T16:09:14-04:00,Answered,143,137,None,,No,Ready,Unavailable,,Failed\r\n" +
        "north-vanished,North Plumbing,+14155550113,+12125551009,2026-09-27T08:19:33-04:00,Answered,143,137,None,,No,Ready,Unavailable,,Missing\r\n",
    );
    expect((await pool!.query("select status, completed_at from report_job where id = $1", [job.id])).rows[0]).toEqual({ status: "Completed", completed_at: generatedAt });
    const artifacts = await pool!.query("select file_kind, r2_key, byte_size::int as byte_size, content_type from report_artifact where job_id = $1", [job.id]);
    expect(artifacts.rows).toEqual([{ file_kind: "zip", r2_key: key, byte_size: r2.objects.get(key)!.bytes.byteLength, content_type: "application/zip" }]);
  });

  it("adds the Transcript with speaker-labeled timestamped turns and the Lead Assessment with its Lead Review to a single-Call Export Call", async () => {
    const job = await create({ kind: "call_export", scope: { kind: "workspace", workspaceId: "north" }, selection: { kind: "call", callId: "north-reviewed" }, file: "zip" });
    const r2 = fakeR2();

    await generate(r2, job.id);

    const files = archive(r2, job.id);
    expect(Object.keys(files).sort()).toEqual(["lead-assessment.json", "manifest.csv", "recordings/20260921-101237_north-reviewed.mp3", "transcript.txt"]);
    expect(files["recordings/20260921-101237_north-reviewed.mp3"]).toEqual(mp3Bytes("north-reviewed"));
    expect(decode(files["manifest.csv"])).toBe(
      manifestHeader +
        "north-reviewed,North Plumbing,+14155550113,+12125551002,2026-09-21T10:12:37-04:00,Answered,143,137,Not Good Lead,83,Yes,Ready,Available,recordings/20260921-101237_north-reviewed.mp3,Included\r\n",
    );
    expect(decode(files["transcript.txt"])).toBe(
      "[00:00:01] Caller: Hi, my water heater is leaking into the garage.\n" +
        "[00:00:07] Business: We can send someone this afternoon.\n" +
        "[01:01:03] Caller: Great, the address is 41 Maple Court.\n",
    );
    expect(JSON.parse(decode(files["lead-assessment.json"]))).toEqual({
      callId: "north-reviewed",
      effectiveLeadClassification: { classification: "Not Good Lead", source: "review" },
      leadAssessment: {
        classification: "Good Lead",
        score: 83,
        summary: "Caller needs a leaking water heater repaired today.",
        rationale: "Urgent, in-area service request.",
        processedAt: "2026-09-21T14:19:52.731Z",
        evidence: [{ turnIndex: 0, startMs: 1240, quote: "my water heater is leaking" }],
      },
      leadReview: { classification: "Not Good Lead", note: "Caller was a supplier, not a customer.", reviewerName: "Export Viewer", reviewedAt: "2026-09-22T08:03:17.592Z" },
    });
  });

  it("holds only the MP3 and manifest for a single-Call Export Call without a Transcript or Lead Assessment", async () => {
    const job = await create({ kind: "call_export", scope: { kind: "workspace", workspaceId: "north" }, selection: { kind: "call", callId: "north-voicemail" }, file: "zip" });
    const r2 = fakeR2();

    await generate(r2, job.id);

    expect(Object.keys(archive(r2, job.id)).sort()).toEqual(["manifest.csv", "recordings/20260923-154805_north-voicemail.mp3"]);
  });

  it("includes Recordings from only the job's Workspaces even when the export filters name another Workspace", async () => {
    const job = await create({
      kind: "call_export",
      scope: { kind: "global", workspaceIds: ["north", "south"] },
      selection: { kind: "filters", filters: { ...emptyCallFilters, workspaceIds: ["south", "west"] } },
      file: "zip",
    });
    const r2 = fakeR2();

    await generate(r2, job.id);

    const files = archive(r2, job.id);
    expect(Object.keys(files).sort()).toEqual(["manifest.csv", "recordings/20260928-041641_south-answered.mp3"]);
    expect(decode(files["manifest.csv"])).toBe(
      manifestHeader + "south-answered,South Roofing,+14155550127,+12125551010,2026-09-28T04:16:41+02:00,Answered,143,137,None,,No,Ready,Unavailable,recordings/20260928-041641_south-answered.mp3,Included\r\n",
    );
  });

  it("aborts the multipart upload when a Recording read fails, keeps the job Generating, and restarts cleanly on the rerun", async () => {
    const job = await create({ kind: "call_export", scope: { kind: "workspace", workspaceId: "north" }, selection: { kind: "filters", filters: { ...emptyCallFilters, outcomes: ["Voicemail"] } }, file: "zip" });
    const r2 = fakeR2();
    const key = `reports/${job.id}/recordings.zip`;
    r2.getFailure = new R2ObjectError(503);

    await expect(generate(r2, job.id)).rejects.toEqual(new R2ObjectError(503));
    expect(r2.uploads).toEqual([{ key, state: "Aborted" }]);
    expect(r2.objects.has(key)).toBe(false);
    expect((await pool!.query("select status from report_job where id = $1", [job.id])).rows[0].status).toBe("Generating");

    r2.getFailure = null;
    await generate(r2, job.id);
    await generateReportJob({ pool: pool!, objects: r2, now: () => new Date("2026-10-14T16:02:51.337Z") }, job.id);

    expect(r2.staleAborts).toEqual([key, key]);
    expect(r2.uploads).toEqual([{ key, state: "Aborted" }, { key, state: "Completed" }]);
    expect(Object.keys(archive(r2, job.id)).sort()).toEqual(["manifest.csv", "recordings/20260923-154805_north-voicemail.mp3"]);
    expect((await pool!.query("select status, completed_at from report_job where id = $1", [job.id])).rows[0]).toEqual({ status: "Completed", completed_at: generatedAt });
    expect((await pool!.query("select count(*)::int as count from report_artifact where job_id = $1", [job.id])).rows[0].count).toBe(1);
  });

  it("records a concise failure reason once retries are exhausted, after which a late rerun uploads nothing", async () => {
    const job = await create({ kind: "call_export", scope: { kind: "workspace", workspaceId: "south" }, selection: { kind: "call", callId: "south-answered" }, file: "zip" });
    const r2 = fakeR2();
    r2.getFailure = new R2ObjectError(503);
    const error = await generate(r2, job.id).catch((value: unknown) => value);

    await recordReportGenerationFailure(pool!, job.id, error);
    r2.getFailure = null;
    await generate(r2, job.id);

    expect((await pool!.query("select status, failure_reason from report_job where id = $1", [job.id])).rows[0]).toEqual({ status: "Failed", failure_reason: "R2 request failed (HTTP 503)" });
    expect(r2.uploads).toEqual([{ key: `reports/${job.id}/recordings.zip`, state: "Aborted" }]);
    expect((await pool!.query("select count(*)::int as count from report_artifact where job_id = $1", [job.id])).rows[0].count).toBe(0);
  });

  it("omits a Recording whose media expires while the export runs and records it Expired in the manifest", async () => {
    const job = await create({ kind: "call_export", scope: { kind: "workspace", workspaceId: "north" }, selection: { kind: "filters", filters: { ...emptyCallFilters, outcomes: ["Voicemail", "Missed"] } }, file: "zip" });
    const r2 = fakeR2();

    await generateReportJob({ pool: pool!, objects: r2, now: () => new Date("2027-09-23T19:48:05.271Z") }, job.id);

    const files = archive(r2, job.id);
    expect(Object.keys(files)).toEqual(["manifest.csv"]);
    expect(decode(files["manifest.csv"])).toBe(
      manifestHeader +
        "north-missed,North Plumbing,+14155550113,+12125551003,2026-09-22T07:05:19-04:00,Missed,143,0,None,,No,Unavailable,Unavailable,,No Recording\r\n" +
        "north-voicemail,North Plumbing,+14155550113,+12125551004,2026-09-23T15:48:05-04:00,Voicemail,143,0,None,,No,Ready,Unavailable,,Expired\r\n",
    );
    expect((await pool!.query("select status from report_job where id = $1", [job.id])).rows[0].status).toBe("Completed");
  });

  it("freezes a job's Calls at its request time, so Calls started afterward never join an open-ended export or report", async () => {
    const zipJob = await create({ kind: "call_export", scope: { kind: "workspace", workspaceId: "south" }, selection: { kind: "filters", filters: { ...emptyCallFilters, startedFrom: "2026-09-01" } }, file: "zip" });
    const csvJob = await create({ kind: "report", scope: { kind: "workspace", workspaceId: "south" }, period: { kind: "all" }, files: ["csv"] });
    await seedCall({ id: "south-after-request", workspaceId: "south", startedAt: "2026-10-14T15:37:12.419Z", outcome: "Answered", recording: "retained" });
    const r2 = fakeR2();
    r2.objects.set("recordings/south-after-request.mp3", { bytes: mp3Bytes("south-after-request"), contentType: "audio/mpeg" });

    await generate(r2, zipJob.id);
    await generate(r2, csvJob.id);

    const files = archive(r2, zipJob.id);
    expect(Object.keys(files).sort()).toEqual(["manifest.csv", "recordings/20260928-111641_south-answered.mp3"]);
    expect(decode(files["manifest.csv"]).split("\r\n").slice(1, -1).map((row) => row.split(",")[0])).toEqual(["south-answered"]);
    expect(decode(r2.objects.get(`reports/${csvJob.id}/calls.csv`)?.bytes).split("\r\n").slice(1, -1).map((row) => row.split(",")[0])).toEqual(["south-answered"]);
  });
});
