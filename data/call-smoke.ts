/**
 * -------------------------------------------------------------------------
 * @file   call-smoke.ts
 * @brief  Inspects and replays persisted Calls for the Staging call smoke check.
 *
 * @description
 *  Reports the newest Calls placed to a Tracking Number with their canonical
 *  state, Call Outcome, voicemail capture, provider events, and Recordings,
 *  and replays a Call's accepted Keypad Gate, Forward Call, voicemail
 *  recording, connected Recording, and status callbacks as freshly signed
 *  Twilio requests to prove that duplicate delivery leaves the Call
 *  unchanged.
 *
 * @remarks
 *  Replay resends only the allowlisted fields Tracer stored for each event,
 *  which is everything the callback handlers read. The node and Keypad Gate
 *  attempt come from the event's idempotency key because Tracer does not
 *  store the request URL. Recordings are reported by state only, never by
 *  object key or Twilio Recording SID.
 *
 * @see
 *  scripts/staging-call-smoke.ts
 *  data/inbound-calls.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Queryable } from "@/data/database";

import { signTwilioRequest } from "@/data/twilio-signature";

export interface SmokeEvent {
  kind: string;
  disposition: string;
  status: string | null;
  receivedAt: string;
}

export interface SmokeRecording {
  source: string;
  channels: number;
  transferState: string;
  twilioCleanupState: string;
  failureStage: string | null;
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
  recordings: SmokeRecording[];
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

type RecordingRow = {
  call_id: string;
  source: string;
  channels: number;
  transfer_state: string;
  twilio_cleanup_state: string;
  failure_stage: string | null;
};

async function callRecordings(database: Queryable, callIds: string[]): Promise<RecordingRow[]> {
  const result = await database.query<RecordingRow>(
    `select call_id, source, channels, transfer_state, twilio_cleanup_state, failure_stage
       from recording where call_id = any($1::text[])
      order by created_at, id`,
    [callIds],
  );
  return result.rows;
}

async function callEvents(database: Queryable, callIds: string[]): Promise<EventRow[]> {
  const result = await database.query<EventRow>(
    `select call_id, number_assignment_id, idempotency_key, kind, disposition, payload, received_at
       from provider_event where call_id = any($1::text[])
      order by received_at, id`,
    [callIds],
  );
  return result.rows;
}

export async function reportTrackingNumberCalls(database: Queryable, trackingNumber: string, limit: number): Promise<SmokeCall[]> {
  const calls = await database.query<CallRow>(
    `select id, twilio_call_sid, state, outcome, outcome_reason, forward_status, duration_seconds, voicemail_duration_seconds, started_at, ended_at
       from call where tracking_number = $1
      order by started_at desc, id desc
      limit $2`,
    [trackingNumber, limit],
  );
  const events = await callEvents(database, calls.rows.map((call) => call.id));
  const recordings = await callRecordings(database, calls.rows.map((call) => call.id));
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
    recordings: recordings
      .filter((recording) => recording.call_id === call.id)
      .map((recording) => ({
        source: recording.source,
        channels: recording.channels,
        transferState: recording.transfer_state,
        twilioCleanupState: recording.twilio_cleanup_state,
        failureStage: recording.failure_stage,
      })),
  }));
}

async function callSnapshot(database: Queryable, callId: string): Promise<string> {
  const call = await database.query("select * from call where id = $1", [callId]);
  const events = await database.query<{ count: number }>("select count(*)::int as count from provider_event where call_id = $1", [callId]);
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
  if (event.kind === "recording_status") return `/api/twilio/recording-status/${event.number_assignment_id}?node=${node}`;
  if (event.kind === "gather") return `/api/twilio/gather/${event.number_assignment_id}?node=${node}&attempt=${last}`;
  return null;
}

export async function replayCallCallbacks(options: {
  database: Queryable;
  callId: string;
  baseURL: string;
  authToken: string;
  send: (request: Request) => Promise<Response>;
}): Promise<{ replayed: number; rejected: number; unchanged: boolean }> {
  const baseURL = options.baseURL.replace(/\/$/, "");
  const before = await callSnapshot(options.database, options.callId);
  const events = (await callEvents(options.database, [options.callId])).filter((event) => event.disposition === "accepted");
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
  return { replayed, rejected, unchanged: (await callSnapshot(options.database, options.callId)) === before };
}
