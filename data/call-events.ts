/**
 * -------------------------------------------------------------------------
 * @file   call-events.ts
 * @brief  Appends lifecycle events to a Call's append-only event log.
 *
 * @description
 *  Each lifecycle writer calls these helpers inside the transaction that
 *  changes the Call, Recording, or Lead Review state the event records, so
 *  an event exists exactly when its state change commits. Activity reads
 *  the log to show every step of a Call with its exact time.
 *
 * @remarks
 *  Every event carries an idempotency key unique per Organization, and an
 *  insert that collides with an existing key does nothing, so Twilio
 *  retries, Trigger.dev retries, and recovery sweeps never duplicate an
 *  event. Keys name a state transition rather than an attempt, so a
 *  repeated failure of the same stage stays one event. Detail holds only
 *  display-safe facts such as an outcome or a skip reason, never Transcript
 *  text, phone numbers, provider payloads, or failure messages.
 *
 * @see
 *  data/schema.ts
 *  docs/DATA_PLATFORM.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { PoolClient } from "pg";

import type { callEventKinds } from "@/data/schema";

export type CallEventKind = (typeof callEventKinds)[number];

export type CallEventDetail = Readonly<Record<string, string | number>>;

export interface CallEvent {
  callId: string;
  kind: CallEventKind;
  key: string;
  occurredAt?: Date | null;
  detail?: CallEventDetail;
  actorUserId?: string | null;
}

export async function appendCallEvent(client: Pick<PoolClient, "query">, event: CallEvent): Promise<void> {
  await client.query(
    `insert into call_event (organization_id, workspace_id, call_id, kind, occurred_at, detail, actor_user_id, idempotency_key)
     select c.organization_id, c.workspace_id, c.id, $2, coalesce($3::timestamptz, now()), $4, $5, $6
       from call c
      where c.id = $1
     on conflict (organization_id, idempotency_key) do nothing`,
    [event.callId, event.kind, event.occurredAt ?? null, JSON.stringify(event.detail ?? {}), event.actorUserId ?? null, event.key],
  );
}
