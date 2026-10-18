/**
 * -------------------------------------------------------------------------
 * @file   call-details.ts
 * @brief  Reads one Call's detail and a Workspace's Recent Calls.
 *
 * @description
 *  Resolves the Workspace through the central Workspace authorization, then
 *  loads the Call scoped to that Workspace and Organization. Derives the
 *  Call facts, the Destination Number from the pinned Flow Version's
 *  Forward Call step, the connected duration from the forwarded leg, the
 *  spam-gate result from the pinned Keypad Gate and the keypad input,
 *  Recording availability from the transfer and waveform states and the
 *  shared media expiry, the Transcript and Lead Assessment of the selected
 *  Recording, a processing timeline from accepted provider events,
 *  Recording, Transcript, and Lead Assessment states, and the Lead Review,
 *  the current Lead Review, and the effective Lead classification from the
 *  Lead Review or the Recording's Lead Assessment. Lists the five newest
 *  Calls of a Workspace for Recent Calls. Shares the connected duration and
 *  Recording availability rules with the Calls list.
 *
 * @remarks
 *  The Twilio call SID and the secret-free Transcript and Lead Assessment
 *  failure reasons are added only for Operators, so they never reach a
 *  Client Viewer's payload. Object keys, Recording SIDs, provider payloads,
 *  and transfer and waveform failure reasons are never read into the
 *  result. Transcript turns and Transcript-derived evidence are read only
 *  before media expiry, while the non-content Lead Assessment fields stay.
 *  A Recording stored before analysis existed has no Transcript state and
 *  reads as Unavailable. A failure's time is the Recording's last update,
 *  as for the transfer and waveform stages.
 *
 * @see
 *  data/workspace-authorization.ts
 *  data/recording-media.ts
 *  data/calls.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import type { AnalysisSkipReason } from "@/data/analysis-eligibility";
import type { Actor } from "@/data/authorization";
import { parseCallFlowGraph, type CallFlowGraph, type OutcomeKind } from "@/data/call-flow";
import { effectiveLeadClassification, type EffectiveLeadClassification, type LeadClassification } from "@/data/lead-classification";
import { findLeadReview, type LeadReview } from "@/data/lead-reviews";
import { recordingMediaExpiredSql, recordingMediaExpiresAtSql } from "@/data/recording-media";
import type { WaveformLane } from "@/data/recording-waveform";
import { parseTranscriptTurns, type TranscriptTurn } from "@/data/transcript";
import { canManageWorkspaces, createReadableWorkspaces } from "@/data/workspace-authorization";

export type RecordingAvailability =
  | { state: "Ready"; id: string; channels: 1 | 2; lanes: WaveformLane[]; durationSeconds: number | null; waveform: boolean; expiresAt: string }
  | { state: "Processing"; stage: "transfer" | "waveform" }
  | { state: "Failed" }
  | { state: "Unavailable"; reason: "disabled" | "not_captured" }
  | { state: "Expired"; expiredAt: string };

export interface CallTranscript {
  state: "Pending" | "Completed" | "Failed" | "Skipped" | "Expired" | "Unavailable";
  skipReason?: AnalysisSkipReason;
  turns?: TranscriptTurn[];
  failureReason?: string;
}

export interface LeadAssessmentEvidence {
  turnIndex: number;
  startMs: number;
  quote: string;
}

export interface CallLeadAssessment {
  state: "Pending" | "Completed" | "Failed" | "Unavailable";
  classification?: LeadClassification;
  score?: number;
  summary?: string;
  rationale?: string;
  processedAt?: string;
  evidence?: LeadAssessmentEvidence[];
  failureReason?: string;
}

export type SpamGateResult = "Passed" | "Blocked" | "Not reached" | "Not used";

export interface CallTimelineEntry {
  id: string;
  label: string;
  status: "Completed" | "Pending" | "Failed";
  at: string;
}

export interface CallDetail {
  id: string;
  workspace: { id: string; name: string; reportingTimezone: string };
  callerNumber: string | null;
  trackingNumber: string;
  destinationNumber: string | null;
  state: "In Progress" | "Completed";
  outcome: OutcomeKind | null;
  startedAt: string;
  endedAt: string | null;
  totalDurationSeconds: number | null;
  connectedDurationSeconds: number | null;
  spamGate: SpamGateResult;
  recording: RecordingAvailability;
  transcript: CallTranscript;
  leadAssessment: CallLeadAssessment;
  timeline: CallTimelineEntry[];
  leadReview: LeadReview | null;
  effectiveLeadClassification: EffectiveLeadClassification;
  twilioCallSid?: string;
}

export type RecentCall = Pick<CallDetail, "id" | "callerNumber" | "state" | "outcome" | "startedAt" | "connectedDurationSeconds">;

export interface CallDetails {
  find(workspaceId: string, callId: string): Promise<CallDetail | null>;
  listRecent(workspaceId: string): Promise<RecentCall[] | null>;
}

const recentCallLimit = 5;

type CallRow = {
  id: string;
  twilio_call_sid: string;
  tracking_number: string;
  caller_number: string | null;
  state: CallDetail["state"];
  outcome: OutcomeKind | null;
  forward_node_id: string | null;
  started_at: Date;
  ended_at: Date | null;
  total_seconds: number | null;
  connected_seconds: number | null;
  graph: unknown;
};

type EventRow = {
  id: string;
  kind: string;
  idempotency_key: string;
  call_status: string | null;
  digits: string | null;
  recording_status: string | null;
  received_at: Date;
};

type RecordingRow = {
  id: string;
  created_at: Date;
  updated_at: Date;
  stored_at: Date | null;
  waveform_generated_at: Date | null;
  channels: 1 | 2;
  duration_seconds: number | null;
  transfer_state: "Pending" | "Stored" | "Failed";
  waveform_state: "Pending" | "Stored" | "Failed";
  transcript_state: "Pending" | "Completed" | "Failed" | "Skipped" | null;
  transcript_skip_reason: AnalysisSkipReason | null;
  transcript_failure_reason: string | null;
  transcript_completed_at: Date | null;
  lead_assessment_state: "Pending" | "Completed" | "Failed" | null;
  lead_assessment_failure_reason: string | null;
  expires_at: Date;
  expired: boolean;
};

type AssessmentRow = {
  id: string;
  classification: LeadClassification;
  score: number;
  summary: string;
  rationale: string;
  processed_at: Date;
};

interface Analysis {
  recording: RecordingRow | undefined;
  assessment: AssessmentRow | undefined;
  leadReview: LeadReview | null;
}

export const connectedSecondsSql = `case
  when c.answered_at is null then case when c.state = 'Completed' then 0 end
  else coalesce(
    (select (pe.payload->>'CallDuration')::int from provider_event pe
      where pe.call_id = c.id and pe.kind = 'forward_status' and pe.disposition = 'accepted'
        and pe.payload->>'CallStatus' = 'completed' and pe.payload->>'CallDuration' ~ '^[0-9]+$'
      order by pe.received_at desc limit 1),
    extract(epoch from c.ended_at - c.answered_at)::int)
end`;

function destinationNumber(graph: CallFlowGraph | null, forwardNodeId: string | null): string | null {
  const node = graph?.nodes.find((candidate) => candidate.id === forwardNodeId);
  return node?.type === "forward_call" ? node.destinationNumber : null;
}

const forwardLabels: Readonly<Record<string, [string, CallTimelineEntry["status"]]>> = {
  initiated: ["Forwarded to Destination Number", "Completed"],
  ringing: ["Destination ringing", "Completed"],
  "in-progress": ["Destination answered", "Completed"],
  completed: ["Forward Call completed", "Completed"],
  busy: ["Destination busy", "Completed"],
  "no-answer": ["Destination did not answer", "Completed"],
  canceled: ["Forward Call canceled", "Completed"],
  failed: ["Forward Call failed", "Failed"],
};
const terminalCallStatuses = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);

export type KeypadEvent = Pick<EventRow, "kind" | "idempotency_key" | "digits">;

function gatePassed(graph: CallFlowGraph | null, event: KeypadEvent): boolean {
  const gateNodeId = event.idempotency_key.split(":")[2];
  const gate = graph?.nodes.find((node) => node.id === gateNodeId);
  return gate?.type === "keypad_gate" && event.digits === gate.digit;
}

export function spamGateResult(graph: CallFlowGraph | null, outcome: OutcomeKind | null, events: KeypadEvent[]): SpamGateResult {
  if (!graph?.nodes.some((node) => node.type === "keypad_gate")) return "Not used";
  const gathers = events.filter((event) => event.kind === "gather");
  if (gathers.some((event) => gatePassed(graph, event))) return "Passed";
  return outcome === "Blocked" || gathers.length > 0 ? "Blocked" : "Not reached";
}

function eventEntry(graph: CallFlowGraph | null, event: EventRow): [string, CallTimelineEntry["status"]] | null {
  switch (event.kind) {
    case "voice":
      return ["Call received", "Completed"];
    case "gather":
      return [gatePassed(graph, event) ? "Keypad Gate passed" : "Keypad Gate not passed", "Completed"];
    case "whisper":
      return ["Whisper played", "Completed"];
    case "forward_status":
      return forwardLabels[event.call_status ?? ""] ?? null;
    case "voicemail_status":
      return event.recording_status === "completed" ? ["Voicemail captured", "Completed"] : ["Voicemail capture failed", "Failed"];
    case "recording_status":
      return event.recording_status === "completed" ? ["Recording captured", "Completed"] : ["Recording capture failed", "Failed"];
    case "status":
      if (!terminalCallStatuses.has(event.call_status ?? "")) return null;
      return event.call_status === "failed" ? ["Call failed", "Failed"] : ["Call ended", "Completed"];
    default:
      return null;
  }
}

function recordingEntries(recording: RecordingRow | undefined): CallTimelineEntry[] {
  if (!recording) return [];
  const entry = timelineEntry;
  if (recording.transfer_state === "Pending") return [entry("recording-transfer", "Recording transfer", "Pending", recording.created_at)];
  if (recording.transfer_state === "Failed" || !recording.stored_at) return [entry("recording-transfer", "Recording transfer failed", "Failed", recording.updated_at)];
  const stored = entry("recording-transfer", "Recording stored", "Completed", recording.stored_at);
  if (recording.waveform_state === "Stored" && recording.waveform_generated_at) return [stored, entry("recording-waveform", "Waveform generated", "Completed", recording.waveform_generated_at)];
  if (recording.waveform_state === "Failed") return [stored, entry("recording-waveform", "Waveform generation failed", "Failed", recording.updated_at)];
  return [stored, entry("recording-waveform", "Waveform generation", "Pending", recording.stored_at)];
}

function timelineEntry(id: string, label: string, status: CallTimelineEntry["status"], at: Date): CallTimelineEntry {
  return { id, label, status, at: at.toISOString() };
}

function transcriptEntries(recording: RecordingRow | undefined): CallTimelineEntry[] {
  if (!recording?.transcript_state || !recording.stored_at) return [];
  if (recording.transcript_state === "Skipped") return [timelineEntry("transcript", "Transcript skipped", "Completed", recording.stored_at)];
  const entries =
    recording.transcript_state === "Completed" && recording.transcript_completed_at
      ? [timelineEntry("transcript", "Transcript completed", "Completed", recording.transcript_completed_at)]
      : recording.expired
        ? []
        : recording.transcript_state === "Failed"
          ? [timelineEntry("transcript", "Transcription failed", "Failed", recording.updated_at)]
          : [timelineEntry("transcript", "Transcription", "Pending", recording.stored_at)];
  return recording.expired ? [...entries, timelineEntry("transcript-expiry", "Transcript expired", "Completed", recording.expires_at)] : entries;
}

function leadAssessmentEntries(recording: RecordingRow | undefined, assessment: AssessmentRow | undefined): CallTimelineEntry[] {
  if (!recording?.transcript_completed_at) return [];
  if (assessment) return [timelineEntry("lead-assessment", "Lead Assessment completed", "Completed", assessment.processed_at)];
  if (recording.expired) return [];
  if (recording.lead_assessment_state === "Failed") return [timelineEntry("lead-assessment", "Lead Assessment failed", "Failed", recording.updated_at)];
  if (recording.lead_assessment_state === "Pending") return [timelineEntry("lead-assessment", "Lead Assessment", "Pending", recording.transcript_completed_at)];
  return [];
}

function processingTimeline(graph: CallFlowGraph | null, events: EventRow[], analysis: Analysis): CallTimelineEntry[] {
  const providerEntries = events.flatMap((event): CallTimelineEntry[] => {
    const described = eventEntry(graph, event);
    return described ? [{ id: event.id, label: described[0], status: described[1], at: event.received_at.toISOString() }] : [];
  });
  const reviewEntries = analysis.leadReview ? [{ id: "lead-review", label: "Lead Review added", status: "Completed" as const, at: analysis.leadReview.reviewedAt }] : [];
  return [
    ...providerEntries,
    ...recordingEntries(analysis.recording),
    ...transcriptEntries(analysis.recording),
    ...leadAssessmentEntries(analysis.recording, analysis.assessment),
    ...reviewEntries,
  ].sort((left, right) => left.at.localeCompare(right.at));
}

function callTranscript(recording: RecordingRow | undefined, turns: unknown, operator: boolean): CallTranscript {
  const state = recording?.transcript_state;
  if (!recording || !state) return { state: "Unavailable" };
  if (state === "Skipped") return { state, skipReason: recording.transcript_skip_reason ?? undefined };
  if (recording.expired) return { state: "Expired" };
  if (state === "Completed") return turns === undefined ? { state: "Unavailable" } : { state, turns: parseTranscriptTurns(turns) };
  if (state === "Failed") return operator && recording.transcript_failure_reason ? { state, failureReason: recording.transcript_failure_reason } : { state };
  return { state };
}

function callLeadAssessment(recording: RecordingRow | undefined, assessment: AssessmentRow | undefined, evidence: LeadAssessmentEvidence[], operator: boolean): CallLeadAssessment {
  const state = recording?.lead_assessment_state;
  if (assessment) {
    const completed: CallLeadAssessment = {
      state: "Completed",
      classification: assessment.classification,
      score: assessment.score,
      summary: assessment.summary,
      rationale: assessment.rationale,
      processedAt: assessment.processed_at.toISOString(),
    };
    return recording?.expired ? completed : { ...completed, evidence };
  }
  if (!state || state === "Completed") return { state: "Unavailable" };
  if (state === "Failed") return operator && recording.lead_assessment_failure_reason ? { state, failureReason: recording.lead_assessment_failure_reason } : { state };
  return { state };
}

export type RecordingAvailabilityRow = Pick<RecordingRow, "id" | "channels" | "duration_seconds" | "transfer_state" | "waveform_state" | "expires_at" | "expired">;

export function recordingAvailability(recording: RecordingAvailabilityRow | undefined, graph: CallFlowGraph | null): RecordingAvailability {
  if (!recording) {
    const recorded = graph?.nodes.some((node) => node.type === "recording_disclosure") ?? false;
    return { state: "Unavailable", reason: recorded ? "not_captured" : "disabled" };
  }
  if (recording.expired) return { state: "Expired", expiredAt: recording.expires_at.toISOString() };
  if (recording.transfer_state === "Failed") return { state: "Failed" };
  if (recording.transfer_state === "Pending") return { state: "Processing", stage: "transfer" };
  if (recording.waveform_state === "Pending") return { state: "Processing", stage: "waveform" };
  return {
    state: "Ready",
    id: recording.id,
    channels: recording.channels,
    lanes: recording.channels === 2 ? ["Caller", "Business"] : ["Mixed"],
    durationSeconds: recording.duration_seconds,
    waveform: recording.waveform_state === "Stored",
    expiresAt: recording.expires_at.toISOString(),
  };
}

export function createCallDetails(pool: Pool, actor: Actor): CallDetails {
  const workspaces = createReadableWorkspaces(pool, actor);

  return {
    async find(workspaceId, callId) {
      const workspace = await workspaces.find(workspaceId);
      if (!workspace) return null;
      const result = await pool.query<CallRow>(
        `select c.id, c.twilio_call_sid, c.tracking_number, c.caller_number, c.state, c.outcome, c.forward_node_id, c.started_at, c.ended_at,
                coalesce(c.duration_seconds, extract(epoch from c.ended_at - c.started_at)::int) as total_seconds,
                ${connectedSecondsSql} as connected_seconds,
                f.graph
           from call c
           join flow_version f on f.id = c.flow_version_id
          where c.id = $1 and c.organization_id = $2 and c.workspace_id = $3`,
        [callId, actor.organizationId, workspace.id],
      );
      const row = result.rows[0];
      if (!row) return null;
      const recordings = await pool.query<RecordingRow>(
        `select r.id, r.created_at, r.updated_at, r.stored_at, r.waveform_generated_at, r.channels, r.duration_seconds, r.transfer_state, r.waveform_state,
                r.transcript_state, r.transcript_skip_reason, r.transcript_failure_reason, r.transcript_completed_at,
                r.lead_assessment_state, r.lead_assessment_failure_reason,
                ${recordingMediaExpiresAtSql("c.started_at")} as expires_at,
                ${recordingMediaExpiredSql("c.started_at", "now()")} as expired
           from recording r
           join call c on c.id = r.call_id
          where r.call_id = $1 and r.organization_id = $2
          order by r.source = 'connected' desc, r.created_at
          limit 1`,
        [row.id, actor.organizationId],
      );
      const events = await pool.query<EventRow>(
        `select id, kind, idempotency_key, payload->>'CallStatus' as call_status, payload->>'Digits' as digits,
                payload->>'RecordingStatus' as recording_status, received_at
           from provider_event
          where call_id = $1 and organization_id = $2 and disposition = 'accepted'
          order by received_at, id`,
        [row.id, actor.organizationId],
      );
      const graph = parseCallFlowGraph(row.graph);
      const recording = recordings.rows[0];
      const leadReview = await findLeadReview(pool, actor.organizationId, row.id);
      const operator = canManageWorkspaces(actor);
      const assessment = recording
        ? (
            await pool.query<AssessmentRow>(
              "select id, classification, score, summary, rationale, processed_at from lead_assessment where recording_id = $1 and organization_id = $2",
              [recording.id, actor.organizationId],
            )
          ).rows[0]
        : undefined;
      const contentAvailable = recording !== undefined && !recording.expired;
      const turns =
        contentAvailable && recording.transcript_state === "Completed"
          ? (await pool.query<{ turns: unknown }>("select turns from transcript where recording_id = $1 and organization_id = $2", [recording.id, actor.organizationId])).rows[0]?.turns
          : undefined;
      const evidence =
        contentAvailable && assessment
          ? (
              await pool.query<{ turn_index: number; start_ms: number; quote: string }>(
                "select turn_index, start_ms, quote from lead_assessment_evidence where lead_assessment_id = $1 order by position",
                [assessment.id],
              )
            ).rows.map((item) => ({ turnIndex: item.turn_index, startMs: item.start_ms, quote: item.quote }))
          : [];
      const detail: CallDetail = {
        id: row.id,
        workspace: { id: workspace.id, name: workspace.name, reportingTimezone: workspace.reportingTimezone },
        callerNumber: row.caller_number,
        trackingNumber: row.tracking_number,
        destinationNumber: destinationNumber(graph, row.forward_node_id),
        state: row.state,
        outcome: row.outcome,
        startedAt: row.started_at.toISOString(),
        endedAt: row.ended_at?.toISOString() ?? null,
        totalDurationSeconds: row.total_seconds,
        connectedDurationSeconds: row.connected_seconds,
        spamGate: spamGateResult(graph, row.outcome, events.rows),
        recording: recordingAvailability(recording, graph),
        transcript: callTranscript(recording, turns, operator),
        leadAssessment: callLeadAssessment(recording, assessment, evidence, operator),
        timeline: processingTimeline(graph, events.rows, { recording, assessment, leadReview }),
        leadReview,
        effectiveLeadClassification: effectiveLeadClassification({ review: leadReview?.classification ?? null, assessment: assessment?.classification ?? null }),
      };
      return operator ? { ...detail, twilioCallSid: row.twilio_call_sid } : detail;
    },

    async listRecent(workspaceId) {
      const workspace = await workspaces.find(workspaceId);
      if (!workspace) return null;
      const result = await pool.query<{ id: string; caller_number: string | null; state: CallDetail["state"]; outcome: OutcomeKind | null; started_at: Date; connected_seconds: number | null }>(
        `select c.id, c.caller_number, c.state, c.outcome, c.started_at, ${connectedSecondsSql} as connected_seconds
           from call c
          where c.organization_id = $1 and c.workspace_id = $2
          order by c.started_at desc, c.id
          limit $3`,
        [actor.organizationId, workspace.id, recentCallLimit],
      );
      return result.rows.map((row) => ({
        id: row.id,
        callerNumber: row.caller_number,
        state: row.state,
        outcome: row.outcome,
        startedAt: row.started_at.toISOString(),
        connectedDurationSeconds: row.connected_seconds,
      }));
    },
  };
}
