/**
 * -------------------------------------------------------------------------
 * @file   inbound-calls.ts
 * @brief  Persists the Call lifecycle from accepted Twilio webhooks.
 *
 * @description
 *  Creates or resumes one Call per Twilio CallSid, pins the Workspace's
 *  latest published Flow Version when the Call starts, and records every
 *  accepted provider event exactly once.
 *
 * @remarks
 *  Idempotency comes from natural keys: the Call is unique per Organization
 *  and CallSid, and each provider event is unique per Organization and an
 *  idempotency key derived from the CallSid and event kind. Inserts use
 *  "on conflict do nothing" so concurrent duplicate deliveries are safe.
 *  Event payloads keep only an allowlist of Twilio fields; caller numbers
 *  live on the Call, not in duplicated event copies.
 *
 * @see
 *  data/twilio-webhook-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { parseCallFlowGraph } from "@/data/call-flow";
import { renderCallStart, type VoiceUrls } from "@/data/voice-response";

export interface CallRecord {
  id: string;
  organizationId: string;
  workspaceId: string;
  flowVersionId: string;
  twilioCallSid: string;
  state: "In Progress" | "Completed";
}

export type VoiceWebhookResult = { kind: "call"; call: CallRecord; twiml: string } | { kind: "unknown_assignment" };

export interface InboundCalls {
  receiveVoiceWebhook(assignmentId: string, params: Readonly<Record<string, string>>, urls: VoiceUrls): Promise<VoiceWebhookResult>;
}

const payloadFields = [
  "AccountSid",
  "CallSid",
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
];

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

type AssignmentRow = { organization_id: string; workspace_id: string; phone_number: string };

type CallRow = { id: string; organization_id: string; workspace_id: string; flow_version_id: string; twilio_call_sid: string; state: CallRecord["state"] };

function toCallRecord(row: CallRow): CallRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    flowVersionId: row.flow_version_id,
    twilioCallSid: row.twilio_call_sid,
    state: row.state,
  };
}

export function createInboundCalls(options: { pool: Pool }): InboundCalls {
  return {
    async receiveVoiceWebhook(assignmentId, params, urls) {
      return withTransaction(options.pool, async (client) => {
        const assignment = (
          await client.query<AssignmentRow>("select organization_id, workspace_id, phone_number from number_assignment where id = $1", [assignmentId])
        ).rows[0];
        if (!assignment) return { kind: "unknown_assignment" };
        const now = new Date();
        await client.query(
          `insert into call
             (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid,
              tracking_number, caller_number, started_at, created_at, updated_at)
           select $1, $2, $3, $4, v.id, $5, $6, $7, $8, $8, $8
             from flow_version v
            where v.workspace_id = $3
            order by v.version desc
            limit 1
           on conflict (organization_id, twilio_call_sid) do nothing`,
          [randomUUID(), assignment.organization_id, assignment.workspace_id, assignmentId, params.CallSid, assignment.phone_number, params.From || null, now],
        );
        const call = (
          await client.query<CallRow>(
            "select id, organization_id, workspace_id, flow_version_id, twilio_call_sid, state from call where organization_id = $1 and twilio_call_sid = $2",
            [assignment.organization_id, params.CallSid],
          )
        ).rows[0];
        await client.query(
          `insert into provider_event
             (id, organization_id, number_assignment_id, call_id, idempotency_key, kind, disposition, payload, received_at)
           values ($1, $2, $3, $4, $5, 'voice', 'accepted', $6, $7)
           on conflict (organization_id, idempotency_key) do nothing`,
          [randomUUID(), assignment.organization_id, assignmentId, call.id, `${params.CallSid}:voice`, JSON.stringify(eventPayload(params)), now],
        );
        const version = (await client.query<{ graph: unknown }>("select graph from flow_version where id = $1", [call.flow_version_id])).rows[0];
        const graph = parseCallFlowGraph(version?.graph);
        const step = graph
          ? renderCallStart(graph, urls)
          : { twiml: '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>', forwardNodeId: null, outcome: { outcome: "Failed" as const, reason: "flow_unreadable" } };
        await client.query(
          `update call
              set forward_node_id = coalesce(forward_node_id, $2),
                  outcome = coalesce(outcome, $3),
                  outcome_reason = coalesce(outcome_reason, $4),
                  updated_at = $5
            where id = $1`,
          [call.id, step.forwardNodeId, step.outcome?.outcome ?? null, step.outcome?.reason ?? null, now],
        );
        return { kind: "call", call: toCallRecord(call), twiml: step.twiml };
      });
    },
  };
}
