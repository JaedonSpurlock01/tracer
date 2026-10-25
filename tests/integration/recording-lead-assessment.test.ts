/**
 * -------------------------------------------------------------------------
 * @file   recording-lead-assessment.test.ts
 * @brief  Verifies the Lead Assessment of a Completed Transcript.
 *
 * @description
 *  Runs the Lead Assessment workflow against a real PostgreSQL database with
 *  a fake OpenAI Responses boundary, checking that a Pending assessment of a
 *  Completed Transcript is persisted once with its usage, cost, and evidence
 *  linked to valid Transcript turns, that invalid model output and provider
 *  failures become Failed with a secret-free reason while the Transcript
 *  and playback stay, that a retry from Failed completes, and that
 *  Recordings without a Completed Transcript, already assessed, expired, or
 *  purged never call OpenAI, and that a purge committing while OpenAI
 *  works leaves no assessment or evidence.
 *
 * @see
 *  data/recording-lead-assessment.ts
 *  tests/integration/recording-transcription.test.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./test-database";

import type { OpenedDatabase } from "@/data/database";
import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { generateInitialCallFlow } from "@/data/call-flow";
import { migrateDatabase } from "@/data/migrate";
import { OpenAIError, type StructuredRequest, type StructuredResponder } from "@/data/openai-client";
import { assessRecordingLead, type RecordingLeadAssessmentDependencies } from "@/data/recording-lead-assessment";

const now = new Date("2026-10-16T12:00:00.000Z");
const days = (count: number) => new Date(now.getTime() - count * 24 * 60 * 60 * 1000);

let container: StartedPostgreSqlContainer | undefined;
let database: OpenedDatabase | undefined;
let organizationId = "";

const turns = [
  { speaker: "Caller", startMs: 0, endMs: 3000, text: "Hi, I need a quote for a water heater." },
  { speaker: "Business", startMs: 3500, endMs: 8000, text: "Sure, when can we come out?" },
  { speaker: "Caller", startMs: 9000, endMs: 10_500, text: "Thursday works." },
];

const goodLead = {
  classification: "Good Lead",
  score: 88,
  summary: "Caller asked for a water heater quote and booked Thursday.",
  rationale: "A prospective customer requested a quote and a visit.",
  evidence: [
    { turnIndex: 0, quote: "a quote for a water heater" },
    { turnIndex: 2, quote: "Thursday works." },
  ],
};

interface FakeResponder extends StructuredResponder {
  requests: StructuredRequest[];
  output: string;
  failure: Error | null;
  during: (() => Promise<void>) | null;
}

function fakeResponder(output: unknown = goodLead): FakeResponder {
  const responder: FakeResponder = {
    requests: [],
    output: JSON.stringify(output),
    failure: null,
    during: null,
    async respond(request) {
      responder.requests.push(request);
      await responder.during?.();
      if (responder.failure) throw responder.failure;
      return { text: responder.output, inputTokens: 812, outputTokens: 436 };
    },
  };
  return responder;
}

function dependencies(responder: FakeResponder): RecordingLeadAssessmentDependencies {
  return { database: database!, responder, now: () => now };
}

let sequence = 0;

async function transcribedRecording(
  options: { transcript?: "Pending" | "Completed" | "Skipped"; assessment?: string | null; storedTurns?: unknown; callStartedAt?: Date; purgedAt?: Date } = {},
): Promise<{ id: string; callId: string }> {
  sequence += 1;
  const transcript = options.transcript ?? "Completed";
  const completed = transcript === "Completed";
  const assessment = options.assessment === undefined ? (completed ? "Pending" : null) : options.assessment;
  const callId = `assessment-call-${sequence}`;
  const id = randomUUID();
  await database!.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, started_at, created_at, updated_at)
     values ($1, $2, 'assessment-workspace', 'assessment-assignment', 'assessment-flow-version', $3, '+14155550115', $4, $4, $4)`,
    [callId, organizationId, `CA${String(sequence).padStart(32, "0")}`, options.callStartedAt ?? days(1)],
  );
  await database!.query(
    `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, transfer_state, twilio_cleanup_state,
                            r2_object_key, size_bytes, sha256, stored_at, waveform_state, waveform_object_key, waveform_generated_at,
                            transcript_state, transcript_skip_reason, transcript_audio_ms, transcript_cost_usd, transcript_completed_at, lead_assessment_state, created_at, updated_at)
     values ($1, $2, 'assessment-workspace', $3, $4, 'connected', 2, 40, 'Stored', 'Deleted', 'recording.wav', 1, 'checksum', $5, 'Stored', 'recording.peaks.json', $5,
             $6, $7, $8, $9, $10, $11, $5, $5)`,
    [
      id,
      organizationId,
      callId,
      `RE${String(sequence).padStart(32, "0")}`,
      days(1),
      transcript,
      transcript === "Skipped" ? "analysis_disabled" : null,
      completed ? 80_000 : null,
      completed ? 0.008 : null,
      completed ? days(1) : null,
      assessment,
    ],
  );
  if (completed) {
    await database!.query(
      "insert into transcript (recording_id, organization_id, call_id, turns, model, created_at) values ($1, $2, $3, $4, 'whisper-1', $5)",
      [id, organizationId, callId, JSON.stringify(options.storedTurns ?? turns), days(1)],
    );
  }
  if (options.purgedAt) await database!.query("update recording set media_purged_at = $2 where id = $1", [id, options.purgedAt]);
  return { id, callId };
}

async function recordingRow(id: string): Promise<Record<string, unknown>> {
  const result = await database!.query(
    `select transfer_state, r2_object_key, waveform_state, transcript_state, transcript_failure_reason, lead_assessment_state, lead_assessment_failure_reason
       from recording where id = $1`,
    [id],
  );
  return result.rows[0];
}

async function assessmentRows(recordingId: string): Promise<{ assessment: Record<string, unknown> | undefined; evidence: Record<string, unknown>[] }> {
  const assessment = await database!.query(
    `select id, organization_id, call_id, classification, score, summary, rationale, model, input_tokens, output_tokens, cost_usd, processed_at
       from lead_assessment where recording_id = $1`,
    [recordingId],
  );
  const evidence = await database!.query(
    `select e.position, e.turn_index, e.start_ms, e.quote
       from lead_assessment_evidence e
       join lead_assessment a on a.id = e.lead_assessment_id
      where a.recording_id = $1
      order by e.position`,
    [recordingId],
  );
  return { assessment: assessment.rows[0], evidence: evidence.rows };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  database = createTestDatabase(container.getConnectionUri());
  await migrateDatabase(container.getConnectionUri());
  const operator = await bootstrapInitialOperator(database, { email: "operator@example.com", name: "Assessment Operator", timezone: "UTC" });
  organizationId = operator.organizationId;
  await database.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ('assessment-number', $1, 'PNdddddddddddddddddddddddddddddddd', '+14155550115', 'Assessment Number', true, now(), now(), now(), now())`,
    [organizationId],
  );
  await database.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, destination_number, recording_enabled, analysis_enabled, created_at, updated_at)
     values ('assessment-workspace', $1, 'Example Plumbing', 'UTC', 'Active', '+14155550199', true, true, now(), now())`,
    [organizationId],
  );
  await database.query(
    `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at)
     values ('assessment-assignment', $1, 'assessment-workspace', 'assessment-number', '+14155550115', now(), now())`,
    [organizationId],
  );
  const graph = generateInitialCallFlow({ destinationNumber: "+14155550199", recordingEnabled: true, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });
  await database.query(
    `insert into flow_version (id, organization_id, workspace_id, version, graph, published_by_user_id, published_at)
     values ('assessment-flow-version', $1, 'assessment-workspace', 1, $2, $3, now())`,
    [organizationId, JSON.stringify(graph), operator.userId],
  );
}, 120_000);

afterAll(async () => {
  await database?.close();
  await container?.stop();
});

describe("Recording Lead Assessment", () => {
  it("assesses a Completed Transcript with the Workspace name and persists the assessment, usage, cost, and Completed state", async () => {
    const responder = fakeResponder();
    const recording = await transcribedRecording();

    await assessRecordingLead(dependencies(responder), recording.id);

    expect(responder.requests).toHaveLength(1);
    expect(responder.requests[0]).toMatchObject({ model: "gpt-5-mini", schemaName: "lead_assessment" });
    expect(responder.requests[0].input).toContain("Workspace: Example Plumbing");
    expect(responder.requests[0].input).toContain("2 [00:09] Caller: Thursday works.");
    expect((await assessmentRows(recording.id)).assessment).toMatchObject({
      organization_id: organizationId,
      call_id: recording.callId,
      classification: "Good Lead",
      score: 88,
      summary: goodLead.summary,
      rationale: goodLead.rationale,
      model: "gpt-5-mini",
      input_tokens: 812,
      output_tokens: 436,
      cost_usd: "0.001075",
      processed_at: now,
    });
    expect(await recordingRow(recording.id)).toMatchObject({ transcript_state: "Completed", lead_assessment_state: "Completed", lead_assessment_failure_reason: null });
  });

  it("links each evidence snippet to a valid Transcript turn and its start time", async () => {
    const recording = await transcribedRecording();

    await assessRecordingLead(dependencies(fakeResponder()), recording.id);

    expect((await assessmentRows(recording.id)).evidence).toEqual([
      { position: 0, turn_index: 0, start_ms: 0, quote: "a quote for a water heater" },
      { position: 1, turn_index: 2, start_ms: 9000, quote: "Thursday works." },
    ]);
  });

  it("keeps the immutable assessment and does not call OpenAI on a rerun after Completed", async () => {
    const responder = fakeResponder();
    const recording = await transcribedRecording();
    await assessRecordingLead(dependencies(responder), recording.id);
    const before = await assessmentRows(recording.id);

    await assessRecordingLead(dependencies(fakeResponder({ ...goodLead, classification: "Not Good Lead", score: 5 })), recording.id);

    expect(await assessmentRows(recording.id)).toEqual(before);
    await expect(database!.query("update lead_assessment set score = 1 where recording_id = $1", [recording.id])).rejects.toThrow("Lead Assessment is immutable");
  });

  it("fails invalid model output with a stable reason and persists no assessment while the Transcript and playback stay", async () => {
    const outOfRange = await transcribedRecording();
    const unlinked = await transcribedRecording();
    const unknown = await transcribedRecording();
    const cases = [
      { recording: outOfRange, output: { ...goodLead, score: 150 }, reason: "Lead Assessment output is invalid" },
      { recording: unlinked, output: { ...goodLead, evidence: [{ turnIndex: 7, quote: "Thursday works." }] }, reason: "Lead Assessment evidence does not match the Transcript" },
      { recording: unknown, output: { ...goodLead, classification: "Hot Lead" }, reason: "Lead Assessment output is invalid" },
    ];

    for (const { recording, output, reason } of cases) {
      await expect(assessRecordingLead(dependencies(fakeResponder(output)), recording.id)).rejects.toThrow(reason);
      expect(await assessmentRows(recording.id)).toEqual({ assessment: undefined, evidence: [] });
      expect(await recordingRow(recording.id)).toMatchObject({
        transfer_state: "Stored",
        r2_object_key: "recording.wav",
        waveform_state: "Stored",
        transcript_state: "Completed",
        lead_assessment_state: "Failed",
        lead_assessment_failure_reason: reason,
      });
    }
  });

  describe.sequential("when OpenAI fails", () => {
    let recording: Awaited<ReturnType<typeof transcribedRecording>>;

    it("persists Failed with a secret-free reason and rethrows for retry", async () => {
      recording = await transcribedRecording();
      const responder = fakeResponder();
      responder.failure = new OpenAIError("OpenAI request failed (HTTP 429)");

      await expect(assessRecordingLead(dependencies(responder), recording.id)).rejects.toBe(responder.failure);

      expect(await recordingRow(recording.id)).toMatchObject({ lead_assessment_state: "Failed", lead_assessment_failure_reason: "OpenAI request failed (HTTP 429)" });
    });

    it("retries from Failed, clears the failure, and completes the assessment", async () => {
      await assessRecordingLead(dependencies(fakeResponder()), recording.id);

      expect(await recordingRow(recording.id)).toMatchObject({ lead_assessment_state: "Completed", lead_assessment_failure_reason: null });
      expect((await assessmentRows(recording.id)).evidence).toHaveLength(2);
    });
  });

  it("records an unexpected error or invalid stored turns with a reason that never repeats content", async () => {
    const unexpected = await transcribedRecording();
    const corrupt = await transcribedRecording({ storedTurns: [{ speaker: "Mixed", startMs: 0, endMs: 1, text: "Hi" }] });
    const responder = fakeResponder();
    responder.failure = new Error("Bearer sk-secret Thursday works.");

    await expect(assessRecordingLead(dependencies(responder), unexpected.id)).rejects.toBe(responder.failure);
    await expect(assessRecordingLead(dependencies(fakeResponder()), corrupt.id)).rejects.toThrow("Transcript turns are invalid");

    expect(await recordingRow(unexpected.id)).toMatchObject({ lead_assessment_state: "Failed", lead_assessment_failure_reason: "Lead Assessment failed" });
    expect(await recordingRow(corrupt.id)).toMatchObject({ lead_assessment_state: "Failed", lead_assessment_failure_reason: "Transcript turns are invalid" });
  });

  it("never calls OpenAI without a Completed Transcript, for an expired Recording, or for a missing Recording", async () => {
    const responder = fakeResponder();
    const pending = await transcribedRecording({ transcript: "Pending" });
    const skipped = await transcribedRecording({ transcript: "Skipped" });
    const expired = await transcribedRecording({ callStartedAt: new Date("2025-10-16T11:59:59.000Z") });
    const records = [pending, skipped, expired];
    const before = await Promise.all(records.map((recording) => recordingRow(recording.id)));

    for (const recording of records) await assessRecordingLead(dependencies(responder), recording.id);
    await expect(assessRecordingLead(dependencies(responder), randomUUID())).resolves.toBeUndefined();

    expect(responder.requests).toEqual([]);
    expect(await Promise.all(records.map((recording) => recordingRow(recording.id)))).toEqual(before);
  });

  it("never calls OpenAI for a Recording whose media an Operator purged", async () => {
    const responder = fakeResponder();
    const purged = await transcribedRecording({ purgedAt: days(0) });
    const before = await recordingRow(purged.id);

    await expect(assessRecordingLead(dependencies(responder), purged.id)).resolves.toBeUndefined();

    expect(responder.requests).toEqual([]);
    expect(await assessmentRows(purged.id)).toEqual({ assessment: undefined, evidence: [] });
    expect(await recordingRow(purged.id)).toEqual(before);
  });

  it("stores no assessment or evidence when a purge commits while OpenAI assesses the Transcript", async () => {
    const responder = fakeResponder();
    const recording = await transcribedRecording();
    responder.during = async () => {
      await database!.query("update recording set media_purged_at = $2 where id = $1", [recording.id, now]);
      await database!.query("delete from transcript where recording_id = $1", [recording.id]);
    };

    await expect(assessRecordingLead(dependencies(responder), recording.id)).resolves.toBeUndefined();

    expect(await assessmentRows(recording.id)).toEqual({ assessment: undefined, evidence: [] });
    expect(await recordingRow(recording.id)).toMatchObject({ lead_assessment_state: "Pending", lead_assessment_failure_reason: null });
  });

  it("ends cleanly without recording Failed when OpenAI fails after a purge committed", async () => {
    const responder = fakeResponder();
    const recording = await transcribedRecording();
    responder.failure = new OpenAIError("OpenAI request failed (HTTP 500)");
    responder.during = async () => {
      await database!.query("update recording set media_purged_at = $2 where id = $1", [recording.id, now]);
      await database!.query("delete from transcript where recording_id = $1", [recording.id]);
    };

    await expect(assessRecordingLead(dependencies(responder), recording.id)).resolves.toBeUndefined();

    expect(await recordingRow(recording.id)).toMatchObject({ lead_assessment_state: "Pending", lead_assessment_failure_reason: null });
    await expect(database!.query("select 1 from call_event where call_id = $1 and kind = 'lead_assessment_failed'", [recording.callId])).resolves.toMatchObject({ rowCount: 0 });
  });
});

describe("Recording Lead Assessment Call events", () => {
  async function callEvents(callId: string): Promise<{ kind: string; detail: Record<string, unknown> }[]> {
    const result = await database!.query<{ kind: string; detail: Record<string, unknown> }>("select kind, detail from call_event where call_id = $1 order by occurred_at, id", [callId]);
    return result.rows;
  }

  it("appends one Lead Assessment failed across repeated failures and then Lead Assessment completed with its classification and score", async () => {
    const recording = await transcribedRecording();
    const failing = fakeResponder();
    failing.failure = new OpenAIError("OpenAI request failed (HTTP 429)");

    await expect(assessRecordingLead(dependencies(failing), recording.id)).rejects.toBe(failing.failure);
    await expect(assessRecordingLead(dependencies(failing), recording.id)).rejects.toBe(failing.failure);
    expect(await callEvents(recording.callId)).toEqual([{ kind: "lead_assessment_failed", detail: {} }]);

    await assessRecordingLead(dependencies(fakeResponder()), recording.id);
    await assessRecordingLead(dependencies(fakeResponder()), recording.id);

    expect(await callEvents(recording.callId)).toEqual([
      { kind: "lead_assessment_failed", detail: {} },
      { kind: "lead_assessment_completed", detail: { classification: "Good Lead", score: 88 } },
    ]);
  });
});
