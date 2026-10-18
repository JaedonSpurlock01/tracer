/**
 * -------------------------------------------------------------------------
 * @file   migrations.test.ts
 * @brief  Verifies Tracer database migrations against PostgreSQL.
 *
 * @description
 *  Runs the public migration workflow against a clean PostgreSQL 17
 *  database and inspects the resulting application schema.
 *
 * @remarks
 *  The PostgreSQL container is shared across every test in this file.
 *
 * @see
 *  docs/IMPLEMENTATION_ROADMAP.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";

import { generateInitialCallFlow } from "@/data/call-flow";
import { migrateDatabase } from "@/data/migrate";
import { smokeDatabase } from "@/data/database-smoke";
import { createOrganizationRepository } from "@/data/organization-repository";
import { provisionRuntimeRole, runtimeRole } from "@/data/runtime-role";

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
}, 120_000);

afterAll(async () => {
  if (!pool || !container) return;
  await pool.end();
  await container.stop();
});

it("migrates a clean database to the latest authentication and Organization schema", async () => {
  await migrateDatabase(container.getConnectionUri());

  const result = await pool.query<{ table_name: string }>(
    `select table_name
       from information_schema.tables
      where table_schema = 'public'
        and table_name in ('organization', 'user', 'session', 'account', 'verification', 'member', 'invitation', 'twilio_connection', 'twilio_number', 'workspace', 'number_assignment', 'call_flow_draft', 'flow_version', 'access_grant', 'call', 'provider_event', 'recording', 'transcript', 'lead_assessment', 'lead_assessment_evidence', 'lead_review')
      order by table_name`,
  );
  expect(result.rows.map(({ table_name }) => table_name)).toEqual([
    "access_grant",
    "account",
    "call",
    "call_flow_draft",
    "flow_version",
    "invitation",
    "lead_assessment",
    "lead_assessment_evidence",
    "lead_review",
    "member",
    "number_assignment",
    "organization",
    "provider_event",
    "recording",
    "session",
    "transcript",
    "twilio_connection",
    "twilio_number",
    "user",
    "verification",
    "workspace",
  ]);

  const columns = await pool.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name
       from information_schema.columns
      where table_schema = 'public'
        and ((table_name = 'organization' and column_name in ('id', 'name', 'slug', 'created_at', 'logo', 'metadata'))
          or (table_name = 'user' and column_name in ('state', 'timezone', 'last_sign_in_at', 'provisioned_by_user_id'))
          or (table_name = 'session' and column_name = 'active_organization_id'))
      order by table_name, ordinal_position`,
  );
  expect(columns.rows).toEqual(expect.arrayContaining([
    { table_name: "organization", column_name: "created_at" },
    { table_name: "user", column_name: "state" },
    { table_name: "user", column_name: "timezone" },
    { table_name: "user", column_name: "last_sign_in_at" },
    { table_name: "user", column_name: "provisioned_by_user_id" },
    { table_name: "session", column_name: "active_organization_id" },
  ]));

  const stateConstraint = await pool.query<{ constraint_name: string }>(
    `select constraint_name
       from information_schema.check_constraints
      where constraint_name = 'user_state_check'`,
  );
  expect(stateConstraint.rows).toEqual([{ constraint_name: "user_state_check" }]);
  const workspaceStateConstraint = await pool.query<{ constraint_name: string }>(
    `select constraint_name
       from information_schema.check_constraints
      where constraint_name = 'workspace_state_check'`,
  );
  expect(workspaceStateConstraint.rows).toEqual([{ constraint_name: "workspace_state_check" }]);
  const recordingConstraints = await pool.query<{ constraint_name: string }>(
    `select constraint_name
       from information_schema.check_constraints
      where constraint_name like 'recording_%'
      order by constraint_name`,
  );
  expect(recordingConstraints.rows.map(({ constraint_name }) => constraint_name)).toEqual([
    "recording_channels_check",
    "recording_cleanup_requires_stored_check",
    "recording_lead_assessment_requires_transcript_check",
    "recording_lead_assessment_state_check",
    "recording_source_check",
    "recording_stored_metadata_check",
    "recording_transcript_requires_stored_check",
    "recording_transcript_skip_reason_check",
    "recording_transcript_state_check",
    "recording_transcript_usage_check",
    "recording_transfer_state_check",
    "recording_twilio_cleanup_state_check",
    "recording_waveform_requires_stored_check",
    "recording_waveform_state_check",
    "recording_waveform_stored_metadata_check",
  ]);
  const waveformColumns = await pool.query<{ column_name: string; column_default: string | null; is_nullable: string }>(
    `select column_name, column_default, is_nullable
       from information_schema.columns
      where table_schema = 'public' and table_name = 'recording' and column_name like 'waveform_%'
      order by column_name`,
  );
  expect(waveformColumns.rows).toEqual([
    { column_name: "waveform_failure_reason", column_default: null, is_nullable: "YES" },
    { column_name: "waveform_generated_at", column_default: null, is_nullable: "YES" },
    { column_name: "waveform_object_key", column_default: null, is_nullable: "YES" },
    { column_name: "waveform_state", column_default: "'Pending'::text", is_nullable: "NO" },
  ]);
  const waveformRecoveryIndex = await pool.query<{ indexdef: string }>("select indexdef from pg_indexes where indexname = 'recording_waveform_unfinished_created_at_idx'");
  expect(waveformRecoveryIndex.rows).toEqual([{ indexdef: expect.stringMatching(/ON public\.recording USING btree \(created_at\) WHERE \(waveform_state <> 'Stored'::text\)$/) }]);
  const analysisRecoveryIndexes = await pool.query<{ indexname: string; indexdef: string }>(
    "select indexname, indexdef from pg_indexes where indexname in ('recording_transcript_unfinished_created_at_idx', 'recording_lead_assessment_unfinished_created_at_idx') order by indexname",
  );
  expect(analysisRecoveryIndexes.rows).toEqual([
    {
      indexname: "recording_lead_assessment_unfinished_created_at_idx",
      indexdef: expect.stringMatching(/ON public\.recording USING btree \(created_at\) WHERE \(lead_assessment_state = ANY \(ARRAY\['Pending'::text, 'Failed'::text\]\)\)$/),
    },
    {
      indexname: "recording_transcript_unfinished_created_at_idx",
      indexdef: expect.stringMatching(/ON public\.recording USING btree \(created_at\) WHERE \(transcript_state = ANY \(ARRAY\['Pending'::text, 'Failed'::text\]\)\)$/),
    },
  ]);
  const recoveryIndex = await pool.query<{ indexdef: string }>("select indexdef from pg_indexes where indexname = 'recording_unfinished_created_at_idx'");
  expect(recoveryIndex.rows).toEqual([{ indexdef: expect.stringMatching(/ON public\.recording USING btree \(created_at\) WHERE \(twilio_cleanup_state <> 'Deleted'::text\)$/) }]);
  const foreignKeys = await pool.query<{ constraint_name: string }>(
    `select constraint_name
       from information_schema.table_constraints
      where constraint_type = 'FOREIGN KEY'
        and constraint_name in ('session_active_organization_id_organization_id_fk', 'member_organization_id_organization_id_fk', 'member_user_id_user_id_fk', 'user_provisioned_by_user_id_fk')`,
  );
  expect(foreignKeys.rows.map(({ constraint_name }) => constraint_name)).toEqual(expect.arrayContaining([
    "session_active_organization_id_organization_id_fk",
    "member_organization_id_organization_id_fk",
    "member_user_id_user_id_fk",
    "user_provisioned_by_user_id_fk",
  ]));
}, 30_000);

it("applies the latest migrations repeatedly as a no-op", async () => {
  await migrateDatabase(container.getConnectionUri());
  await migrateDatabase(container.getConnectionUri());

  const result = await pool.query<{ count: string }>(
    `select count(*)
       from drizzle.__drizzle_migrations`,
  );

  expect(Number(result.rows[0].count)).toBe(16);
}, 30_000);

it("enforces Transcript, immutable Lead Assessment, and one current Lead Review per Call invariants", async () => {
  const organizationId = (await createOrganizationRepository(pool).create({ name: "Analysis Organization", slug: "analysis-organization" })).id;
  const operator = { userId: "analysis-operator" };
  await pool.query(
    "insert into \"user\" (id, name, email, created_at, updated_at) values ('analysis-operator', 'Analysis Operator', 'analysis-operator@example.com', now(), now())",
  );
  const graph = generateInitialCallFlow({ destinationNumber: "+14155550199", recordingEnabled: true, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });
  await pool.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ('analysis-number', $1, 'PNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '+14155550123', 'Analysis Number', true, now(), now(), now(), now())`,
    [organizationId],
  );
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, recording_enabled, analysis_enabled, created_at, updated_at)
     values ('analysis-workspace', $1, 'Analysis Workspace', 'UTC', 'Active', true, true, now(), now())`,
    [organizationId],
  );
  await pool.query(
    `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at)
     values ('analysis-assignment', $1, 'analysis-workspace', 'analysis-number', '+14155550123', now(), now())`,
    [organizationId],
  );
  await pool.query(
    `insert into flow_version (id, organization_id, workspace_id, version, graph, published_by_user_id, published_at)
     values ('analysis-flow-version', $1, 'analysis-workspace', 1, $2, $3, now())`,
    [organizationId, JSON.stringify(graph), operator.userId],
  );
  await pool.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, started_at, created_at, updated_at)
     values ('analysis-call', $1, 'analysis-workspace', 'analysis-assignment', 'analysis-flow-version', 'CAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '+14155550123', now(), now(), now())`,
    [organizationId],
  );
  await pool.query(
    `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, created_at, updated_at)
     values ('analysis-recording', $1, 'analysis-workspace', 'analysis-call', 'REaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'connected', 2, 40, now(), now())`,
    [organizationId],
  );

  const recordingColumns = await pool.query<{ transcript_state: string | null; lead_assessment_state: string | null }>(
    "select transcript_state, lead_assessment_state from recording where id = 'analysis-recording'",
  );
  expect(recordingColumns.rows).toEqual([{ transcript_state: null, lead_assessment_state: null }]);
  await expect(pool.query("update recording set transcript_state = 'Pending' where id = 'analysis-recording'")).rejects.toMatchObject({ constraint: "recording_transcript_requires_stored_check" });
  await pool.query(
    `update recording set transfer_state = 'Stored', r2_object_key = 'analysis.wav', size_bytes = 1, sha256 = 'abc', stored_at = now()
      where id = 'analysis-recording'`,
  );
  await expect(pool.query("update recording set transcript_state = 'Skipped' where id = 'analysis-recording'")).rejects.toMatchObject({ constraint: "recording_transcript_skip_reason_check" });
  await expect(pool.query("update recording set transcript_state = 'Pending', transcript_skip_reason = 'too_short' where id = 'analysis-recording'")).rejects.toMatchObject({ constraint: "recording_transcript_skip_reason_check" });
  await expect(pool.query("update recording set transcript_state = 'Skipped', transcript_skip_reason = 'unknown' where id = 'analysis-recording'")).rejects.toMatchObject({ constraint: "recording_transcript_skip_reason_check" });
  await expect(pool.query("update recording set transcript_state = 'Pending', lead_assessment_state = 'Pending' where id = 'analysis-recording'")).rejects.toMatchObject({ constraint: "recording_lead_assessment_requires_transcript_check" });
  await expect(pool.query("update recording set transcript_state = 'Completed' where id = 'analysis-recording'")).rejects.toMatchObject({ constraint: "recording_transcript_usage_check" });
  await expect(pool.query(
    "update recording set transcript_state = 'Completed', transcript_audio_ms = -1, transcript_cost_usd = 0, transcript_completed_at = now() where id = 'analysis-recording'",
  )).rejects.toMatchObject({ constraint: "recording_transcript_usage_check" });
  await pool.query(
    `update recording set transcript_state = 'Completed', transcript_audio_ms = 80000, transcript_cost_usd = 0.008, transcript_completed_at = now(), lead_assessment_state = 'Completed'
      where id = 'analysis-recording'`,
  );

  const turns = [
    { speaker: "Caller", startMs: 0, endMs: 2400, text: "Hi, I need a quote." },
    { speaker: "Business", startMs: 2600, endMs: 4100, text: "Sure, what is the address?" },
  ];
  await expect(pool.query(
    "insert into transcript (recording_id, organization_id, call_id, turns, model, created_at) values ('analysis-recording', $1, 'analysis-call', '{}', 'transcription-model', now())",
    [organizationId],
  )).rejects.toMatchObject({ constraint: "transcript_turns_check" });
  await pool.query(
    "insert into transcript (recording_id, organization_id, call_id, turns, model, created_at) values ('analysis-recording', $1, 'analysis-call', $2, 'transcription-model', now())",
    [organizationId, JSON.stringify(turns)],
  );

  const assessment = (id: string, score: number) => pool.query(
    `insert into lead_assessment (id, organization_id, call_id, recording_id, classification, score, summary, rationale, model, input_tokens, output_tokens, cost_usd, processed_at)
     values ($1, $2, 'analysis-call', 'analysis-recording', 'Good Lead', $3, 'Caller asked for a quote.', 'Clear service request.', 'assessment-model', 900, 120, 0.000315, now())`,
    [id, organizationId, score],
  );
  await expect(assessment("assessment-over", 101)).rejects.toMatchObject({ constraint: "lead_assessment_score_check" });
  await expect(assessment("assessment-under", -1)).rejects.toMatchObject({ constraint: "lead_assessment_score_check" });
  await assessment("assessment-1", 82);
  await expect(assessment("assessment-2", 50)).rejects.toMatchObject({ constraint: "lead_assessment_recording_id_idx" });
  await expect(pool.query("update lead_assessment set score = 10 where id = 'assessment-1'")).rejects.toThrow("Lead Assessment is immutable");
  await pool.query(
    "insert into lead_assessment_evidence (lead_assessment_id, position, turn_index, start_ms, quote) values ('assessment-1', 0, 0, 0, 'I need a quote.')",
  );
  await expect(pool.query(
    "insert into lead_assessment_evidence (lead_assessment_id, position, turn_index, start_ms, quote) values ('assessment-1', 1, -1, 0, 'Invalid turn')",
  )).rejects.toMatchObject({ constraint: "lead_assessment_evidence_turn_check" });

  await pool.query("delete from lead_assessment_evidence where lead_assessment_id = 'assessment-1'");
  await pool.query("delete from transcript where recording_id = 'analysis-recording'");
  const retained = await pool.query<{ call: string; score: number }>(
    "select c.id as call, a.score from call c join lead_assessment a on a.call_id = c.id where c.id = 'analysis-call'",
  );
  expect(retained.rows).toEqual([{ call: "analysis-call", score: 82 }]);
  const usage = await pool.query("select transcript_state, transcript_audio_ms, transcript_cost_usd from recording where id = 'analysis-recording'");
  expect(usage.rows).toEqual([{ transcript_state: "Completed", transcript_audio_ms: 80000, transcript_cost_usd: "0.008000" }]);

  const review = (classification: string) => pool.query(
    `insert into lead_review (call_id, organization_id, classification, note, reviewer_user_id, reviewed_at)
     values ('analysis-call', $1, $2, 'Confirmed by phone.', $3, now())`,
    [organizationId, classification, operator.userId],
  );
  await expect(review("Maybe")).rejects.toMatchObject({ constraint: "lead_review_classification_check" });
  await review("Not Good Lead");
  await expect(review("Good Lead")).rejects.toMatchObject({ constraint: "lead_review_pkey" });
  await pool.query("update lead_review set classification = 'Good Lead', note = null where call_id = 'analysis-call'");
  const reviews = await pool.query("select classification, note from lead_review where call_id = 'analysis-call'");
  expect(reviews.rows).toEqual([{ classification: "Good Lead", note: null }]);
  const unchanged = await pool.query("select classification, score from lead_assessment where id = 'assessment-1'");
  expect(unchanged.rows).toEqual([{ classification: "Good Lead", score: 82 }]);
}, 30_000);

it("creates and reads an Organization by its generated ID", async () => {
  const repository = createOrganizationRepository(pool);

  const created = await repository.create({
    name: "Spurlock Labs",
    slug: "spurlock-labs",
  });

  expect(created.id).toEqual(expect.any(String));
  expect(created.createdAt).toEqual(expect.any(Date));
  await expect(repository.findById(created.id)).resolves.toEqual(created);
});

it("smokes Organization reads and writes without retaining data", async () => {
  const before = await pool.query<{ count: string }>("select count(*) from organization");

  await expect(smokeDatabase(pool)).resolves.toBeUndefined();

  const after = await pool.query<{ count: string }>("select count(*) from organization");
  expect(after.rows[0].count).toBe(before.rows[0].count);
});

it("grants Better Auth tables without granting schema creation or user deletion", async () => {
  const password = "A".repeat(64);
  await provisionRuntimeRole(pool, password);

  const grants = await pool.query<{ table_name: string; privilege_type: string }>(
    `select table_name, privilege_type
       from information_schema.role_table_grants
      where grantee = $1
        and table_schema = 'public'
        and table_name in ('organization', 'user', 'session', 'account', 'verification', 'member', 'invitation', 'twilio_connection', 'twilio_number', 'workspace', 'number_assignment', 'call_flow_draft', 'flow_version', 'access_grant', 'call', 'provider_event', 'recording', 'transcript', 'lead_assessment', 'lead_assessment_evidence', 'lead_review')
      order by table_name, privilege_type`,
    [runtimeRole],
  );
  expect(grants.rows).not.toContainEqual({ table_name: "organization", privilege_type: "DELETE" });
  expect(grants.rows).toContainEqual({ table_name: "organization", privilege_type: "UPDATE" });
  expect(grants.rows).toContainEqual({ table_name: "session", privilege_type: "DELETE" });
  expect(grants.rows).toContainEqual({ table_name: "twilio_connection", privilege_type: "DELETE" });
  expect(grants.rows).toContainEqual({ table_name: "twilio_number", privilege_type: "DELETE" });
  expect(grants.rows).toContainEqual({ table_name: "workspace", privilege_type: "UPDATE" });
  expect(grants.rows).not.toContainEqual({ table_name: "workspace", privilege_type: "DELETE" });
  expect(grants.rows).toContainEqual({ table_name: "number_assignment", privilege_type: "SELECT" });
  expect(grants.rows).toContainEqual({ table_name: "number_assignment", privilege_type: "INSERT" });
  expect(grants.rows).toContainEqual({ table_name: "number_assignment", privilege_type: "UPDATE" });
  expect(grants.rows).not.toContainEqual({ table_name: "number_assignment", privilege_type: "DELETE" });
  expect(grants.rows).toContainEqual({ table_name: "flow_version", privilege_type: "SELECT" });
  expect(grants.rows).toContainEqual({ table_name: "flow_version", privilege_type: "INSERT" });
  expect(grants.rows).toContainEqual({ table_name: "flow_version", privilege_type: "UPDATE" });
  expect(grants.rows).not.toContainEqual({ table_name: "flow_version", privilege_type: "DELETE" });
  expect(grants.rows).toContainEqual({ table_name: "call_flow_draft", privilege_type: "DELETE" });
  expect(grants.rows).toContainEqual({ table_name: "call", privilege_type: "INSERT" });
  expect(grants.rows).toContainEqual({ table_name: "call", privilege_type: "UPDATE" });
  expect(grants.rows).not.toContainEqual({ table_name: "call", privilege_type: "DELETE" });
  expect(grants.rows).toContainEqual({ table_name: "provider_event", privilege_type: "INSERT" });
  expect(grants.rows).not.toContainEqual({ table_name: "provider_event", privilege_type: "UPDATE" });
  expect(grants.rows).not.toContainEqual({ table_name: "provider_event", privilege_type: "DELETE" });
  expect(grants.rows).toContainEqual({ table_name: "recording", privilege_type: "SELECT" });
  expect(grants.rows).toContainEqual({ table_name: "recording", privilege_type: "INSERT" });
  expect(grants.rows).toContainEqual({ table_name: "recording", privilege_type: "UPDATE" });
  expect(grants.rows).not.toContainEqual({ table_name: "recording", privilege_type: "DELETE" });
  expect(grants.rows).toContainEqual({ table_name: "access_grant", privilege_type: "SELECT" });
  expect(grants.rows).toContainEqual({ table_name: "access_grant", privilege_type: "INSERT" });
  expect(grants.rows).toContainEqual({ table_name: "access_grant", privilege_type: "DELETE" });
  expect(grants.rows).not.toContainEqual({ table_name: "access_grant", privilege_type: "UPDATE" });
  expect(grants.rows).not.toContainEqual({ table_name: "user", privilege_type: "DELETE" });
  expect(grants.rows).toContainEqual({ table_name: "transcript", privilege_type: "SELECT" });
  expect(grants.rows).toContainEqual({ table_name: "transcript", privilege_type: "INSERT" });
  expect(grants.rows).toContainEqual({ table_name: "transcript", privilege_type: "DELETE" });
  expect(grants.rows).not.toContainEqual({ table_name: "transcript", privilege_type: "UPDATE" });
  expect(grants.rows).toContainEqual({ table_name: "lead_assessment", privilege_type: "SELECT" });
  expect(grants.rows).toContainEqual({ table_name: "lead_assessment", privilege_type: "INSERT" });
  expect(grants.rows).not.toContainEqual({ table_name: "lead_assessment", privilege_type: "UPDATE" });
  expect(grants.rows).not.toContainEqual({ table_name: "lead_assessment", privilege_type: "DELETE" });
  expect(grants.rows).toContainEqual({ table_name: "lead_assessment_evidence", privilege_type: "SELECT" });
  expect(grants.rows).toContainEqual({ table_name: "lead_assessment_evidence", privilege_type: "INSERT" });
  expect(grants.rows).toContainEqual({ table_name: "lead_assessment_evidence", privilege_type: "DELETE" });
  expect(grants.rows).not.toContainEqual({ table_name: "lead_assessment_evidence", privilege_type: "UPDATE" });
  expect(grants.rows).toContainEqual({ table_name: "lead_review", privilege_type: "SELECT" });
  expect(grants.rows).toContainEqual({ table_name: "lead_review", privilege_type: "INSERT" });
  expect(grants.rows).toContainEqual({ table_name: "lead_review", privilege_type: "UPDATE" });
  expect(grants.rows).not.toContainEqual({ table_name: "lead_review", privilege_type: "DELETE" });

  const runtimeUrl = new URL(container.getConnectionUri());
  runtimeUrl.username = runtimeRole;
  runtimeUrl.password = password;
  const runtimePool = new Pool({ connectionString: runtimeUrl.toString() });

  try {
    await expect(runtimePool.query("delete from \"user\"")).rejects.toMatchObject({ code: "42501" });
    await expect(runtimePool.query("create table forbidden (id text)")).rejects.toMatchObject({
      code: "42501",
    });
  } finally {
    await runtimePool.end();
  }
});
