/**
 * -------------------------------------------------------------------------
 * @file   activity.test.ts
 * @brief  Verifies the Activity read model, its window, and its authorization.
 *
 * @description
 *  Signs in a real Operator and Client Viewer and reads the Activity
 *  endpoint to prove Organization and Access Grant scoping that filters
 *  cannot widen, one entry per Call however many Call events it has, steps
 *  in occurrence order with only the latest Call completed, the effective
 *  Lead classification with Lead Review precedence, Lead Review steps with
 *  their classification and reviewer, a derived Transcript expired step and
 *  neutral pending steps, day grouping in the user's timezone, the default
 *  7-day window in the user's timezone with keyset Load more that new Calls
 *  never shift, a refresh through the loaded window, and the caller-only
 *  search.
 *
 * @remarks
 *  Calls, Recordings, Lead Assessments, Lead Reviews, and Call events are
 *  seeded directly in the shape their writers persist, because those
 *  writers have their own suites. Authorization is asserted at the server
 *  interface, independently of any UI filter.
 *
 * @see
 *  data/activity.ts
 *  data/activity-handler.ts
 *  data/calls.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestPool } from "./test-pool";

import { createActivityHandler } from "@/data/activity-handler";
import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { generateInitialCallFlow } from "@/data/call-flow";
import { migrateDatabase } from "@/data/migrate";
import { createOperatorAdministrationHandler } from "@/data/operator-administration-handler";
import { schema } from "@/data/schema";
import { createTracerAuth } from "@/data/tracer-auth";
import type { TransactionalEmailMessage } from "@/data/transactional-email";


let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let organizationId = "";
let operatorCookie = "";
let clientCookie = "";
const messages: TransactionalEmailMessage[] = [];
const backgroundTasks: Promise<unknown>[] = [];
const recipients = new Set(["operator@example.com", "client@example.com"]);
const email = { async send(message: (typeof messages)[number]) { messages.push(message); return { messageId: `email-${messages.length}` }; } };

const database = () => drizzle(pool!, { schema });
const auth = () => createTracerAuth({
  database: database(),
  email,
  emailFrom: "auth@example.com",
  allowedRecipients: recipients,
  backgroundTask: (promise) => backgroundTasks.push(promise),
  secret: "integration-only-secret",
  baseURL: "http://localhost:3000",
});

const usersHandler = () => createOperatorAdministrationHandler({
  auth: auth(),
  pool: pool!,
  email,
  emailFrom: "auth@example.com",
  allowedRecipients: recipients,
  signInUrl: "http://localhost:3000/sign-in",
});

async function signIn(address: string): Promise<string> {
  const before = messages.length;
  const taskCount = backgroundTasks.length;
  const instance = auth();
  const send = await instance.handler(new Request("http://localhost:3000/api/auth/email-otp/send-verification-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: address, type: "sign-in" }) }));
  expect(send.status).toBe(200);
  await Promise.all(backgroundTasks.splice(taskCount));
  const code = messages.slice(before).at(-1)?.text.match(/\d{6}/)?.[0];
  const verify = await instance.handler(new Request("http://localhost:3000/api/auth/sign-in/email-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: address, otp: code }) }));
  expect(verify.status).toBe(200);
  return (verify.headers.get("set-cookie") ?? "").split(";", 1)[0];
}


interface ListedStep {
  id: string;
  kind: string;
  occurredAt: string | null;
  outcome?: string;
  classification?: string;
  reviewerName?: string | null;
}

interface ListedEntry {
  id: string;
  workspace: { id: string; name: string };
  callerNumber: string | null;
  state: string;
  outcome: string | null;
  startedAt: string;
  connectedDurationSeconds: number | null;
  effectiveLeadClassification: { classification: string; source: string } | null;
  day: string;
  cursor: string;
  steps: ListedStep[];
}

interface ListedActivity {
  entries: ListedEntry[];
  hasMore: boolean;
  hasCalls: boolean;
  timeZone: string;
}

async function listActivity(cookie: string, query = "") {
  const response = await createActivityHandler({ auth: auth(), pool: pool! })(new Request(`http://localhost:3000/api/activity${query}`, { headers: { cookie } }));
  return { response, body: (await response.json()) as ListedActivity & { error?: string } };
}

const ids = (body: ListedActivity) => body.entries.map((entry) => entry.id);
const kinds = (entry: ListedEntry | undefined) => entry?.steps.map((step) => step.kind);

const graph = generateInitialCallFlow({
  destinationNumber: "+14155550199",
  recordingEnabled: true,
  spamGateEnabled: false,
  whisperEnabled: false,
  whisperMessage: null,
  disclosureVoice: "Polly.Joanna",
});

let seeded = 0;

async function seedWorkspaceRouting(workspaceId: string): Promise<void> {
  seeded += 1;
  const workspace = (await pool!.query<{ organization_id: string }>("select organization_id from workspace where id = $1", [workspaceId])).rows[0];
  const trackingNumber = `+1415555${String(seeded).padStart(4, "0")}`;
  await pool!.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ($1, $2, $3, $4, 'Call Number', true, now(), now(), now(), now())`,
    [`${workspaceId}-number`, workspace.organization_id, `PN${String(seeded).padStart(32, "0")}`, trackingNumber],
  );
  await pool!.query(
    `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at)
     values ($1, $2, $3, $4, $5, now(), now())`,
    [`${workspaceId}-assignment`, workspace.organization_id, workspaceId, `${workspaceId}-number`, trackingNumber],
  );
  await pool!.query(
    `insert into flow_version (id, organization_id, workspace_id, version, graph, published_at) values ($1, $2, $3, 1, $4, now())`,
    [`${workspaceId}-flow`, workspace.organization_id, workspaceId, JSON.stringify(graph)],
  );
}

interface SeedCall {
  id: string;
  workspaceId: string;
  minutesAgo?: number;
  startedAt?: string;
  connectedSeconds?: number;
  callerNumber?: string;
  state?: "In Progress" | "Completed";
  outcome?: string | null;
  recording?: "Stored" | "Pending" | "Failed" | "Waveform Pending" | null;
  transcript?: "Pending" | "Completed" | "Failed" | "Skipped" | null;
  leadAssessment?: "Pending" | "Completed" | "Failed" | null;
  assessment?: { classification: string; score: number } | null;
  review?: string | null;
}

const recordingStates = {
  Stored: ["Stored", "Stored"],
  Pending: ["Pending", "Pending"],
  Failed: ["Failed", "Pending"],
  "Waveform Pending": ["Stored", "Pending"],
} as const;

async function seedCall(input: SeedCall): Promise<void> {
  seeded += 1;
  const sequence = String(seeded).padStart(32, "0");
  const workspace = (await pool!.query<{ organization_id: string }>("select organization_id from workspace where id = $1", [input.workspaceId])).rows[0];
  const state = input.state ?? "Completed";
  const outcome = state === "In Progress" ? null : (input.outcome ?? "Answered");
  const answered = outcome === "Answered";
  const startedAt = input.startedAt ?? new Date(Date.now() - (input.minutesAgo ?? 0) * 60_000).toISOString();
  await pool!.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, caller_number,
                       state, outcome, outcome_reason, started_at, answered_at, ended_at, duration_seconds, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, '+14155550000', $7, $8, $9, $10,
             $11::timestamptz, case when $12 then $11::timestamptz + interval '5 seconds' end,
             case when $8 = 'Completed' then $11::timestamptz + make_interval(secs => $13 + 5) end,
             case when $8 = 'Completed' then $13 + 5 end, now(), now())`,
    [input.id, workspace.organization_id, input.workspaceId, `${input.workspaceId}-assignment`, `${input.workspaceId}-flow`, `CA${sequence}`,
      input.callerNumber ?? "+13125550142", state, outcome, outcome ? "flow_outcome" : null, startedAt, answered, input.connectedSeconds ?? 60],
  );
  if (input.recording) {
    const [transfer, waveform] = recordingStates[input.recording];
    await pool!.query(
      `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, transfer_state, r2_object_key, size_bytes, sha256, stored_at,
                              waveform_state, waveform_object_key, waveform_generated_at, transcript_state, transcript_skip_reason, transcript_audio_ms, transcript_cost_usd,
                              transcript_completed_at, lead_assessment_state, created_at, updated_at)
       values ($1, $2, $3, $4, $5, 'connected', 2, 60, $6, $7, 1024, 'checksum', case when $6 = 'Stored' then now() end,
               $8, case when $8 = 'Stored' then $7 || '.peaks.json' end, case when $8 = 'Stored' then now() end,
               $9, case when $9 = 'Skipped' then 'too_short' end, case when $9 = 'Completed' then 60000 end, case when $9 = 'Completed' then 0.006 end,
               case when $9 = 'Completed' then now() end, $10, now(), now())`,
      [`${input.id}-recording`, workspace.organization_id, input.workspaceId, input.id, `RE${sequence}`, transfer, `recordings/${input.id}.wav`, waveform,
        input.transcript ?? null, input.leadAssessment ?? null],
    );
  }
  if (input.assessment) {
    await pool!.query(
      `insert into lead_assessment (id, organization_id, call_id, recording_id, classification, score, summary, rationale, model, input_tokens, output_tokens, cost_usd, processed_at)
       values ($1, $2, $3, $4, $5, $6, 'Caller asked for a quote.', 'Clear service need.', 'gpt-5-mini', 900, 120, 0.000465, now())`,
      [`${input.id}-assessment`, workspace.organization_id, input.id, `${input.id}-recording`, input.assessment.classification, input.assessment.score],
    );
  }
  if (input.review) {
    await pool!.query(
      "insert into lead_review (call_id, organization_id, classification, reviewed_at) values ($1, $2, $3, now())",
      [input.id, workspace.organization_id, input.review],
    );
  }
}


let operatorId = "";

async function seedEvent(callId: string, kind: string, occurredAt: string, detail: Record<string, string | number> = {}, actorUserId: string | null = null): Promise<void> {
  seeded += 1;
  await pool!.query(
    `insert into call_event (organization_id, workspace_id, call_id, kind, occurred_at, detail, actor_user_id, idempotency_key)
     select organization_id, workspace_id, id, $2, $3, $4, $5, $6 from call where id = $1`,
    [callId, kind, occurredAt, JSON.stringify(detail), actorUserId, `seed:${seeded}`],
  );
}

const ago = (minutes: number, plusSeconds = 0) => new Date(Date.now() - minutes * 60_000 + plusSeconds * 1000).toISOString();

async function localMidnight(timeZone: string, daysBack: number): Promise<Date> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  const row = await pool!.query<{ at: Date }>("select (($1::date - $2::int)::timestamp at time zone $3) as at", [today, daysBack, timeZone]);
  return row.rows[0].at;
}

/** The Calls seeded around the Operator's (Chicago) window start, newest first. */
const boundaryCalls: { id: string; startedAt: Date }[] = [];

/**
 * The boundary Calls inside a viewer's default window right now. The
 * Client Viewer is in Denver, whose window usually starts an hour after
 * Chicago's, but for the hour after Chicago's midnight the two cities are
 * on different dates and Denver's window starts almost a day earlier.
 */
async function boundaryCallsInWindow(timeZone: string): Promise<string[]> {
  const windowStart = await localMidnight(timeZone, 6);
  return boundaryCalls.filter((call) => call.startedAt >= windowStart).map((call) => call.id);
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = createTestPool(container.getConnectionUri());
  await migrateDatabase(container.getConnectionUri());
  ({ organizationId } = await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "Example Operator", timezone: "America/Chicago" }));
  operatorId = (await pool.query<{ id: string }>(`select id from "user" where email = 'operator@example.com'`)).rows[0].id;
  await pool.query(`insert into organization (id, name, slug, created_at) values ('other-organization-id', 'Other', 'other', now())`);
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, recording_enabled, created_at, updated_at)
     values ('granted-active', $1, 'Acme Plumbing', 'America/Los_Angeles', 'Active', true, now(), now()),
            ('granted-quiet', $1, 'Quiet Dental', 'UTC', 'Active', true, now(), now()),
            ('ungranted-active', $1, 'Gamma HVAC', 'UTC', 'Active', true, now(), now()),
            ('other-organization-workspace', 'other-organization-id', 'Other Org Workspace', 'UTC', 'Active', true, now(), now())`,
    [organizationId],
  );
  operatorCookie = await signIn("operator@example.com");
  const provisioned = await usersHandler()(new Request("http://localhost:3000/api/users", {
    method: "POST",
    headers: { cookie: operatorCookie, "content-type": "application/json" },
    body: JSON.stringify({ email: "client@example.com", role: "Client Viewer", workspaceIds: ["granted-active", "granted-quiet"], sendEmail: false }),
  }));
  expect(provisioned.status).toBe(201);
  const clientId = ((await provisioned.json()) as { user: { id: string } }).user.id;
  await pool.query(`update "user" set timezone = 'America/Denver' where id = $1`, [clientId]);
  await pool.query(
    `insert into access_grant (id, organization_id, workspace_id, user_id, created_at)
     values ('cross-organization-grant', 'other-organization-id', 'other-organization-workspace', $1, now())`,
    [clientId],
  );
  clientCookie = await signIn("client@example.com");
  for (const workspaceId of ["granted-active", "granted-quiet", "ungranted-active", "other-organization-workspace"]) await seedWorkspaceRouting(workspaceId);

  await seedCall({ id: "lifecycle-call", workspaceId: "granted-active", startedAt: ago(30), callerNumber: "+13125550101", recording: "Stored", transcript: "Completed", leadAssessment: "Completed", assessment: { classification: "Good Lead", score: 82 }, review: "Not Good Lead" });
  await seedEvent("lifecycle-call", "recording_transferred", ago(30, 60));
  await seedEvent("lifecycle-call", "call_received", ago(30));
  await seedEvent("lifecycle-call", "spam_gate_passed", ago(30, 1));
  await seedEvent("lifecycle-call", "forwarding_attempted", ago(30, 1));
  await seedEvent("lifecycle-call", "call_completed", ago(30, 30), { outcome: "Missed" });
  await seedEvent("lifecycle-call", "call_completed", ago(30, 40), { outcome: "Answered" });
  await seedEvent("lifecycle-call", "transcript_completed", ago(30, 90));
  await seedEvent("lifecycle-call", "lead_assessment_completed", ago(30, 120), { classification: "Good Lead", score: 82 });
  await seedEvent("lifecycle-call", "lead_review_added", ago(30, 200), { classification: "Good Lead" }, operatorId);
  await seedEvent("lifecycle-call", "lead_review_added", ago(30, 300), { classification: "Not Good Lead" }, operatorId);

  await seedCall({ id: "pending-call", workspaceId: "granted-quiet", startedAt: ago(20), callerNumber: "+13125550103", outcome: "Voicemail", recording: "Stored", transcript: "Pending" });
  await seedEvent("pending-call", "call_received", ago(20));
  await seedEvent("pending-call", "call_completed", ago(20, 30), { outcome: "Voicemail" });
  await seedEvent("pending-call", "recording_transferred", ago(20, 60));

  await seedCall({ id: "assessed-call", workspaceId: "granted-active", startedAt: ago(10), callerNumber: "+13125550109", recording: "Stored", transcript: "Completed", leadAssessment: "Completed", assessment: { classification: "Uncertain", score: 55 } });
  await seedCall({ id: "in-progress-call", workspaceId: "granted-quiet", startedAt: ago(1), callerNumber: "+13125550105", state: "In Progress" });
  await seedEvent("in-progress-call", "call_received", ago(1));
  await seedCall({ id: "ungranted-call", workspaceId: "ungranted-active", startedAt: ago(5), callerNumber: "+13125550107", outcome: "Missed" });
  await seedCall({ id: "other-organization-call", workspaceId: "other-organization-workspace", startedAt: ago(3) });

  const chicagoWindowStart = await localMidnight("America/Chicago", 6);
  boundaryCalls.push(
    { id: "window-start-call", startedAt: new Date(chicagoWindowStart.getTime() + 60_000) },
    { id: "before-window-call", startedAt: new Date(chicagoWindowStart.getTime() - 60_000) },
  );
  for (const call of boundaryCalls) await seedCall({ id: call.id, workspaceId: "granted-active", startedAt: call.startedAt.toISOString() });

  const thirteenMonthsAgo = new Date();
  thirteenMonthsAgo.setUTCMonth(thirteenMonthsAgo.getUTCMonth() - 13);
  await seedCall({ id: "expired-call", workspaceId: "granted-active", startedAt: thirteenMonthsAgo.toISOString(), recording: "Stored", transcript: "Completed", leadAssessment: "Completed", assessment: { classification: "Good Lead", score: 70 } });
  await seedEvent("expired-call", "call_received", thirteenMonthsAgo.toISOString());
  await seedEvent("expired-call", "transcript_completed", new Date(thirteenMonthsAgo.getTime() + 90_000).toISOString());
  await seedEvent("expired-call", "lead_review_added", new Date(Date.now() - 86_400_000).toISOString(), { classification: "Good Lead" });

  await seedCall({ id: "late-evening-call", workspaceId: "granted-active", startedAt: "2025-03-01T05:30:00.000Z" });
  await seedCall({ id: "after-midnight-call", workspaceId: "granted-active", startedAt: "2025-03-01T06:30:00.000Z" });
}, 120_000);

afterAll(async () => { await pool?.end(); await container?.stop(); });

describe.sequential("Activity authorization", () => {
  it("lists every Organization Call in the window for an Operator as private, uncached data, and nothing from another Organization", async () => {
    const { response, body } = await listActivity(operatorCookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(ids(body)).toEqual(["in-progress-call", "ungranted-call", "assessed-call", "pending-call", "lifecycle-call", "window-start-call"]);
    expect(body).toMatchObject({ timeZone: "America/Chicago", hasCalls: true, hasMore: true });
  });

  it("lists only granted Workspaces for a Client Viewer, and a filter naming an ungranted Workspace matches nothing", async () => {
    const { body } = await listActivity(clientCookie);
    expect(ids(body)).toEqual(["in-progress-call", "assessed-call", "pending-call", "lifecycle-call", ...(await boundaryCallsInWindow("America/Denver"))]);
    expect(body.timeZone).toBe("America/Denver");
    for (const query of ["?workspace=ungranted-active", "?workspace=other-organization-workspace", "?workspace=ungranted-active&from=2000-01-01"]) {
      const filtered = await listActivity(clientCookie, query);
      expect(filtered.body.entries).toEqual([]);
      expect(filtered.body.hasMore).toBe(false);
    }
  });

  it("rejects an unauthenticated Activity read", async () => {
    const { response } = await listActivity("");
    expect(response.status).toBe(401);
  });
});

describe.sequential("Activity entries", () => {
  it("shows one entry per Call with its occurred steps in order and only the latest Call completed", async () => {
    const { body } = await listActivity(operatorCookie);
    expect(ids(body).filter((id) => id === "lifecycle-call")).toHaveLength(1);
    const entry = body.entries.find((item) => item.id === "lifecycle-call");
    expect(kinds(entry)).toEqual([
      "call_received",
      "spam_gate_passed",
      "forwarding_attempted",
      "call_completed",
      "recording_transferred",
      "transcript_completed",
      "lead_assessment_completed",
      "lead_review_added",
      "lead_review_added",
    ]);
    expect(entry?.steps[3]).toMatchObject({ kind: "call_completed", outcome: "Answered" });
    expect(entry?.steps[6]).toMatchObject({ classification: "Good Lead" });
    expect(entry?.steps.slice(7)).toMatchObject([{ classification: "Good Lead", reviewerName: "Example Operator" }, { classification: "Not Good Lead", reviewerName: "Example Operator" }]);
    const times = entry!.steps.map((step) => step.occurredAt!);
    expect([...times].sort()).toEqual(times);
    expect(entry).toMatchObject({ outcome: "Answered", workspace: { id: "granted-active", name: "Acme Plumbing" }, callerNumber: "+13125550101", connectedDurationSeconds: 60 });
  });

  it("uses Lead Review precedence for the effective Lead classification", async () => {
    const { body } = await listActivity(operatorCookie);
    const byId = new Map(body.entries.map((entry) => [entry.id, entry]));
    expect(byId.get("lifecycle-call")?.effectiveLeadClassification).toEqual({ classification: "Not Good Lead", source: "review" });
    expect(byId.get("assessed-call")?.effectiveLeadClassification).toEqual({ classification: "Uncertain", source: "assessment" });
    expect(byId.get("in-progress-call")).toMatchObject({ state: "In Progress", outcome: null, effectiveLeadClassification: null, steps: [{ kind: "call_received" }] });
  });

  it("adds a neutral pending step while processing is unfinished", async () => {
    const { body } = await listActivity(operatorCookie);
    const entry = body.entries.find((item) => item.id === "pending-call");
    expect(kinds(entry)).toEqual(["call_received", "call_completed", "recording_transferred", "transcript_pending"]);
    expect(entry?.steps.at(-1)?.occurredAt).toBeNull();
  });

  it("derives Transcript expired at read time once a completed Transcript's media expires", async () => {
    const { body } = await listActivity(operatorCookie, "?from=2000-01-01");
    const entry = body.entries.find((item) => item.id === "expired-call");
    expect(kinds(entry)).toEqual(["call_received", "transcript_completed", "transcript_expired", "lead_review_added"]);
    const expiresAt = new Date(entry!.startedAt);
    expiresAt.setUTCMonth(expiresAt.getUTCMonth() + 12);
    expect(new Date(entry!.steps[2].occurredAt!).getTime()).toBe(expiresAt.getTime());
  });

  it("groups each Call under its start day in the user's timezone", async () => {
    const operator = await listActivity(operatorCookie, "?from=2025-02-28&to=2025-03-01");
    expect(operator.body.entries.map((entry) => [entry.id, entry.day])).toEqual([["after-midnight-call", "2025-03-01"], ["late-evening-call", "2025-02-28"]]);
    const client = await listActivity(clientCookie, "?from=2025-02-28&to=2025-03-01");
    expect(client.body.entries.map((entry) => [entry.id, entry.day])).toEqual([["after-midnight-call", "2025-02-28"], ["late-evening-call", "2025-02-28"]]);
  });

  it("searches caller numbers only", async () => {
    expect(ids((await listActivity(operatorCookie, "?q=555-0101")).body)).toEqual(["lifecycle-call"]);
    const byName = await listActivity(operatorCookie, "?q=Acme");
    expect(byName.body).toMatchObject({ entries: [], hasCalls: true });
  });

  it("filters by processing state with the Calls analysis status", async () => {
    expect(ids((await listActivity(operatorCookie, "?analysis=Pending")).body)).toEqual(["pending-call"]);
  });
});

describe.sequential("Activity window and Load more", () => {
  it("starts the default window at local midnight six days back in the user's timezone", async () => {
    const operator = ids((await listActivity(operatorCookie)).body);
    expect(operator).toContain("window-start-call");
    expect(operator).not.toContain("before-window-call");
    // The Client Viewer's window follows Denver's midnight, so it never matches Chicago's boundary.
    const client = ids((await listActivity(clientCookie)).body).filter((id) => boundaryCalls.some((call) => call.id === id));
    expect(client).toEqual(await boundaryCallsInWindow("America/Denver"));
    expect(client).not.toEqual(["window-start-call"]);
  });

  it("loads older Calls before the oldest loaded one, unaffected by a new Call arriving", async () => {
    const first = await listActivity(operatorCookie);
    await seedCall({ id: "new-call", workspaceId: "granted-active", startedAt: new Date().toISOString() });
    try {
      const cursor = first.body.entries.at(-1)!.cursor;
      const more = await listActivity(operatorCookie, `?before=${encodeURIComponent(cursor)}`);
      expect(ids(more.body)).toEqual(["before-window-call", "expired-call", "after-midnight-call", "late-evening-call"]);
      expect(more.body.hasMore).toBe(false);
      const refreshed = await listActivity(operatorCookie, `?through=${encodeURIComponent(cursor)}`);
      expect(ids(refreshed.body)).toEqual(["new-call", ...ids(first.body)]);
      expect(refreshed.body.hasMore).toBe(true);
    } finally {
      await pool!.query("delete from call where id = 'new-call'");
    }
  });

  it("pages 25 Calls at a time with keyset cursors that never repeat or skip tied start times", async () => {
    for (let index = 0; index < 27; index += 1) {
      await seedCall({ id: `bulk-call-${String(index).padStart(2, "0")}`, workspaceId: "granted-quiet", startedAt: `2024-06-01T12:00:${String(Math.floor(index / 3)).padStart(2, "0")}.000Z` });
    }
    const query = "?workspace=granted-quiet&from=2024-06-01&to=2024-06-01";
    const first = await listActivity(operatorCookie, query);
    expect(first.body.entries).toHaveLength(25);
    expect(first.body.hasMore).toBe(true);
    const more = await listActivity(operatorCookie, `${query}&before=${encodeURIComponent(first.body.entries.at(-1)!.cursor)}`);
    expect(more.body.hasMore).toBe(false);
    const all = [...ids(first.body), ...ids(more.body)];
    expect(new Set(all).size).toBe(27);
    expect(all).toHaveLength(27);
  });
});
