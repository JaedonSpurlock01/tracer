/**
 * -------------------------------------------------------------------------
 * @file   recording-lead-assessment.ts
 * @brief  Assesses a Completed Transcript and stores the immutable Lead Assessment.
 *
 * @description
 *  Reads a Recording's Completed Transcript and its Workspace name, asks
 *  OpenAI for a structured Lead Assessment, validates the output against
 *  the Transcript turns, and commits the assessment, its evidence snippets,
 *  its token usage and cost, and the Completed state together. A Recording
 *  whose Lead Assessment is not Pending or Failed, whose Transcript is not
 *  Completed or no longer exists, whose media expired 12 months after its
 *  Call started or was purged, or that no longer exists is left untouched
 *  without calling OpenAI.
 *
 * @remarks
 *  The Recording row is locked only to commit, never during the OpenAI
 *  call, for the same reason as transcription; the commit re-checks the
 *  state and that the media is still retained under the lock, so neither a
 *  concurrent duplicate run nor a purge that committed meanwhile lets an
 *  assessment or its evidence land, and a failure after a purge or expiry
 *  ends cleanly without a Failed state, event, or retry. Evidence is stored apart from the assessment so a
 *  purge can delete Transcript-derived text while the assessment remains.
 *  A failure is recorded as Failed with a secret-free reason, never model
 *  output or an unexpected error's message, and rethrown for Trigger.dev
 *  to retry; the Transcript, transfer, and waveform are never touched. The
 *  Completed commit and the Failed update each append their Call event
 *  atomically, and a repeated failure keeps its single failed event.
 *
 * @see
 *  data/lead-assessment.ts
 *  data/openai-client.ts
 *  data/recording-transcription.ts
 *  trigger/recording-lead-assessment.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Database } from "@/data/database";

import { appendCallEvent } from "@/data/call-events";
import { LeadAssessmentError, leadAssessmentCostUsd, leadAssessmentModel, leadAssessmentRequest, parseLeadAssessment, type LeadAssessmentResult } from "@/data/lead-assessment";
import { OpenAIError, type StructuredResponder } from "@/data/openai-client";
import { recordingMediaRetainedSql } from "@/data/recording-media";
import { parseTranscriptTurns, TranscriptError } from "@/data/transcript";

export interface RecordingLeadAssessmentDependencies {
  database: Database;
  responder: StructuredResponder;
  now: () => Date;
}

type AssessmentRow = {
  id: string;
  organization_id: string;
  call_id: string;
  lead_assessment_state: string | null;
  workspace_name: string;
  turns: unknown;
  media_retained: boolean;
};

const runnableStates = ["Pending", "Failed"];

function failureReason(error: unknown): string {
  return error instanceof OpenAIError || error instanceof LeadAssessmentError || error instanceof TranscriptError ? error.message : "Lead Assessment failed";
}

async function complete(
  deps: RecordingLeadAssessmentDependencies,
  row: AssessmentRow,
  result: LeadAssessmentResult,
  usage: { inputTokens: number; outputTokens: number },
): Promise<void> {
  await deps.database.transaction(async (client) => {
    const now = deps.now();
    const locked = await client.query<{ lead_assessment_state: string | null; media_retained: boolean }>(
      `select r.lead_assessment_state, ${recordingMediaRetainedSql("r", "c.started_at", "$2")} as media_retained
         from recording r
         join call c on c.id = r.call_id
        where r.id = $1
          for update of r`,
      [row.id, now],
    );
    const current = locked.rows[0];
    if (!current?.media_retained || !runnableStates.includes(current.lead_assessment_state ?? "")) {
      return;
    }
    const id = randomUUID();
    await client.query(
      `insert into lead_assessment (id, organization_id, call_id, recording_id, classification, score, summary, rationale, model, input_tokens, output_tokens, cost_usd, processed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        row.organization_id,
        row.call_id,
        row.id,
        result.classification,
        result.score,
        result.summary,
        result.rationale,
        leadAssessmentModel,
        usage.inputTokens,
        usage.outputTokens,
        leadAssessmentCostUsd(usage.inputTokens, usage.outputTokens),
        now,
      ],
    );
    for (const [position, evidence] of result.evidence.entries()) {
      await client.query(
        "insert into lead_assessment_evidence (lead_assessment_id, position, turn_index, start_ms, quote) values ($1, $2, $3, $4, $5)",
        [id, position, evidence.turnIndex, evidence.startMs, evidence.quote],
      );
    }
    await client.query("update recording set lead_assessment_state = 'Completed', lead_assessment_failure_reason = null, updated_at = $2 where id = $1", [row.id, now]);
    await appendCallEvent(client, {
      callId: row.call_id,
      kind: "lead_assessment_completed",
      key: `lead_assessment_completed:${row.id}`,
      occurredAt: now,
      detail: { classification: result.classification, score: result.score },
    });
  });
}

export async function assessRecordingLead(deps: RecordingLeadAssessmentDependencies, recordingId: string): Promise<void> {
  const result = await deps.database.query<AssessmentRow>(
    `select r.id, r.organization_id, r.call_id, r.lead_assessment_state, w.name as workspace_name, t.turns,
            ${recordingMediaRetainedSql("r", "c.started_at", "$2")} as media_retained
       from recording r
       join call c on c.id = r.call_id
       join workspace w on w.id = r.workspace_id
       join transcript t on t.recording_id = r.id
      where r.id = $1 and r.transfer_state = 'Stored' and r.transcript_state = 'Completed'`,
    [recordingId, deps.now()],
  );
  const row = result.rows[0];
  if (!row?.media_retained || !runnableStates.includes(row.lead_assessment_state ?? "")) return;
  try {
    const turns = parseTranscriptTurns(row.turns);
    const response = await deps.responder.respond(leadAssessmentRequest(row.workspace_name, turns));
    await complete(deps, row, parseLeadAssessment(response.text, turns), response);
  } catch (error) {
    const failed = await deps.database.query<{ media_retained: boolean }>(
      `with failed as (
         update recording r set lead_assessment_state = 'Failed', lead_assessment_failure_reason = $2, updated_at = $3
           from call c
          where r.id = $1 and c.id = r.call_id and r.lead_assessment_state in ('Pending', 'Failed') and ${recordingMediaRetainedSql("r", "c.started_at", "$3")}
          returning r.organization_id, r.workspace_id, r.call_id
       ), event as (
         insert into call_event (organization_id, workspace_id, call_id, kind, occurred_at, idempotency_key)
         select organization_id, workspace_id, call_id, 'lead_assessment_failed', $3, 'lead_assessment_failed:' || $1 from failed
         on conflict (organization_id, idempotency_key) do nothing
       )
       select ${recordingMediaRetainedSql("r", "c.started_at", "$3")} as media_retained
         from recording r
         join call c on c.id = r.call_id
        where r.id = $1`,
      [row.id, failureReason(error), deps.now()],
    );
    if (!failed.rows[0]?.media_retained) return;
    throw error;
  }
}
