/**
 * -------------------------------------------------------------------------
 * @file   inbound-calls.ts
 * @brief  Persists the Call lifecycle from accepted Twilio webhooks.
 *
 * @description
 *  Creates or resumes one Call per Twilio CallSid, pins the Workspace's
 *  latest published Flow Version when the Call starts, records every accepted
 *  provider event exactly once, and derives one canonical Call Outcome from
 *  the Keypad Gate, Forward Call, and voicemail recording results and the end
 *  of the Incoming Call. A completed connected or voicemail recording creates
 *  one Recording and then requests its processing.
 *
 * @remarks
 *  Idempotency comes from natural keys: the Call is unique per Organization
 *  and CallSid, and each provider event is unique per Organization and an
 *  idempotency key built from the CallSid, event kind, and status. A
 *  duplicate event changes nothing. Twilio callbacks may arrive in any order,
 *  so a Call becomes Completed only once it has both ended and received an
 *  outcome. The forwarded call's own status callback is authoritative for
 *  Answered, Missed, Failed, and Abandoned, because Twilio does not guarantee
 *  the Dial action request when the caller hangs up first. A Call that ends
 *  before its Forward Call starts is provisionally Abandoned and may still be
 *  corrected by a late Forward Call result. Each rendered step also stores a
 *  pending outcome, the outcome that applies if the caller hangs up during
 *  it: Blocked during a Keypad Gate, and Missed or Abandoned during
 *  Voicemail. A completed voicemail recording corrects that provisional
 *  outcome to Voicemail and a failed one to Failed, in any callback order.
 *  Event payloads keep only an
 *  allowlist of Twilio fields; caller numbers live on the Call. A voice
 *  webhook for an ended Number Assignment or a non-Active Workspace is
 *  rejected with TwiML Reject, creates no Call, and is kept as a rejected
 *  provider event for diagnosis. A Recording is unique per Organization and
 *  Twilio RecordingSid, and its processing is requested only after the
 *  transaction that created it commits; a failed request leaves the
 *  Recording Pending for targeted recovery instead of failing the callback.
 *
 * @see
 *  data/twilio-webhook-handler.ts
 *  data/voice-response.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { parseCallFlowGraph, type CallFlowGraph } from "@/data/call-flow";
import { completedRecording, type CompletedRecording, type RecordingProcessing } from "@/data/recording";
import {
  correctableOutcomeReasons,
  renderCallStart,
  renderForwardResult,
  renderGatherResult,
  renderWhisper,
  voicemailCaptureOutcome,
  type VoiceContext,
  type VoiceStep,
  type VoiceUrls,
} from "@/data/voice-response";

export type TwimlResult = { kind: "twiml"; twiml: string } | { kind: "unknown_assignment" };

export type CallbackResult = { kind: "recorded" } | { kind: "unknown_assignment" };

export interface InboundCalls {
  receiveVoiceWebhook(assignmentId: string, params: Readonly<Record<string, string>>, urls: VoiceUrls): Promise<TwimlResult>;
  receiveGatherAction(assignmentId: string, gateNodeId: string, attempt: number, params: Readonly<Record<string, string>>, urls: VoiceUrls): Promise<TwimlResult>;
  receiveWhisper(assignmentId: string, whisperNodeId: string, params: Readonly<Record<string, string>>): Promise<TwimlResult>;
  receiveForwardAction(assignmentId: string, forwardNodeId: string, params: Readonly<Record<string, string>>, urls: VoiceUrls): Promise<TwimlResult>;
  receiveForwardStatus(assignmentId: string, forwardNodeId: string, params: Readonly<Record<string, string>>, urls: VoiceUrls): Promise<CallbackResult>;
  receiveVoicemailAction(assignmentId: string, voicemailNodeId: string, params: Readonly<Record<string, string>>): Promise<TwimlResult>;
  receiveVoicemailStatus(assignmentId: string, voicemailNodeId: string, params: Readonly<Record<string, string>>): Promise<CallbackResult>;
  receiveRecordingStatus(assignmentId: string, forwardNodeId: string, params: Readonly<Record<string, string>>): Promise<CallbackResult>;
  receiveCallStatus(assignmentId: string, params: Readonly<Record<string, string>>): Promise<CallbackResult>;
}

type EventKind = "voice" | "gather" | "whisper" | "forward" | "forward_status" | "voicemail" | "voicemail_status" | "recording_status" | "status";

type StoredRecording = { id: string; organizationId: string };

type Received = { result: CallbackResult; recording: StoredRecording | null };

type AssignmentRow = { organization_id: string; workspace_id: string; phone_number: string; reporting_timezone: string; recording_enabled: boolean; active: boolean };

type CallRow = {
  id: string;
  flow_version_id: string;
  outcome: string | null;
  outcome_reason: string | null;
  forward_started_at: Date | null;
  started_at: Date;
  pending_outcome: string | null;
  pending_outcome_reason: string | null;
};

const payloadFields = [
  "AccountSid",
  "CallSid",
  "ParentCallSid",
  "CallStatus",
  "Direction",
  "DialCallSid",
  "DialCallStatus",
  "DialCallDuration",
  "CallDuration",
  "ErrorCode",
  "ErrorMessage",
  "Timestamp",
  "SequenceNumber",
  "Digits",
  "RecordingSid",
  "RecordingStatus",
  "RecordingDuration",
  "RecordingChannels",
  "RecordingSource",
];

const terminalForwardStatuses = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);
const terminalCallStatuses = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);
const provisionalReason = "ended_before_forward";
const correctableReasons = [...correctableOutcomeReasons];
const hangup = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';
const reject = '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>';

function eventPayload(params: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(payloadFields.filter((field) => field in params).map((field) => [field, params[field]]));
}

async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function findAssignment(client: PoolClient, assignmentId: string): Promise<AssignmentRow | undefined> {
  const result = await client.query<AssignmentRow>(
    `select a.organization_id, a.workspace_id, a.phone_number, w.reporting_timezone, w.recording_enabled, a.ended_at is null and w.state = 'Active' as active
       from number_assignment a
       join workspace w on w.id = a.workspace_id
      where a.id = $1`,
    [assignmentId],
  );
  return result.rows[0];
}

async function findCall(client: PoolClient, organizationId: string, callSid: string | undefined): Promise<CallRow | undefined> {
  if (!callSid) return undefined;
  const result = await client.query<CallRow>(
    "select id, flow_version_id, outcome, outcome_reason, forward_started_at, started_at, pending_outcome, pending_outcome_reason from call where organization_id = $1 and twilio_call_sid = $2 for update",
    [organizationId, callSid],
  );
  return result.rows[0];
}

async function pinnedGraph(client: PoolClient, call: CallRow): Promise<CallFlowGraph | null> {
  const result = await client.query<{ graph: unknown }>("select graph from flow_version where id = $1", [call.flow_version_id]);
  return parseCallFlowGraph(result.rows[0]?.graph);
}

async function recordEvent(
  client: PoolClient,
  event: { organizationId: string; assignmentId: string; callId: string | null; key: string; kind: EventKind; disposition?: "accepted" | "rejected"; detail?: string; params: Readonly<Record<string, string>> },
): Promise<boolean> {
  const result = await client.query(
    `insert into provider_event
       (id, organization_id, number_assignment_id, call_id, idempotency_key, kind, disposition, detail, payload, received_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
     on conflict (organization_id, idempotency_key) do nothing`,
    [randomUUID(), event.organizationId, event.assignmentId, event.callId, event.key, event.kind, event.disposition ?? "accepted", event.detail ?? null, JSON.stringify(eventPayload(event.params))],
  );
  return result.rowCount === 1;
}

async function insertRecording(client: PoolClient, callId: string, recording: CompletedRecording | null): Promise<StoredRecording | null> {
  if (!recording) return null;
  const result = await client.query<{ id: string; organization_id: string }>(
    `insert into recording
       (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, created_at, updated_at)
     select $1, c.organization_id, c.workspace_id, c.id, $3, $4, $5, $6, now(), now()
       from call c
      where c.id = $2
     on conflict (organization_id, twilio_recording_sid) do nothing
     returning id, organization_id`,
    [randomUUID(), callId, recording.twilioRecordingSid, recording.source, recording.channels, recording.durationSeconds],
  );
  const row = result.rows[0];
  return row ? { id: row.id, organizationId: row.organization_id } : null;
}

async function requestProcessing(processing: RecordingProcessing, received: Received): Promise<CallbackResult> {
  if (received.recording) {
    await processing.request({ ...received.recording, idempotencyKey: `recording-processing:${received.recording.id}` }).catch(() => undefined);
  }
  return received.result;
}

async function finalize(client: PoolClient, callId: string): Promise<void> {
  await client.query(
    "update call set state = 'Completed', updated_at = now() where id = $1 and state <> 'Completed' and ended_at is not null and outcome is not null",
    [callId],
  );
}

function voiceContext(assignment: AssignmentRow, call: CallRow, urls: VoiceUrls): VoiceContext {
  return { urls, at: call.started_at, timeZone: assignment.reporting_timezone, recordingEnabled: assignment.recording_enabled };
}

async function applyStep(client: PoolClient, callId: string, step: VoiceStep): Promise<void> {
  await client.query(
    `update call
        set forward_node_id = coalesce(forward_node_id, $2),
            outcome = coalesce(outcome, $3),
            outcome_reason = coalesce(outcome_reason, $4),
            pending_outcome = $5,
            pending_outcome_reason = $6,
            updated_at = now()
      where id = $1 and outcome is null`,
    [callId, step.forwardNodeId, step.outcome?.outcome ?? null, step.outcome?.reason ?? null, step.pending?.outcome ?? null, step.pending?.reason ?? null],
  );
}

const unreadableFlow: VoiceStep = { twiml: hangup, forwardNodeId: null, outcome: { outcome: "Failed", reason: "flow_unreadable" }, pending: null };

const recorded: CallbackResult = { kind: "recorded" };

export function createInboundCalls(options: { pool: Pool; recordingProcessing: RecordingProcessing }): InboundCalls {
  return {
    async receiveVoiceWebhook(assignmentId, params, urls) {
      return withTransaction(options.pool, async (client) => {
        const assignment = await findAssignment(client, assignmentId);
        if (!assignment) return { kind: "unknown_assignment" };
        if (!assignment.active) {
          await recordEvent(client, { organizationId: assignment.organization_id, assignmentId, callId: null, key: `${params.CallSid}:voice`, kind: "voice", disposition: "rejected", detail: "inactive_assignment", params });
          return { kind: "twiml", twiml: reject };
        }
        await client.query(
          `insert into call
             (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid,
              tracking_number, caller_number, started_at, created_at, updated_at)
           select $1, $2, $3, $4, v.id, $5, $6, $7, now(), now(), now()
             from flow_version v
            where v.workspace_id = $3
            order by v.version desc
            limit 1
           on conflict (organization_id, twilio_call_sid) do nothing`,
          [randomUUID(), assignment.organization_id, assignment.workspace_id, assignmentId, params.CallSid, assignment.phone_number, params.From || null],
        );
        const call = await findCall(client, assignment.organization_id, params.CallSid);
        if (!call) return { kind: "twiml", twiml: hangup };
        const recorded = await recordEvent(client, { organizationId: assignment.organization_id, assignmentId, callId: call.id, key: `${params.CallSid}:voice`, kind: "voice", params });
        const graph = await pinnedGraph(client, call);
        const step = graph ? renderCallStart(graph, voiceContext(assignment, call, urls)) : unreadableFlow;
        if (recorded) await applyStep(client, call.id, step);
        return { kind: "twiml", twiml: step.twiml };
      });
    },

    async receiveGatherAction(assignmentId, gateNodeId, attempt, params, urls) {
      return withTransaction(options.pool, async (client) => {
        const assignment = await findAssignment(client, assignmentId);
        if (!assignment) return { kind: "unknown_assignment" };
        const call = await findCall(client, assignment.organization_id, params.CallSid);
        if (!call) return { kind: "twiml", twiml: hangup };
        const recorded = await recordEvent(client, { organizationId: assignment.organization_id, assignmentId, callId: call.id, key: `${params.CallSid}:gather:${gateNodeId}:${attempt}`, kind: "gather", params });
        const graph = await pinnedGraph(client, call);
        const step = graph ? renderGatherResult(graph, gateNodeId, params.Digits ?? "", attempt, voiceContext(assignment, call, urls)) : unreadableFlow;
        if (recorded) await applyStep(client, call.id, step);
        return { kind: "twiml", twiml: step.twiml };
      });
    },

    async receiveWhisper(assignmentId, whisperNodeId, params) {
      return withTransaction(options.pool, async (client) => {
        const assignment = await findAssignment(client, assignmentId);
        if (!assignment) return { kind: "unknown_assignment" };
        const call = await findCall(client, assignment.organization_id, params.ParentCallSid);
        if (call) await recordEvent(client, { organizationId: assignment.organization_id, assignmentId, callId: call.id, key: `${params.ParentCallSid}:whisper:${whisperNodeId}`, kind: "whisper", params });
        return { kind: "twiml", twiml: renderWhisper(call ? await pinnedGraph(client, call) : null, whisperNodeId) };
      });
    },

    async receiveForwardAction(assignmentId, forwardNodeId, params, urls) {
      return withTransaction(options.pool, async (client) => {
        const assignment = await findAssignment(client, assignmentId);
        if (!assignment) return { kind: "unknown_assignment" };
        const call = await findCall(client, assignment.organization_id, params.CallSid);
        if (!call) return { kind: "twiml", twiml: hangup };
        await recordEvent(client, { organizationId: assignment.organization_id, assignmentId, callId: call.id, key: `${params.CallSid}:forward:${forwardNodeId}`, kind: "forward", params });
        const graph = await pinnedGraph(client, call);
        const step = graph ? renderForwardResult(graph, forwardNodeId, params.DialCallStatus ?? "", voiceContext(assignment, call, urls)) : unreadableFlow;
        await client.query("update call set pending_outcome = $2, pending_outcome_reason = $3, updated_at = now() where id = $1 and outcome is null", [call.id, step.pending?.outcome ?? null, step.pending?.reason ?? null]);
        return { kind: "twiml", twiml: step.twiml };
      });
    },

    async receiveForwardStatus(assignmentId, forwardNodeId, params, urls) {
      return withTransaction(options.pool, async (client) => {
        const assignment = await findAssignment(client, assignmentId);
        if (!assignment) return { kind: "unknown_assignment" };
        const call = await findCall(client, assignment.organization_id, params.ParentCallSid);
        const status = params.CallStatus ?? "";
        const key = `${params.ParentCallSid}:forward_status:${forwardNodeId}:${status}`;
        if (!call) {
          await recordEvent(client, { organizationId: assignment.organization_id, assignmentId, callId: null, key, kind: "forward_status", disposition: "rejected", detail: "unknown_call", params });
          return { kind: "recorded" };
        }
        if (!(await recordEvent(client, { organizationId: assignment.organization_id, assignmentId, callId: call.id, key, kind: "forward_status", params }))) return { kind: "recorded" };
        if (status === "initiated") {
          await client.query("update call set forward_started_at = coalesce(forward_started_at, now()), updated_at = now() where id = $1", [call.id]);
        } else if (status === "in-progress") {
          await client.query("update call set answered_at = coalesce(answered_at, now()), updated_at = now() where id = $1", [call.id]);
        } else if (terminalForwardStatuses.has(status)) {
          const graph = await pinnedGraph(client, call);
          const step = graph ? renderForwardResult(graph, forwardNodeId, status, voiceContext(assignment, call, urls)) : unreadableFlow;
          const outcome = step.outcome ?? step.pending;
          await client.query(
            `update call
                set forward_started_at = coalesce(forward_started_at, now()),
                    forward_status = $2,
                    outcome = case when outcome is null or outcome_reason = any($5) then $3 else outcome end,
                    outcome_reason = case when outcome is null or outcome_reason = any($5) then $4 else outcome_reason end,
                    updated_at = now()
              where id = $1 and forward_status is null`,
            [call.id, status, outcome?.outcome ?? null, outcome?.reason ?? null, correctableReasons],
          );
          await finalize(client, call.id);
        }
        return { kind: "recorded" };
      });
    },

    async receiveVoicemailAction(assignmentId, voicemailNodeId, params) {
      return withTransaction(options.pool, async (client) => {
        const assignment = await findAssignment(client, assignmentId);
        if (!assignment) return { kind: "unknown_assignment" };
        const call = await findCall(client, assignment.organization_id, params.CallSid);
        if (call) await recordEvent(client, { organizationId: assignment.organization_id, assignmentId, callId: call.id, key: `${params.CallSid}:voicemail:${voicemailNodeId}`, kind: "voicemail", params });
        return { kind: "twiml", twiml: hangup };
      });
    },

    async receiveVoicemailStatus(assignmentId, voicemailNodeId, params) {
      return requestProcessing(options.recordingProcessing, await withTransaction(options.pool, async (client): Promise<Received> => {
        const assignment = await findAssignment(client, assignmentId);
        if (!assignment) return { result: { kind: "unknown_assignment" }, recording: null };
        const call = await findCall(client, assignment.organization_id, params.CallSid);
        const status = params.RecordingStatus ?? "";
        const key = `${params.CallSid}:voicemail_status:${voicemailNodeId}:${status}`;
        if (!call) {
          await recordEvent(client, { organizationId: assignment.organization_id, assignmentId, callId: null, key, kind: "voicemail_status", disposition: "rejected", detail: "unknown_call", params });
          return { result: recorded, recording: null };
        }
        if (!(await recordEvent(client, { organizationId: assignment.organization_id, assignmentId, callId: call.id, key, kind: "voicemail_status", params }))) return { result: recorded, recording: null };
        const duration = Number.parseInt(params.RecordingDuration ?? "", 10);
        const capture = voicemailCaptureOutcome(status, Number.isFinite(duration) ? duration : 0);
        await client.query(
          `update call
              set voicemail_recording_sid = coalesce(voicemail_recording_sid, $2),
                  voicemail_duration_seconds = coalesce(voicemail_duration_seconds, $3),
                  outcome = case when $4::text is not null and (outcome is null or outcome_reason = any($6)) then $4 else outcome end,
                  outcome_reason = case when $4::text is not null and (outcome is null or outcome_reason = any($6)) then $5 else outcome_reason end,
                  updated_at = now()
            where id = $1`,
          [call.id, status === "completed" ? params.RecordingSid || null : null, status === "completed" && Number.isFinite(duration) ? duration : null, capture?.outcome ?? null, capture?.reason ?? null, correctableReasons],
        );
        const recording = await insertRecording(client, call.id, capture?.outcome === "Voicemail" ? completedRecording("voicemail", params) : null);
        await finalize(client, call.id);
        return { result: recorded, recording };
      }));
    },

    async receiveRecordingStatus(assignmentId, forwardNodeId, params) {
      return requestProcessing(options.recordingProcessing, await withTransaction(options.pool, async (client): Promise<Received> => {
        const assignment = await findAssignment(client, assignmentId);
        if (!assignment) return { result: { kind: "unknown_assignment" }, recording: null };
        const call = await findCall(client, assignment.organization_id, params.CallSid);
        const key = `${params.CallSid}:recording_status:${forwardNodeId}:${params.RecordingStatus ?? ""}`;
        if (!call) {
          await recordEvent(client, { organizationId: assignment.organization_id, assignmentId, callId: null, key, kind: "recording_status", disposition: "rejected", detail: "unknown_call", params });
          return { result: recorded, recording: null };
        }
        if (!(await recordEvent(client, { organizationId: assignment.organization_id, assignmentId, callId: call.id, key, kind: "recording_status", params }))) return { result: recorded, recording: null };
        return { result: recorded, recording: await insertRecording(client, call.id, completedRecording("connected", params)) };
      }));
    },

    async receiveCallStatus(assignmentId, params) {
      return withTransaction(options.pool, async (client) => {
        const assignment = await findAssignment(client, assignmentId);
        if (!assignment) return { kind: "unknown_assignment" };
        const call = await findCall(client, assignment.organization_id, params.CallSid);
        const status = params.CallStatus ?? "";
        const key = `${params.CallSid}:status:${status}`;
        if (!call) {
          await recordEvent(client, { organizationId: assignment.organization_id, assignmentId, callId: null, key, kind: "status", disposition: "rejected", detail: "unknown_call", params });
          return { kind: "recorded" };
        }
        if (!(await recordEvent(client, { organizationId: assignment.organization_id, assignmentId, callId: call.id, key, kind: "status", params }))) return { kind: "recorded" };
        if (!terminalCallStatuses.has(status)) return { kind: "recorded" };
        const duration = Number.parseInt(params.CallDuration ?? "", 10);
        const endedOutcome = call.outcome === null && call.forward_started_at === null
          ? status === "failed"
            ? { outcome: "Failed", reason: "call_failed" }
            : call.pending_outcome && call.pending_outcome_reason
              ? { outcome: call.pending_outcome, reason: call.pending_outcome_reason }
              : { outcome: "Abandoned", reason: provisionalReason }
          : null;
        await client.query(
          `update call
              set ended_at = coalesce(ended_at, now()),
                  duration_seconds = coalesce(duration_seconds, $2),
                  outcome = coalesce(outcome, $3),
                  outcome_reason = coalesce(outcome_reason, $4),
                  updated_at = now()
            where id = $1`,
          [call.id, Number.isFinite(duration) ? duration : null, endedOutcome?.outcome ?? null, endedOutcome?.reason ?? null],
        );
        await finalize(client, call.id);
        return { kind: "recorded" };
      });
    },
  };
}
