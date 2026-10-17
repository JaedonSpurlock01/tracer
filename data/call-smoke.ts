/**
 * -------------------------------------------------------------------------
 * @file   call-smoke.ts
 * @brief  Inspects and replays persisted Calls for the Staging call smoke check.
 *
 * @description
 *  Reports the newest Calls placed to a Tracking Number with their canonical
 *  state, Call Outcome, voicemail capture, and provider events, and replays a
 *  Call's accepted Keypad Gate, Forward Call, voicemail recording, and status
 *  callbacks as freshly signed Twilio requests to prove that duplicate
 *  delivery leaves the Call unchanged.
 *
 * @remarks
 *  Replay resends only the allowlisted fields Tracer stored for each event,
 *  which is everything the callback handlers read. The node and Keypad Gate
 *  attempt come from the event's idempotency key because Tracer does not
 *  store the request URL.
 *
 * @see
 *  scripts/staging-call-smoke.ts
 *  data/inbound-calls.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import { signTwilioRequest } from "@/data/twilio-signature";

export interface SmokeEvent {
  kind: string;
  disposition: string;
  status: string | null;
  receivedAt: string;
}

export interface SmokeCall {
  id: string;
  twilioCallSid: string;
  state: string;
  outcome: string | null;
  outcomeReason: string | null;
  forwardStatus: string | null;
  durationSeconds: number | null;
  voicemailDurationSeconds: number | null;
  startedAt: string;
  endedAt: string | null;
  events: SmokeEvent[];
}

type CallRow = {
  id: string;
  twilio_call_sid: string;
  state: string;
  outcome: string | null;
  outcome_reason: string | null;
  forward_status: string | null;
  duration_seconds: number | null;
  voicemail_duration_seconds: number | null;
  started_at: Date;
  ended_at: Date | null;
};

type EventRow = {
  call_id: string;
  number_assignment_id: string | null;
  idempotency_key: string;
  kind: string;
  disposition: string;
  payload: Record<string, string>;
  received_at: Date;
};

async function callEvents(pool: Pool, callIds: string[]): Promise<EventRow[]> {
  const result = await pool.query<EventRow>(
    `select call_id, number_assignment_id, idempotency_key, kind, disposition, payload, received_at
       from provider_event where call_id = any($1::text[])
      order by received_at, id`,
    [callIds],
  );
  return result.rows;
}

export async function reportTrackingNumberCalls(pool: Pool, trackingNumber: string, limit: number): Promise<SmokeCall[]> {
  const calls = await pool.query<CallRow>(
    `select id, twilio_call_sid, state, outcome, outcome_reason, forward_status, duration_seconds, voicemail_duration_seconds, started_at, ended_at
       from call where tracking_number = $1
      order by started_at desc, id desc
      limit $2`,
    [trackingNumber, limit],
  );
  const events = await callEvents(pool, calls.rows.map((call) => call.id));
  return calls.rows.map((call) => ({
    id: call.id,
    twilioCallSid: call.twilio_call_sid,
    state: call.state,
    outcome: call.outcome,
    outcomeReason: call.outcome_reason,
    forwardStatus: call.forward_status,
    durationSeconds: call.duration_seconds,
    voicemailDurationSeconds: call.voicemail_duration_seconds,
    startedAt: call.started_at.toISOString(),
    endedAt: call.ended_at?.toISOString() ?? null,
    events: events
      .filter((event) => event.call_id === call.id)
      .map((event) => ({ kind: event.kind, disposition: event.disposition, status: event.payload.CallStatus ?? event.payload.RecordingStatus ?? null, receivedAt: event.received_at.toISOString() })),
  }));
}

async function callSnapshot(pool: Pool, callId: string): Promise<string> {
  const call = await pool.query("select * from call where id = $1", [callId]);
  const events = await pool.query<{ count: number }>("select count(*)::int as count from provider_event where call_id = $1", [callId]);
  return JSON.stringify({ call: call.rows[0], events: events.rows[0].count });
}

function replayPath(event: EventRow): string | null {
  if (!event.number_assignment_id) return null;
  if (event.kind === "status") return `/api/twilio/status/${event.number_assignment_id}`;
  const parts = event.idempotency_key.split(":");
  if (parts.length < 4) return null;
  const node = encodeURIComponent(parts.slice(2, -1).join(":"));
  const last = parts[parts.length - 1];
  if (event.kind === "forward_status") return `/api/twilio/forward-status/${event.number_assignment_id}?node=${node}`;
  if (event.kind === "voicemail_status") return `/api/twilio/voicemail-status/${event.number_assignment_id}?node=${node}`;
  if (event.kind === "gather") return `/api/twilio/gather/${event.number_assignment_id}?node=${node}&attempt=${last}`;
  return null;
}

export async function replayCallCallbacks(options: {
  pool: Pool;
  callId: string;
  baseURL: string;
  authToken: string;
  send: (request: Request) => Promise<Response>;
}): Promise<{ replayed: number; rejected: number; unchanged: boolean }> {
  const baseURL = options.baseURL.replace(/\/$/, "");
  const before = await callSnapshot(options.pool, options.callId);
  const events = (await callEvents(options.pool, [options.callId])).filter((event) => event.disposition === "accepted");
  let replayed = 0;
  let rejected = 0;
  for (const event of events) {
    const path = replayPath(event);
    if (!path) continue;
    const url = `${baseURL}${path}`;
    const signature = await signTwilioRequest({ authToken: options.authToken, url, params: event.payload });
    const response = await options.send(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature },
        body: new URLSearchParams(event.payload).toString(),
      }),
    );
    if (response.ok) replayed += 1;
    else rejected += 1;
  }
  return { replayed, rejected, unchanged: (await callSnapshot(options.pool, options.callId)) === before };
}
