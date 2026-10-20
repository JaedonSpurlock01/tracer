/**
 * -------------------------------------------------------------------------
 * @file   call-export-documents.ts
 * @brief  Builds the Transcript and Lead Assessment files of a single-Call Export Call.
 *
 * @description
 *  Reads the exported Recording's Transcript, Lead Assessment with its
 *  evidence, and the Call's Lead Review, and renders them as the files an
 *  Export Call ZIP adds beside the MP3 and manifest: `transcript.txt`, one
 *  speaker-labeled turn per line prefixed with its start time as
 *  [hh:mm:ss], and `lead-assessment.json`, holding the Lead Assessment
 *  fields, the Lead Review, and the effective Lead classification with
 *  Lead Review precedence. Each file appears only when its content exists.
 *
 * @remarks
 *  Transcript turns and evidence quotes are Recording content, so report
 *  generation adds these files only beside an included MP3, which is never
 *  past the media expiry, as on Call Detail. Model usage
 *  and cost stay out of the export, and only the reviewer's name is read
 *  from the Lead Review.
 *
 * @see
 *  data/report-generation.ts
 *  data/call-details.ts
 *  data/transcript.ts
 *  data/lead-reviews.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import { effectiveLeadClassification, type LeadClassification } from "@/data/lead-classification";
import { findLeadReview } from "@/data/lead-reviews";
import { parseTranscriptTurns, type TranscriptTurn } from "@/data/transcript";

export interface CallExportDocument {
  name: string;
  bytes: Uint8Array;
}

function timestamp(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((part) => String(part).padStart(2, "0")).join(":");
}

function transcriptText(turns: readonly TranscriptTurn[]): string {
  return turns.map((turn) => `[${timestamp(turn.startMs)}] ${turn.speaker}: ${turn.text}\n`).join("");
}

export async function callExportDocuments(pool: Pool, organizationId: string, call: { id: string; recordingId: string }): Promise<CallExportDocument[]> {
  const encoder = new TextEncoder();
  const documents: CallExportDocument[] = [];
  const turns = (await pool.query<{ turns: unknown }>("select turns from transcript where recording_id = $1 and organization_id = $2", [call.recordingId, organizationId])).rows[0]?.turns;
  if (turns !== undefined) documents.push({ name: "transcript.txt", bytes: encoder.encode(transcriptText(parseTranscriptTurns(turns))) });
  const assessment = (
    await pool.query<{ id: string; classification: LeadClassification; score: number; summary: string; rationale: string; processed_at: Date }>(
      "select id, classification, score, summary, rationale, processed_at from lead_assessment where recording_id = $1 and organization_id = $2",
      [call.recordingId, organizationId],
    )
  ).rows[0];
  const leadReview = await findLeadReview(pool, organizationId, call.id);
  if (!assessment && !leadReview) return documents;
  const evidence = assessment
    ? (await pool.query<{ turn_index: number; start_ms: number; quote: string }>("select turn_index, start_ms, quote from lead_assessment_evidence where lead_assessment_id = $1 order by position", [assessment.id])).rows
    : [];
  const document = {
    callId: call.id,
    effectiveLeadClassification: effectiveLeadClassification({ review: leadReview?.classification ?? null, assessment: assessment?.classification ?? null }),
    leadAssessment: assessment
      ? {
          classification: assessment.classification,
          score: assessment.score,
          summary: assessment.summary,
          rationale: assessment.rationale,
          processedAt: assessment.processed_at.toISOString(),
          evidence: evidence.map((item) => ({ turnIndex: item.turn_index, startMs: item.start_ms, quote: item.quote })),
        }
      : null,
    leadReview,
  };
  documents.push({ name: "lead-assessment.json", bytes: encoder.encode(`${JSON.stringify(document, null, 2)}\n`) });
  return documents;
}
