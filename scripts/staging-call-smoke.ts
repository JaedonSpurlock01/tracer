/**
 * -------------------------------------------------------------------------
 * @file   staging-call-smoke.ts
 * @brief  Checks real Calls on the dedicated Staging Tracking Number.
 *
 * @description
 *  Prints the newest Calls placed to a Tracking Number with their state,
 *  Call Outcome, voicemail capture length, provider events, and Recordings
 *  with their transfer and Twilio cleanup states, and fails unless the
 *  newest Call is Completed. With --replay it resends that Call's accepted
 *  Keypad Gate, Forward Call, voicemail recording, connected Recording, and
 *  status callbacks to the Staging Worker as freshly signed Twilio requests
 *  and fails unless the Call is unchanged.
 *
 * @remarks
 *  Usage: pnpm smoke:staging-call --tracking-number +14155550100 [--limit 5] [--replay]
 *  Requires DATABASE_MIGRATION_URL for the Staging database, and
 *  TWILIO_AUTH_TOKEN for --replay. STAGING_BASE_URL defaults to the
 *  tracer-staging Worker. Caller numbers, Recording object keys, and
 *  Recording SIDs are never printed.
 *
 * @see
 *  data/call-smoke.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { parseArgs } from "node:util";

import pg from "pg";

import { replayCallCallbacks, reportTrackingNumberCalls } from "../data/call-smoke";

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const { values } = parseArgs({
  options: {
    "tracking-number": { type: "string" },
    limit: { type: "string", default: "5" },
    replay: { type: "boolean", default: false },
  },
});
const trackingNumber = values["tracking-number"];
if (!trackingNumber) throw new Error("--tracking-number is required");
const baseURL = process.env.STAGING_BASE_URL ?? "https://tracer-staging.jaedonaspurlock.workers.dev";
const pool = new pg.Pool({ connectionString: requireEnvironment("DATABASE_MIGRATION_URL"), max: 1 });

try {
  const calls = await reportTrackingNumberCalls(pool, trackingNumber, Number(values.limit));
  for (const call of calls) {
    console.log(
      `call=${call.twilioCallSid} state=${call.state} outcome=${call.outcome ?? "-"} reason=${call.outcomeReason ?? "-"} forward=${call.forwardStatus ?? "-"} duration=${call.durationSeconds ?? "-"} voicemail=${call.voicemailDurationSeconds ?? "-"} started=${call.startedAt}`,
    );
    for (const event of call.events) console.log(`  event=${event.kind} status=${event.status ?? "-"} disposition=${event.disposition} at=${event.receivedAt}`);
    for (const recording of call.recordings) {
      console.log(`  recording source=${recording.source} channels=${recording.channels} transfer=${recording.transferState} cleanup=${recording.twilioCleanupState} failure=${recording.failureStage ?? "-"}`);
    }
  }
  const newest = calls[0];
  if (!newest) throw new Error(`No Calls found for ${trackingNumber}`);
  if (newest.state !== "Completed") throw new Error(`Newest Call ${newest.twilioCallSid} is ${newest.state}`);
  if (values.replay) {
    const result = await replayCallCallbacks({ pool, callId: newest.id, baseURL, authToken: requireEnvironment("TWILIO_AUTH_TOKEN"), send: (request) => fetch(request) });
    console.log(`replay call=${newest.twilioCallSid} replayed=${result.replayed} rejected=${result.rejected} unchanged=${result.unchanged}`);
    if (result.rejected > 0 || !result.unchanged || result.replayed === 0) process.exitCode = 1;
  }
} finally {
  await pool.end();
}
