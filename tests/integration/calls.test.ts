/**
 * -------------------------------------------------------------------------
 * @file   calls.test.ts
 * @brief  Verifies the server-backed Calls list and its authorization.
 *
 * @description
 *  Signs in a real Operator and Client Viewer and reads the Calls server
 *  interface to prove Organization and Access Grant scoping for global and
 *  Workspace Calls, the Started descending default, server pagination and
 *  allow-listed sorting, canonical Call Outcomes with In Progress Calls,
 *  the effective Lead classification with Lead Review precedence, the Lead
 *  Score, Recording availability, and the timezone each scope renders in.
 *  It also proves each Calls filter narrows the list, that a Workspace
 *  filter never reaches an ungranted Workspace, that dates resolve in the
 *  user's or Workspace's timezone through the whole last day, that search
 *  matches caller digits or Workspace names with LIKE wildcards escaped,
 *  and whether an unfiltered scope has any Calls. Advanced condition
 *  trees are checked for Or across Call Outcomes in a group, nested
 *  And and Or, their And with the flat filters, Or never reaching an
 *  ungranted Workspace, and the depth and size bounds.
 *
 * @remarks
 *  Calls, Recordings, Lead Assessments, and Lead Reviews are seeded
 *  directly in the shape their writers persist, because those writers have
 *  their own suites. Authorization is asserted at the server interface,
 *  independently of any UI filter.
 *
 * @see
 *  data/calls.ts
 *  data/calls-handler.ts
 *  data/workspace-authorization.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestPool } from "./test-pool";

import { requireActiveActor } from "@/data/authorization";
import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { generateInitialCallFlow } from "@/data/call-flow";
import { callListQueryFromSearchParams } from "@/data/call-list-query";
import { createCallList } from "@/data/calls";
import { createCallsHandler } from "@/data/calls-handler";
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

interface ListedCall {
  id: string;
  workspace: { id: string; name: string };
  callerNumber: string | null;
  state: string;
  outcome: string | null;
  startedAt: string;
  connectedDurationSeconds: number | null;
  effectiveLeadClassification: { classification: string; source: string } | null;
  leadScore: number | null;
  recording: string;
  mp3RecordingId: string | null;
}

interface ListedCalls {
  calls: ListedCall[];
  total: number;
  page: number;
  pageSize: number;
  timeZone: string;
  workspace: { id: string; name: string } | null;
  hasCalls: boolean;
}

async function listCalls(cookie: string, query = "") {
  const response = await createCallsHandler({ auth: auth(), pool: pool! })(new Request(`http://localhost:3000/api/calls${query}`, { headers: { cookie } }));
  return { response, body: (await response.json()) as ListedCalls & { error?: string } };
}

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

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = createTestPool(container.getConnectionUri());
  await migrateDatabase(container.getConnectionUri());
  ({ organizationId } = await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "Example Operator", timezone: "America/Chicago" }));
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
  await seedCall({ id: "reviewed-call", workspaceId: "granted-active", minutesAgo: 30, callerNumber: "+13125550101", recording: "Stored", assessment: { classification: "Good Lead", score: 82 }, review: "Not Good Lead" });
  await seedCall({ id: "assessed-call", workspaceId: "granted-active", minutesAgo: 20, callerNumber: "+13125550109", recording: "Stored", assessment: { classification: "Uncertain", score: 55 } });
  await seedCall({ id: "in-progress-call", workspaceId: "granted-quiet", minutesAgo: 1, callerNumber: "+13125550105", state: "In Progress" });
  await seedCall({ id: "voicemail-call", workspaceId: "granted-quiet", minutesAgo: 40, callerNumber: "+13125550103", outcome: "Voicemail", recording: "Pending" });
  await seedCall({ id: "ungranted-call", workspaceId: "ungranted-active", minutesAgo: 10, callerNumber: "+13125550107", outcome: "Missed" });
  await seedCall({ id: "other-organization-call", workspaceId: "other-organization-workspace", minutesAgo: 5 });
}, 120_000);

afterAll(async () => { await pool?.end(); await container?.stop(); });

describe.sequential("global Calls authorization", () => {
  it("lists every Organization Call for an Operator, Started descending, and nothing from another Organization", async () => {
    const { response, body } = await listCalls(operatorCookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.calls.map((call) => call.id)).toEqual(["in-progress-call", "ungranted-call", "assessed-call", "reviewed-call", "voicemail-call"]);
    expect(body).toMatchObject({ total: 5, page: 1, pageSize: 25, timeZone: "America/Chicago", workspace: null });
  });

  it("lists only Calls in granted Workspaces for a Client Viewer, in the Client Viewer's timezone", async () => {
    const { response, body } = await listCalls(clientCookie);
    expect(response.status).toBe(200);
    expect(body.calls.map((call) => call.id)).toEqual(["in-progress-call", "assessed-call", "reviewed-call", "voicemail-call"]);
    expect(body).toMatchObject({ total: 4, timeZone: "America/Denver" });
  });

  it("stops listing a Workspace's Calls once its Access Grant is removed", async () => {
    await pool!.query(`delete from access_grant where workspace_id = 'granted-quiet' and user_id = (select id from "user" where email = 'client@example.com')`);
    try {
      const { body } = await listCalls(clientCookie);
      expect(body.calls.map((call) => call.id)).toEqual(["assessed-call", "reviewed-call"]);
      expect(body.total).toBe(2);
    } finally {
      await pool!.query(
        `insert into access_grant (id, organization_id, workspace_id, user_id, created_at)
         select 'restored-grant', $1, 'granted-quiet', id, now() from "user" where email = 'client@example.com'`,
        [organizationId],
      );
    }
  });

  it("rejects an unauthenticated Calls read", async () => {
    const { response } = await listCalls("");
    expect(response.status).toBe(401);
  });
});

describe.sequential("Workspace Calls authorization", () => {
  it("fixes the Workspace scope and renders in the Workspace reporting timezone", async () => {
    for (const cookie of [operatorCookie, clientCookie]) {
      const { response, body } = await listCalls(cookie, "?workspaceId=granted-active");
      expect(response.status).toBe(200);
      expect(body.calls.map((call) => call.id)).toEqual(["assessed-call", "reviewed-call"]);
      expect(body).toMatchObject({ total: 2, timeZone: "America/Los_Angeles", workspace: { id: "granted-active", name: "Acme Plumbing" } });
    }
  });

  it("refuses an ungranted Workspace and another Organization's Workspace with Not Found", async () => {
    for (const [cookie, workspaceId] of [[clientCookie, "ungranted-active"], [clientCookie, "other-organization-workspace"], [operatorCookie, "other-organization-workspace"], [operatorCookie, "missing-workspace"]] as const) {
      const { response, body } = await listCalls(cookie, `?workspaceId=${workspaceId}`);
      expect(response.status).toBe(404);
      expect(body).toEqual({ error: "not_found" });
    }
  });
});

describe.sequential("Calls rows", () => {
  it("shows canonical Call Outcomes, In Progress Calls, connected durations, and Recording availability", async () => {
    const { body } = await listCalls(operatorCookie);
    const byId = new Map(body.calls.map((call) => [call.id, call]));
    expect(byId.get("in-progress-call")).toMatchObject({ state: "In Progress", outcome: null, connectedDurationSeconds: null, recording: "Unavailable", workspace: { id: "granted-quiet", name: "Quiet Dental" } });
    expect(byId.get("voicemail-call")).toMatchObject({ state: "Completed", outcome: "Voicemail", connectedDurationSeconds: 0, recording: "Processing" });
    expect(byId.get("ungranted-call")).toMatchObject({ outcome: "Missed", recording: "Unavailable" });
    expect(byId.get("assessed-call")).toMatchObject({ outcome: "Answered", connectedDurationSeconds: 60, recording: "Ready", callerNumber: "+13125550109" });
  });

  it("uses the Lead Review over the Lead Assessment for the effective classification and keeps the Lead Score", async () => {
    const { body } = await listCalls(clientCookie);
    const byId = new Map(body.calls.map((call) => [call.id, call]));
    expect(byId.get("reviewed-call")).toMatchObject({ effectiveLeadClassification: { classification: "Not Good Lead", source: "review" }, leadScore: 82 });
    expect(byId.get("assessed-call")).toMatchObject({ effectiveLeadClassification: { classification: "Uncertain", source: "assessment" }, leadScore: 55 });
    expect(byId.get("voicemail-call")).toMatchObject({ effectiveLeadClassification: null, leadScore: null });
  });

  it("labels Recording media Expired 12 months after the Call started", async () => {
    await seedCall({ id: "expired-call", workspaceId: "ungranted-active", minutesAgo: 60 * 24 * 400, recording: "Stored" });
    const { body } = await listCalls(operatorCookie, "?workspaceId=ungranted-active");
    expect(body.calls.find((call) => call.id === "expired-call")?.recording).toBe("Expired");
  });

  it("offers the MP3 download by Recording id whenever its MP3 is Stored and media is retained, whatever the waveform state", async () => {
    await pool!.query(
      "update recording set mp3_state = 'Stored', mp3_object_key = 'recordings/' || id || '.mp3', mp3_size_bytes = 512, mp3_generated_at = now() where id in ('reviewed-call-recording', 'expired-call-recording', 'assessed-call-recording')",
    );
    await pool!.query("update recording set waveform_state = 'Failed', waveform_object_key = null, waveform_generated_at = null where id = 'assessed-call-recording'");
    const { body } = await listCalls(operatorCookie);
    const byId = new Map(body.calls.map((call) => [call.id, call]));
    expect(byId.get("reviewed-call")).toMatchObject({ recording: "Ready", mp3RecordingId: "reviewed-call-recording" });
    expect(byId.get("assessed-call")).toMatchObject({ mp3RecordingId: "assessed-call-recording" });
    expect(byId.get("expired-call")).toMatchObject({ recording: "Expired", mp3RecordingId: null });
    expect(byId.get("ungranted-call")).toMatchObject({ recording: "Unavailable", mp3RecordingId: null });
    await pool!.query("update recording set waveform_state = 'Pending' where id = 'assessed-call-recording'");
    const pending = (await listCalls(operatorCookie)).body.calls.find((call) => call.id === "assessed-call");
    expect(pending).toMatchObject({ recording: "Processing", mp3RecordingId: "assessed-call-recording" });
    await pool!.query("update recording set mp3_state = 'Failed', mp3_object_key = null, mp3_size_bytes = null where id = 'assessed-call-recording'");
    expect((await listCalls(operatorCookie)).body.calls.find((call) => call.id === "assessed-call")).toMatchObject({ mp3RecordingId: null });
    await pool!.query("update recording set waveform_state = 'Stored', waveform_object_key = 'recordings/assessed-call.wav.peaks.json', waveform_generated_at = now(), mp3_state = 'Pending' where id = 'assessed-call-recording'");
  });
});

describe.sequential("Calls pagination and sorting", () => {
  it("sorts by an allow-listed column in either direction", async () => {
    const ascending = await listCalls(clientCookie, "?sort=callerNumber&order=asc");
    expect(ascending.body.calls.map((call) => call.callerNumber)).toEqual(["+13125550101", "+13125550103", "+13125550105", "+13125550109"]);
    const byScore = await listCalls(clientCookie, "?sort=leadScore&order=desc");
    expect(byScore.body.calls.map((call) => call.id)).toEqual(["reviewed-call", "assessed-call", "in-progress-call", "voicemail-call"]);
    const byWorkspace = await listCalls(operatorCookie, "?sort=workspace&order=asc");
    expect(byWorkspace.body.calls.map((call) => call.workspace.name)).toEqual(["Acme Plumbing", "Acme Plumbing", "Gamma HVAC", "Gamma HVAC", "Quiet Dental", "Quiet Dental"]);
    const byDuration = await listCalls(clientCookie, "?sort=connectedDuration&order=desc");
    expect(byDuration.body.calls.map((call) => call.id)).toEqual(["assessed-call", "reviewed-call", "voicemail-call", "in-progress-call"]);
    const byClassification = await listCalls(clientCookie, "?sort=leadClassification&order=asc");
    expect(byClassification.body.calls.map((call) => call.effectiveLeadClassification?.classification ?? null)).toEqual(["Not Good Lead", "Uncertain", null, null]);
    for (const sort of ["startedAt", "outcome"]) {
      for (const order of ["asc", "desc"]) expect((await listCalls(operatorCookie, `?sort=${sort}&order=${order}`)).response.status).toBe(200);
    }
  });

  it("falls back to Started descending for a sort outside the allow-list", async () => {
    const { response, body } = await listCalls(clientCookie, `?sort=${encodeURIComponent("c.id; drop table call")}&order=sideways`);
    expect(response.status).toBe(200);
    expect(body.calls.map((call) => call.id)).toEqual(["in-progress-call", "assessed-call", "reviewed-call", "voicemail-call"]);
    expect((await pool!.query("select count(*)::int as count from call")).rows[0].count).toBeGreaterThan(0);
  });

  it("pages 25 Calls at a time on the server", async () => {
    for (let index = 0; index < 26; index += 1) {
      await seedCall({ id: `paged-call-${String(index).padStart(2, "0")}`, workspaceId: "granted-quiet", minutesAgo: 100 + index });
    }
    const first = await listCalls(clientCookie, "?workspaceId=granted-quiet");
    expect(first.body).toMatchObject({ total: 28, page: 1, pageSize: 25 });
    expect(first.body.calls).toHaveLength(25);
    const second = await listCalls(clientCookie, "?workspaceId=granted-quiet&page=2");
    expect(second.body).toMatchObject({ total: 28, page: 2 });
    expect(second.body.calls.map((call) => call.id)).toEqual(["paged-call-23", "paged-call-24", "paged-call-25"]);
  });
});

describe.sequential("Calls filters", () => {
  const ids = (body: ListedCalls) => body.calls.map((call) => call.id);

  it("narrows global Calls to the chosen Workspaces and never returns an ungranted Workspace's Calls", async () => {
    const operator = await listCalls(operatorCookie, "?workspace=granted-active&workspace=ungranted-active");
    expect(operator.body.calls.every((call) => ["granted-active", "ungranted-active"].includes(call.workspace.id))).toBe(true);
    expect(ids(operator.body)).toEqual(expect.arrayContaining(["ungranted-call", "assessed-call", "reviewed-call", "expired-call"]));
    expect(operator.body.total).toBe(4);
    const ungranted = await listCalls(clientCookie, "?workspace=ungranted-active&workspace=other-organization-workspace");
    expect(ungranted.response.status).toBe(200);
    expect(ungranted.body).toMatchObject({ calls: [], total: 0 });
    const mixed = await listCalls(clientCookie, "?workspace=ungranted-active&workspace=granted-active");
    expect(ids(mixed.body)).toEqual(["assessed-call", "reviewed-call"]);
  });

  it("narrows to the chosen Call Outcomes, with In Progress for Calls that have none yet", async () => {
    const { body } = await listCalls(operatorCookie, "?outcome=Voicemail&outcome=In%20Progress");
    expect(ids(body)).toEqual(["in-progress-call", "voicemail-call"]);
    expect(body.total).toBe(2);
    expect(ids((await listCalls(operatorCookie, "?outcome=Missed")).body)).toEqual(["ungranted-call"]);
  });

  it("narrows by effective Lead classification, using the Lead Review over the Lead Assessment", async () => {
    expect((await listCalls(operatorCookie, "?classification=Good%20Lead")).body).toMatchObject({ calls: [], total: 0 });
    expect(ids((await listCalls(operatorCookie, "?classification=Not%20Good%20Lead")).body)).toEqual(["reviewed-call"]);
    expect(ids((await listCalls(clientCookie, "?workspaceId=granted-active&classification=Uncertain&classification=None")).body)).toEqual(["assessed-call"]);
    expect(ids((await listCalls(operatorCookie, "?workspaceId=ungranted-active&classification=None")).body)).toEqual(["ungranted-call", "expired-call"]);
  });

  it("narrows by an inclusive Lead Score range and leaves out Calls without a Lead Score", async () => {
    expect(ids((await listCalls(operatorCookie, "?scoreMin=60")).body)).toEqual(["reviewed-call"]);
    expect(ids((await listCalls(operatorCookie, "?scoreMax=60")).body)).toEqual(["assessed-call"]);
    expect(ids((await listCalls(operatorCookie, "?scoreMin=55&scoreMax=82")).body)).toEqual(["assessed-call", "reviewed-call"]);
  });

  it("narrows by an inclusive connected duration range in seconds", async () => {
    await seedCall({ id: "long-call", workspaceId: "ungranted-active", minutesAgo: 50, connectedSeconds: 300 });
    expect(ids((await listCalls(operatorCookie, "?durationMin=120")).body)).toEqual(["long-call"]);
    expect(ids((await listCalls(operatorCookie, "?durationMin=60&durationMax=300&workspaceId=ungranted-active")).body)).toEqual(["long-call", "expired-call"]);
    expect(ids((await listCalls(operatorCookie, "?durationMax=0")).body)).toEqual(["ungranted-call", "voicemail-call"]);
  });

  it("narrows by Recording availability with the same state each row shows", async () => {
    await seedCall({ id: "failed-recording-call", workspaceId: "ungranted-active", minutesAgo: 51, recording: "Failed" });
    await seedCall({ id: "waveform-pending-call", workspaceId: "ungranted-active", minutesAgo: 52, recording: "Waveform Pending", transcript: "Pending" });
    expect(ids((await listCalls(operatorCookie, "?recording=Failed")).body)).toEqual(["failed-recording-call"]);
    expect(ids((await listCalls(operatorCookie, "?recording=Processing")).body)).toEqual(["voicemail-call", "waveform-pending-call"]);
    expect(ids((await listCalls(operatorCookie, "?recording=Ready&recording=Expired")).body)).toEqual(["assessed-call", "reviewed-call", "expired-call"]);
    const all = (await listCalls(operatorCookie, "?workspaceId=ungranted-active")).body;
    let matched = 0;
    for (const state of ["Ready", "Processing", "Failed", "Unavailable", "Expired"]) {
      const { body } = await listCalls(operatorCookie, `?workspaceId=ungranted-active&recording=${state}`);
      expect(body.calls.every((call) => call.recording === state)).toBe(true);
      matched += body.total;
    }
    expect(matched).toBe(all.total);
  });

  it("narrows by analysis status across the Transcript and Lead Assessment stages", async () => {
    await seedCall({ id: "analysis-completed-call", workspaceId: "ungranted-active", minutesAgo: 53, recording: "Stored", transcript: "Completed", leadAssessment: "Completed" });
    await seedCall({ id: "assessment-failed-call", workspaceId: "ungranted-active", minutesAgo: 54, recording: "Stored", transcript: "Completed", leadAssessment: "Failed" });
    await seedCall({ id: "transcript-failed-call", workspaceId: "ungranted-active", minutesAgo: 55, recording: "Stored", transcript: "Failed" });
    await seedCall({ id: "analysis-skipped-call", workspaceId: "ungranted-active", minutesAgo: 56, recording: "Stored", transcript: "Skipped" });
    await seedCall({ id: "assessment-pending-call", workspaceId: "ungranted-active", minutesAgo: 57, recording: "Stored", transcript: "Completed", leadAssessment: "Pending" });
    const scoped = (status: string) => listCalls(operatorCookie, `?workspaceId=ungranted-active&analysis=${encodeURIComponent(status)}`);
    expect(ids((await scoped("Completed")).body)).toEqual(["analysis-completed-call"]);
    expect(ids((await scoped("Failed")).body)).toEqual(["assessment-failed-call", "transcript-failed-call"]);
    expect(ids((await scoped("Skipped")).body)).toEqual(["analysis-skipped-call"]);
    expect(ids((await scoped("Pending")).body)).toEqual(["waveform-pending-call", "assessment-pending-call"]);
    expect(ids((await scoped("Not applicable")).body)).toEqual(["ungranted-call", "long-call", "failed-recording-call", "expired-call"]);
    expect(ids((await listCalls(operatorCookie, "?workspaceId=granted-quiet&analysis=Pending")).body)).toEqual(["voicemail-call"]);
  });

  it("reads the Started date range in the user's timezone globally and the Workspace reporting timezone in Workspace Calls, including the whole last day", async () => {
    await pool!.query(
      `insert into workspace (id, organization_id, name, reporting_timezone, state, recording_enabled, created_at, updated_at)
       values ('tokyo-office', $1, 'Tokyo Office', 'Asia/Tokyo', 'Active', true, now(), now())`,
      [organizationId],
    );
    await seedWorkspaceRouting("tokyo-office");
    await seedCall({ id: "tokyo-early-call", workspaceId: "tokyo-office", startedAt: "2026-10-09T15:30:00Z" });
    await seedCall({ id: "tokyo-late-call", workspaceId: "tokyo-office", startedAt: "2026-10-10T14:59:00Z" });
    await seedCall({ id: "tokyo-next-call", workspaceId: "tokyo-office", startedAt: "2026-10-10T15:00:00Z" });
    expect(ids((await listCalls(operatorCookie, "?workspaceId=tokyo-office&from=2026-10-10&to=2026-10-10")).body)).toEqual(["tokyo-late-call", "tokyo-early-call"]);
    expect(ids((await listCalls(operatorCookie, "?workspace=tokyo-office&from=2026-10-10&to=2026-10-10")).body)).toEqual(["tokyo-next-call", "tokyo-late-call"]);
    expect(ids((await listCalls(operatorCookie, "?workspace=tokyo-office&to=2026-10-09")).body)).toEqual(["tokyo-early-call"]);
    expect(ids((await listCalls(operatorCookie, "?workspaceId=tokyo-office&from=2026-10-11")).body)).toEqual(["tokyo-next-call"]);
  });

  it("searches caller phone numbers by their digits however they are typed", async () => {
    expect(ids((await listCalls(operatorCookie, `?q=${encodeURIComponent("(312) 555-0109")}`)).body)).toEqual(["assessed-call"]);
    expect(ids((await listCalls(operatorCookie, `?q=${encodeURIComponent("+1 312 555 0101")}`)).body)).toEqual(["reviewed-call"]);
    expect(ids((await listCalls(clientCookie, `?q=${encodeURIComponent("555010")}&workspaceId=granted-active`)).body)).toEqual(["assessed-call", "reviewed-call"]);
  });

  it("searches Workspace names case-insensitively and treats LIKE wildcards literally", async () => {
    await pool!.query(
      `insert into workspace (id, organization_id, name, reporting_timezone, state, recording_enabled, created_at, updated_at)
       values ('roofing', $1, 'Roof_100% Co', 'UTC', 'Active', true, now(), now())`,
      [organizationId],
    );
    await seedWorkspaceRouting("roofing");
    await seedCall({ id: "roofing-call", workspaceId: "roofing", minutesAgo: 2 });
    expect(ids((await listCalls(clientCookie, "?q=aCmE")).body)).toEqual(["assessed-call", "reviewed-call"]);
    expect(ids((await listCalls(operatorCookie, "?q=100%25")).body)).toEqual(["roofing-call"]);
    expect(ids((await listCalls(operatorCookie, "?q=%25")).body)).toEqual(["roofing-call"]);
    expect((await listCalls(operatorCookie, "?q=o_f")).body).toMatchObject({ calls: [], total: 0 });
    expect((await listCalls(operatorCookie, `?q=${encodeURIComponent("\\")}`)).body).toMatchObject({ calls: [], total: 0 });
    expect((await listCalls(clientCookie, "?q=Roof")).body).toMatchObject({ calls: [], total: 0 });
  });

  it("ignores a Workspace filter in Workspace Calls, whose scope is already fixed", async () => {
    expect(ids((await listCalls(clientCookie, "?workspaceId=granted-active&workspace=ungranted-active")).body)).toEqual(["assessed-call", "reviewed-call"]);
  });

  it("says whether the unfiltered scope has any Calls so no matches differs from no Calls", async () => {
    await pool!.query(
      `insert into workspace (id, organization_id, name, reporting_timezone, state, recording_enabled, created_at, updated_at)
       values ('empty-office', $1, 'Empty Office', 'UTC', 'Active', true, now(), now())`,
      [organizationId],
    );
    expect((await listCalls(clientCookie, "?q=zzz")).body).toMatchObject({ calls: [], total: 0, hasCalls: true });
    expect((await listCalls(clientCookie, "?workspaceId=granted-active")).body).toMatchObject({ total: 2, hasCalls: true });
    expect((await listCalls(operatorCookie, "?workspaceId=empty-office&outcome=Answered")).body).toMatchObject({ total: 0, hasCalls: false });
    expect((await listCalls(operatorCookie, "?workspaceId=empty-office")).body).toMatchObject({ total: 0, hasCalls: false });
  });

  it("offers only readable Workspaces as Workspace filter options, by name", async () => {
    const options = async (cookie: string) => createCallList(pool!, await requireActiveActor(auth(), pool!, new Headers({ cookie }))).workspaceOptions();
    expect(await options(clientCookie)).toEqual([{ id: "granted-active", name: "Acme Plumbing" }, { id: "granted-quiet", name: "Quiet Dental" }]);
    expect((await options(operatorCookie)).map((option) => option.name)).toEqual(["Acme Plumbing", "Empty Office", "Gamma HVAC", "Quiet Dental", "Roof_100% Co", "Tokyo Office"]);
  });

  it("labels and narrows Recording media an Operator purged as Purged, before Expired, without the MP3 download", async () => {
    await pool!.query(
      `insert into workspace (id, organization_id, name, reporting_timezone, state, recording_enabled, created_at, updated_at)
       values ('purge-office', $1, 'Purge Office', 'UTC', 'Active', true, now(), now())`,
      [organizationId],
    );
    await seedWorkspaceRouting("purge-office");
    await seedCall({ id: "purged-recording-call", workspaceId: "purge-office", minutesAgo: 58, recording: "Stored" });
    await seedCall({ id: "purged-expired-call", workspaceId: "purge-office", minutesAgo: 60 * 24 * 401, recording: "Stored" });
    await seedCall({ id: "unpurged-expired-call", workspaceId: "purge-office", minutesAgo: 60 * 24 * 402, recording: "Stored" });
    await pool!.query(
      "update recording set mp3_state = 'Stored', mp3_object_key = 'recordings/' || id || '.mp3', mp3_size_bytes = 512, mp3_generated_at = now(), media_purged_at = now() where id in ('purged-recording-call-recording', 'purged-expired-call-recording')",
    );
    const scoped = (filter: string) => listCalls(operatorCookie, `?workspaceId=purge-office${filter}`);
    const byId = new Map((await scoped("")).body.calls.map((call) => [call.id, call]));
    for (const id of ["purged-recording-call", "purged-expired-call"]) expect(byId.get(id)).toMatchObject({ recording: "Purged", mp3RecordingId: null });
    expect(byId.get("unpurged-expired-call")).toMatchObject({ recording: "Expired" });
    expect(ids((await scoped("&recording=Purged")).body)).toEqual(["purged-recording-call", "purged-expired-call"]);
    expect(ids((await scoped("&recording=Expired")).body)).toEqual(["unpurged-expired-call"]);
  });
});

describe.sequential("Calls condition groups", () => {
  const ids = (body: ListedCalls) => body.calls.map((call) => call.id);
  const grouped = (cookie: string, adv: unknown, query = "") => listCalls(cookie, `?adv=${encodeURIComponent(JSON.stringify(adv))}${query}`);

  beforeAll(async () => {
    await pool!.query(
      `insert into workspace (id, organization_id, name, reporting_timezone, state, recording_enabled, created_at, updated_at)
       values ('grouped-office', $1, 'Grouped Office', 'UTC', 'Active', true, now(), now())`,
      [organizationId],
    );
    await seedWorkspaceRouting("grouped-office");
    await seedCall({ id: "grouped-strong-call", workspaceId: "grouped-office", minutesAgo: 3, recording: "Stored", assessment: { classification: "Good Lead", score: 90 } });
    await seedCall({ id: "grouped-weak-call", workspaceId: "grouped-office", minutesAgo: 4, recording: "Stored", assessment: { classification: "Uncertain", score: 30 } });
    await seedCall({ id: "grouped-voicemail-call", workspaceId: "grouped-office", minutesAgo: 5, outcome: "Voicemail" });
    await seedCall({ id: "grouped-missed-call", workspaceId: "grouped-office", minutesAgo: 6, outcome: "Missed" });
  });

  it("matches either Call Outcome when a group joins two outcome conditions with Or", async () => {
    const adv = { combinator: "and", rules: [{ combinator: "or", rules: [{ field: "outcome", values: ["Voicemail"] }, { field: "outcome", values: ["Missed"] }] }] };
    const { body } = await grouped(operatorCookie, adv, "&workspaceId=grouped-office");
    expect(ids(body)).toEqual(["grouped-voicemail-call", "grouped-missed-call"]);
    expect(body.total).toBe(2);
  });

  it("nests groups so A And (B Or C) and a root Or each match their own Calls, and flat filters still And with the tree", async () => {
    const strongOrShort = { combinator: "or", rules: [{ field: "leadScore", min: 80, max: null }, { field: "connectedDuration", min: null, max: 10 }] };
    const nested = await grouped(operatorCookie, { combinator: "and", rules: [{ field: "outcome", values: ["Answered"] }, strongOrShort] }, "&workspaceId=grouped-office");
    expect(ids(nested.body)).toEqual(["grouped-strong-call"]);
    const rootOr = { combinator: "or", rules: [{ field: "outcome", values: ["Missed"] }, { combinator: "and", rules: [{ field: "outcome", values: ["Answered"] }, { field: "leadClassification", values: ["Uncertain"] }] }] };
    expect(ids((await grouped(operatorCookie, rootOr, "&workspaceId=grouped-office")).body)).toEqual(["grouped-weak-call", "grouped-missed-call"]);
    expect(ids((await grouped(operatorCookie, rootOr, "&workspaceId=grouped-office&outcome=Missed")).body)).toEqual(["grouped-missed-call"]);
  });

  it("never widens authorization through Or: a Client Viewer asking for an ungranted Workspace Or anything gets no ungranted Calls", async () => {
    const ungrantedOrVoicemail = { combinator: "or", rules: [{ field: "workspace", values: ["ungranted-active", "grouped-office", "other-organization-workspace"] }, { field: "outcome", values: ["Voicemail"] }] };
    const global = await grouped(clientCookie, ungrantedOrVoicemail);
    expect(global.response.status).toBe(200);
    expect(ids(global.body)).toEqual(["voicemail-call"]);
    expect(global.body.calls.every((call) => ["granted-active", "granted-quiet"].includes(call.workspace.id))).toBe(true);
    const nested = { combinator: "and", rules: [{ combinator: "or", rules: [{ field: "workspace", values: ["ungranted-active"] }, { field: "outcome", values: ["Missed", "Voicemail"] }] }] };
    expect(ids((await grouped(clientCookie, nested)).body)).toEqual(["voicemail-call"]);
    expect(ids((await grouped(clientCookie, ungrantedOrVoicemail, "&workspaceId=granted-active")).body)).toEqual([]);
    expect((await grouped(clientCookie, ungrantedOrVoicemail, "&workspaceId=ungranted-active")).response.status).toBe(404);
  });

  it("ignores a tree deeper than three levels or holding more than 20 conditions and groups, leaving the scope unfiltered", async () => {
    const missed = { field: "outcome", values: ["Missed"] };
    const deep = (depth: number): unknown => ({ combinator: "and", rules: [missed, ...(depth > 1 ? [deep(depth - 1)] : [])] });
    expect(ids((await grouped(operatorCookie, deep(3), "&workspaceId=grouped-office")).body)).toEqual(["grouped-missed-call"]);
    expect((await grouped(operatorCookie, deep(4), "&workspaceId=grouped-office")).body.total).toBe(4);
    expect(ids((await grouped(operatorCookie, { combinator: "or", rules: Array.from({ length: 20 }, () => missed) }, "&workspaceId=grouped-office")).body)).toEqual(["grouped-missed-call"]);
    expect((await grouped(operatorCookie, { combinator: "or", rules: Array.from({ length: 21 }, () => missed) }, "&workspaceId=grouped-office")).body.total).toBe(4);
  });
});

describe.sequential("Call Detail previous and next Call", () => {
  const callList = async (cookie: string) => createCallList(pool!, await requireActiveActor(auth(), pool!, new Headers({ cookie })));
  const query = (search = "") => callListQueryFromSearchParams(new URLSearchParams(search));
  const neighborIds = (neighbors: { previous: { id: string } | null; next: { id: string } | null } | null) => [neighbors?.previous?.id ?? null, neighbors?.next?.id ?? null];

  it("walks a Workspace's Calls Started descending with no source list, and returns no Call past either end", async () => {
    const calls = await callList(clientCookie);
    expect(await calls.neighbors({ ...query(), workspaceId: "granted-active" }, "assessed-call")).toEqual({
      previous: null,
      next: { id: "reviewed-call", workspaceId: "granted-active", callerNumber: "+13125550101", startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/) },
    });
    expect(await calls.neighbors({ ...query(), workspaceId: "granted-active" }, "reviewed-call")).toEqual({ previous: expect.objectContaining({ id: "assessed-call", workspaceId: "granted-active" }), next: null });
  });

  it("follows the source list's filter and non-default sort, across Workspaces in global Calls", async () => {
    const calls = await callList(operatorCookie);
    expect(await calls.neighbors(query("scoreMin=1&sort=leadScore&order=asc"), "assessed-call")).toEqual({
      previous: expect.objectContaining({ id: "grouped-weak-call", workspaceId: "grouped-office" }),
      next: expect.objectContaining({ id: "reviewed-call", workspaceId: "granted-active" }),
    });
    expect(neighborIds(await calls.neighbors(query("scoreMin=1&sort=leadScore&order=desc"), "assessed-call"))).toEqual(["reviewed-call", "grouped-weak-call"]);
    expect(neighborIds(await calls.neighbors(query("scoreMin=1&sort=leadScore&order=asc"), "grouped-weak-call"))).toEqual([null, "assessed-call"]);
    expect(neighborIds(await calls.neighbors(query("scoreMin=1&sort=leadScore&order=asc"), "grouped-strong-call"))).toEqual(["reviewed-call", null]);
  });

  it.each([
    ["the default order", ""],
    ["a connected duration sort with a Call Outcome filter", "sort=connectedDuration&order=desc&outcome=Answered"],
    ["an Or tree with a Workspace sort", `sort=workspace&order=asc&adv=${encodeURIComponent(JSON.stringify({ combinator: "or", rules: [{ field: "outcome", values: ["Voicemail"] }, { field: "leadScore", min: 50, max: null }] }))}`],
  ])("matches the rows on either side of each Call in the list itself under %s", async (_name, search) => {
    const calls = await callList(operatorCookie);
    const listed: { id: string; workspaceId: string; callerNumber: string | null; startedAt: string }[] = [];
    for (let page = 1; ; page += 1) {
      const result = (await calls.list({ ...query(search), page }))!;
      listed.push(...result.calls.map((call) => ({ id: call.id, workspaceId: call.workspace.id, callerNumber: call.callerNumber, startedAt: call.startedAt })));
      if (listed.length >= result.total) break;
    }
    expect(listed.length).toBeGreaterThan(2);
    for (const [index, call] of listed.entries()) {
      expect(await calls.neighbors(query(search), call.id)).toEqual({ previous: listed[index - 1] ?? null, next: listed[index + 1] ?? null });
    }
  });

  it("walks an Activity source with its caller-only search", async () => {
    const calls = await callList(operatorCookie);
    expect(neighborIds(await calls.neighbors(query("q=Acme"), "assessed-call"))).not.toEqual([null, null]);
    expect(await calls.neighbors({ ...query("q=Acme"), callerSearchOnly: true }, "assessed-call")).toEqual({ previous: null, next: null });
    expect(neighborIds(await calls.neighbors({ ...query("q=555"), callerSearchOnly: true }, "assessed-call"))).toEqual(["ungranted-call", "reviewed-call"]);
  });

  it("never steps a Client Viewer into an ungranted Workspace's Call and gives no neighbors for an ungranted Call", async () => {
    expect(neighborIds(await (await callList(operatorCookie)).neighbors(query(), "assessed-call"))).toEqual(["ungranted-call", "reviewed-call"]);
    const calls = await callList(clientCookie);
    expect(neighborIds(await calls.neighbors(query(), "assessed-call"))).toEqual(["in-progress-call", "reviewed-call"]);
    expect(await calls.neighbors(query(), "ungranted-call")).toEqual({ previous: null, next: null });
    expect(await calls.neighbors({ ...query(), workspaceId: "ungranted-active" }, "ungranted-call")).toBeNull();
    expect(await calls.neighbors(query("workspace=ungranted-active"), "assessed-call")).toEqual({ previous: null, next: null });
  });
});
