/**
 * -------------------------------------------------------------------------
 * @file   call-event-backfill.test.ts
 * @brief  Verifies the Call event log backfill for Calls that predate it.
 *
 * @description
 *  Migrates a clean PostgreSQL 17 database only up to the migration before
 *  the Call event log, seeds Calls, Recordings, Lead Assessments, and Lead
 *  Reviews in their persisted states, applies the remaining migrations, and
 *  checks the events the backfill derives from that state.
 *
 * @remarks
 *  The earlier schema is reached by migrating from a temporary copy of the
 *  migrations folder whose journal stops before the Call event log. The
 *  backfill statements are then run again to prove they are idempotent.
 *
 * @see
 *  drizzle/0016_volatile_micromax.sql
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";

import { createTestPool } from "./test-pool";

import { generateInitialCallFlow } from "@/data/call-flow";
import { migrateDatabase } from "@/data/migrate";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const eventLogMigration = "0016_volatile_micromax";
const t0 = new Date("2026-10-01T15:00:00.000Z");
const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
const organizationId = "backfill-organization";

async function migrateBeforeEventLog(connectionString: string): Promise<void> {
  const folder = await mkdtemp(path.join(tmpdir(), "tracer-migrations-"));
  try {
    await cp(migrationsFolder, folder, { recursive: true });
    const journalPath = path.join(folder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: { tag: string }[] };
    const index = journal.entries.findIndex((entry) => entry.tag === eventLogMigration);
    await writeFile(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, index) }));
    const migrationPool = createTestPool(connectionString, { max: 1 });
    try {
      await migrate(drizzle(migrationPool), { migrationsFolder: folder });
    } finally {
      await migrationPool.end();
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

async function seedCall(
  id: string,
  call: { forwardStartedAt?: Date; answeredAt?: Date; endedAt?: Date; outcome?: string; gathers?: string[] },
): Promise<void> {
  const completed = call.endedAt !== undefined && call.outcome !== undefined;
  await pool!.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, caller_number,
                       state, outcome, outcome_reason, forward_started_at, answered_at, ended_at, started_at, created_at, updated_at)
     values ($1, $2, 'backfill-workspace', 'backfill-assignment', 'backfill-flow-version', $3, '+14155550123', '+14155550999',
             $4, $5, 'flow_outcome', $6, $7, $8, $9, $9, $9)`,
    [id, organizationId, `CA-${id}`, completed ? "Completed" : "In Progress", call.outcome ?? null, call.forwardStartedAt ?? null, call.answeredAt ?? null, call.endedAt ?? null, t0],
  );
  for (const [attempt, digits] of (call.gathers ?? []).entries()) {
    await pool!.query(
      `insert into provider_event (id, organization_id, number_assignment_id, call_id, idempotency_key, kind, disposition, payload, received_at)
       values ($1, $2, 'backfill-assignment', $3, $4, 'gather', 'accepted', $5, $6)`,
      [`${id}-gather-${attempt}`, organizationId, id, `CA-${id}:gather:gate:${attempt + 1}`, JSON.stringify({ Digits: digits }), at(5 + attempt * 5)],
    );
  }
}

async function seedRecording(
  id: string,
  callId: string,
  recording: { transfer: "Stored" | "Failed" | "Pending"; transcript?: "Completed" | "Skipped" | "Failed" | "Pending"; assessment?: "Completed" | "Failed" | "Pending"; updatedAt: Date },
): Promise<void> {
  const stored = recording.transfer === "Stored";
  await pool!.query(
    `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, transfer_state, failure_stage, failure_reason,
                            r2_object_key, size_bytes, sha256, stored_at, transcript_state, transcript_skip_reason, transcript_failure_reason,
                            transcript_audio_ms, transcript_cost_usd, transcript_completed_at, lead_assessment_state, lead_assessment_failure_reason, created_at, updated_at)
     values ($1, $2, 'backfill-workspace', $3, $4, 'connected', 2, 40, $5, $6, $7,
             $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
    [
      id,
      organizationId,
      callId,
      `RE-${id}`,
      recording.transfer,
      recording.transfer === "Failed" ? "download" : null,
      recording.transfer === "Failed" ? "Twilio is unavailable" : null,
      stored ? `${id}.wav` : null,
      stored ? 1 : null,
      stored ? "checksum" : null,
      stored ? at(100) : null,
      recording.transcript ?? null,
      recording.transcript === "Skipped" ? "too_short" : null,
      recording.transcript === "Failed" ? "OpenAI request failed (HTTP 500)" : null,
      recording.transcript === "Completed" ? 40_000 : null,
      recording.transcript === "Completed" ? 0.004 : null,
      recording.transcript === "Completed" ? at(200) : null,
      recording.assessment ?? null,
      recording.assessment === "Failed" ? "OpenAI request failed (HTTP 429)" : null,
      at(90),
      recording.updatedAt,
    ],
  );
  if (recording.assessment === "Completed") {
    await pool!.query(
      `insert into lead_assessment (id, organization_id, call_id, recording_id, classification, score, summary, rationale, model, input_tokens, output_tokens, cost_usd, processed_at)
       values ($1, $2, $3, $4, 'Good Lead', 82, 'Caller asked for a quote.', 'Clear service request.', 'gpt-5-mini', 900, 120, 0.000315, $5)`,
      [`${id}-assessment`, organizationId, callId, id, at(300)],
    );
  }
}

async function events(callId: string): Promise<Record<string, unknown>[]> {
  const result = await pool!.query(
    "select kind, occurred_at, detail, actor_user_id from call_event where call_id = $1 order by occurred_at, id",
    [callId],
  );
  return result.rows;
}

const event = (kind: string, occurredAt: Date, detail: Record<string, unknown> = {}, actor: string | null = null) => ({ kind, occurred_at: occurredAt, detail, actor_user_id: actor });

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = createTestPool(container.getConnectionUri());
  await migrateBeforeEventLog(container.getConnectionUri());
  await pool.query("insert into organization (id, name, slug, created_at) values ($1, 'Backfill Organization', 'backfill-organization', now())", [organizationId]);
  await pool.query(`insert into "user" (id, name, email, created_at, updated_at) values ('backfill-operator', 'Backfill Operator', 'backfill@example.com', now(), now())`);
  await pool.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ('backfill-number', $1, 'PNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '+14155550123', 'Backfill Number', true, now(), now(), now(), now())`,
    [organizationId],
  );
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, recording_enabled, analysis_enabled, spam_gate_enabled, created_at, updated_at)
     values ('backfill-workspace', $1, 'Backfill Workspace', 'UTC', 'Active', true, true, true, now(), now())`,
    [organizationId],
  );
  await pool.query(
    `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at)
     values ('backfill-assignment', $1, 'backfill-workspace', 'backfill-number', '+14155550123', now(), now())`,
    [organizationId],
  );
  const graph = generateInitialCallFlow({ destinationNumber: "+14155550199", recordingEnabled: true, spamGateEnabled: true, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });
  await pool.query(
    `insert into flow_version (id, organization_id, workspace_id, version, graph, published_at)
     values ('backfill-flow-version', $1, 'backfill-workspace', 1, $2, now())`,
    [organizationId, JSON.stringify(graph)],
  );

  await seedCall("answered-call", { gathers: ["1"], forwardStartedAt: at(10), answeredAt: at(15), endedAt: at(60), outcome: "Answered" });
  await seedRecording("answered-recording", "answered-call", { transfer: "Stored", transcript: "Completed", assessment: "Completed", updatedAt: at(300) });
  await pool.query(
    "insert into lead_review (call_id, organization_id, classification, note, reviewer_user_id, reviewed_at) values ('answered-call', $1, 'Not Good Lead', 'Wrong area.', 'backfill-operator', $2)",
    [organizationId, at(400)],
  );
  await seedCall("blocked-call", { gathers: ["9", ""], endedAt: at(20), outcome: "Blocked" });
  await seedCall("hung-up-call", { endedAt: at(8), outcome: "Blocked" });
  await seedCall("in-progress-call", { gathers: ["9"] });
  await seedCall("transfer-failed-call", { gathers: ["1"], forwardStartedAt: at(10), endedAt: at(60), outcome: "Answered" });
  await seedRecording("transfer-failed-recording", "transfer-failed-call", { transfer: "Failed", updatedAt: at(120) });
  await seedCall("skipped-call", { gathers: ["1"], forwardStartedAt: at(10), endedAt: at(60), outcome: "Answered" });
  await seedRecording("skipped-recording", "skipped-call", { transfer: "Stored", transcript: "Skipped", updatedAt: at(100) });
  await seedCall("transcript-failed-call", { gathers: ["1"], forwardStartedAt: at(10), endedAt: at(60), outcome: "Answered" });
  await seedRecording("transcript-failed-recording", "transcript-failed-call", { transfer: "Stored", transcript: "Failed", updatedAt: at(150) });
  await seedCall("assessment-failed-call", { gathers: ["1"], forwardStartedAt: at(10), endedAt: at(60), outcome: "Answered" });
  await seedRecording("assessment-failed-recording", "assessment-failed-call", { transfer: "Stored", transcript: "Completed", assessment: "Failed", updatedAt: at(250) });

  await migrateDatabase(container.getConnectionUri());
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

it("backfills every lifecycle step a pre-migration Call already reached at its persisted time", async () => {
  expect(await events("answered-call")).toEqual([
    event("call_received", t0),
    event("spam_gate_passed", at(5)),
    event("forwarding_attempted", at(10)),
    event("call_completed", at(60), { outcome: "Answered" }),
    event("recording_transferred", at(100)),
    event("transcript_completed", at(200)),
    event("lead_assessment_completed", at(300), { classification: "Good Lead", score: 82 }),
    event("lead_review_added", at(400), { classification: "Not Good Lead" }, "backfill-operator"),
  ]);
});

it("backfills Spam gate failed for a gated Call that ended Blocked, at its last gate attempt or its end", async () => {
  expect(await events("blocked-call")).toEqual([
    event("call_received", t0),
    event("spam_gate_failed", at(10)),
    event("call_completed", at(20), { outcome: "Blocked" }),
  ]);
  expect(await events("hung-up-call")).toEqual([
    event("call_received", t0),
    event("spam_gate_failed", at(8)),
    event("call_completed", at(8), { outcome: "Blocked" }),
  ]);
  expect(await events("in-progress-call")).toEqual([event("call_received", t0)]);
});

it("backfills failures at the Recording's last update and marks them backfilled", async () => {
  expect((await events("transfer-failed-call")).slice(-1)).toEqual([event("recording_transfer_failed", at(120), { stage: "download", backfilled: true })]);
  expect((await events("skipped-call")).slice(-2)).toEqual([event("recording_transferred", at(100)), event("transcript_skipped", at(100), { reason: "too_short" })]);
  expect((await events("transcript-failed-call")).slice(-1)).toEqual([event("transcript_failed", at(150), { backfilled: true })]);
  expect((await events("assessment-failed-call")).slice(-2)).toEqual([event("transcript_completed", at(200)), event("lead_assessment_failed", at(250), { backfilled: true })]);
});

it("adds no events when the backfill runs again", async () => {
  const migration = await readFile(path.join(migrationsFolder, `${eventLogMigration}.sql`), "utf8");
  const backfill = migration.split("--> statement-breakpoint").filter((statement) => /insert into "call_event"/i.test(statement));
  expect(backfill.length).toBeGreaterThan(0);
  const before = (await pool!.query("select count(*)::int as count from call_event")).rows[0].count;

  for (const statement of backfill) await pool!.query(statement);

  expect((await pool!.query("select count(*)::int as count from call_event")).rows[0].count).toBe(before);
});
