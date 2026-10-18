/**
 * -------------------------------------------------------------------------
 * @file   lead-review.test.ts
 * @brief  Verifies Operator Lead Reviews and the effective Lead classification.
 *
 * @description
 *  Signs in a real Operator and Client Viewer and writes Lead Reviews
 *  through the Workspaces server interface to prove one overwritable Lead
 *  Review per Call, Operator-only writes, the same Not Found as Call Detail
 *  reads, input validation, an untouched Lead Assessment, and the Lead
 *  Review and effective Lead classification in the Call Detail read model.
 *
 * @remarks
 *  Calls, Recordings, and Lead Assessments are seeded directly in the shape
 *  the webhook and Recording tasks persist, because those writers have
 *  their own suites.
 *
 * @see
 *  data/lead-reviews.ts
 *  data/lead-classification.ts
 *  data/call-details.ts
 *  data/workspaces-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { generateInitialCallFlow } from "@/data/call-flow";
import { createIntegrations } from "@/data/integrations";
import { migrateDatabase } from "@/data/migrate";
import { createOperatorAdministrationHandler } from "@/data/operator-administration-handler";
import { schema } from "@/data/schema";
import { createTracerAuth } from "@/data/tracer-auth";
import { type TwilioClient } from "@/data/twilio-client";
import { createWorkspacesHandler } from "@/data/workspaces-handler";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let organizationId = "";
let operatorId = "";
let operatorCookie = "";
let clientCookie = "";
const messages: { to: string; subject: string; text: string; html: string }[] = [];
const backgroundTasks: Promise<unknown>[] = [];
const recipients = new Set(["operator@example.com", "second-operator@example.com", "client@example.com"]);
const fakeTwilio: TwilioClient = {
  async fetchAccount() { throw new Error("not implemented"); },
  async listIncomingPhoneNumbers() { throw new Error("not implemented"); },
  async fetchIncomingPhoneNumber() { throw new Error("not implemented"); },
  async updateIncomingPhoneNumberVoice() { throw new Error("not implemented"); },
};
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

const workspacesHandler = () => createWorkspacesHandler({
  auth: auth(),
  database: database(),
  pool: pool!,
  twilio: fakeTwilio,
  integrations: (id) => createIntegrations({ pool: pool!, organizationId: id, twilio: fakeTwilio, masterKey: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=", activeWorkspaceCount: async () => 0 }),
  baseURL: "http://localhost:3000",
});

const usersHandler = () => createOperatorAdministrationHandler({
  auth: auth(),
  database: database(),
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

async function putLeadReview(workspaceId: string, callId: string, cookie: string, body: unknown) {
  const response = await workspacesHandler()(new Request(`http://localhost:3000/api/workspaces/${workspaceId}/calls/${callId}/lead-review`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
  return { response, body: (await response.json()) as { leadReview?: Record<string, unknown>; error?: string } };
}

async function callDetail(workspaceId: string, callId: string, cookie: string) {
  const response = await workspacesHandler()(new Request(`http://localhost:3000/api/workspaces/${workspaceId}/calls/${callId}`, { headers: { cookie } }));
  expect(response.status).toBe(200);
  return ((await response.json()) as { call: Record<string, unknown> }).call;
}

async function storedReviews(callId: string) {
  return (await pool!.query("select classification, note, reviewer_user_id, reviewed_at from lead_review where call_id = $1", [callId])).rows;
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

async function seedCall(callId: string, workspaceId = "granted-active", assessment: string | null = null): Promise<void> {
  seeded += 1;
  const sequence = String(seeded).padStart(32, "0");
  const workspace = (await pool!.query<{ organization_id: string }>("select organization_id from workspace where id = $1", [workspaceId])).rows[0];
  const trackingNumber = `+1415555${String(seeded).padStart(4, "0")}`;
  await pool!.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ($1, $2, $3, $4, 'Call Number', true, now(), now(), now(), now())`,
    [`${callId}-number`, workspace.organization_id, `PN${sequence}`, trackingNumber],
  );
  await pool!.query(
    `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, ended_at, ended_reason, created_at)
     values ($1, $2, $3, $4, $5, now(), now(), 'replaced', now())`,
    [`${callId}-assignment`, workspace.organization_id, workspaceId, `${callId}-number`, trackingNumber],
  );
  await pool!.query(
    `insert into flow_version (id, organization_id, workspace_id, version, graph, published_at) values ($1, $2, $3, $4, $5, now())`,
    [`${callId}-flow`, workspace.organization_id, workspaceId, seeded, JSON.stringify(graph)],
  );
  await pool!.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, caller_number,
                       state, outcome, outcome_reason, started_at, ended_at, duration_seconds, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, '+13125550142', 'Completed', 'Voicemail', 'flow_outcome', now() - interval '10 minutes', now() - interval '9 minutes', 60, now(), now())`,
    [callId, workspace.organization_id, workspaceId, `${callId}-assignment`, `${callId}-flow`, `CA${sequence}`, trackingNumber],
  );
  await pool!.query(
    `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, transfer_state, r2_object_key, size_bytes, sha256, stored_at,
                            waveform_state, transcript_state, transcript_audio_ms, transcript_cost_usd, transcript_completed_at, lead_assessment_state, created_at, updated_at)
     values ($1, $2, $3, $4, $5, 'voicemail', 1, 40, 'Stored', $6, 1024, 'checksum', now(), 'Pending', 'Completed', 40000, 0.004, now(), $7, now(), now())`,
    [`${callId}-recording`, workspace.organization_id, workspaceId, callId, `RE${sequence}`, `recordings/${callId}-recording.wav`, assessment ? "Completed" : "Pending"],
  );
  if (assessment) {
    await pool!.query(
      `insert into lead_assessment (id, organization_id, call_id, recording_id, classification, score, summary, rationale, model, input_tokens, output_tokens, cost_usd, processed_at)
       values ($1, $2, $3, $4, $5, 82, 'Caller asked for a quote.', 'Clear service need.', 'gpt-5-mini', 900, 120, 0.000465, now())`,
      [`${callId}-assessment`, workspace.organization_id, callId, `${callId}-recording`, assessment],
    );
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrateDatabase(container.getConnectionUri());
  ({ organizationId, userId: operatorId } = await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "Example Operator", timezone: "UTC" }));
  await pool.query(`insert into organization (id, name, slug, created_at) values ('other-organization-id', 'Other', 'other', now())`);
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, recording_enabled, created_at, updated_at)
     values ('granted-active', $1, 'Acme Plumbing', 'UTC', 'Active', true, now(), now()),
            ('granted-quiet', $1, 'Quiet Dental', 'UTC', 'Active', true, now(), now()),
            ('ungranted-active', $1, 'Gamma HVAC', 'UTC', 'Active', true, now(), now()),
            ('other-organization-workspace', 'other-organization-id', 'Other Org Workspace', 'UTC', 'Active', true, now(), now())`,
    [organizationId],
  );
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, recording_enabled, created_at, updated_at, archived_at)
     values ('archived-workspace', $1, 'Old Roofing', 'UTC', 'Archived', true, now(), now(), now())`,
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
  await pool.query(
    `insert into access_grant (id, organization_id, workspace_id, user_id, created_at)
     values ('cross-organization-grant', 'other-organization-id', 'other-organization-workspace', $1, now())`,
    [clientId],
  );
  clientCookie = await signIn("client@example.com");
  await seedCall("assessed-call", "granted-active", "Good Lead");
  await seedCall("unassessed-call");
  await seedCall("ungranted-call", "ungranted-active");
  await seedCall("other-organization-call", "other-organization-workspace");
  await seedCall("archived-call", "archived-workspace");
}, 120_000);

afterAll(async () => { await pool?.end(); await container?.stop(); });

describe.sequential("Lead Review writes", () => {
  it("lets an Operator add a Lead Review and then overwrite it with a new reviewer time on the same single row", async () => {
    const created = await putLeadReview("granted-active", "assessed-call", operatorCookie, { classification: "Not Good Lead", note: "  Wrong service area.  " });
    expect(created.response.status).toBe(200);
    expect(created.body.leadReview).toEqual({ classification: "Not Good Lead", note: "Wrong service area.", reviewerName: "Example Operator", reviewedAt: expect.any(String) });
    const [first] = await storedReviews("assessed-call");
    expect(first).toMatchObject({ classification: "Not Good Lead", note: "Wrong service area.", reviewer_user_id: operatorId });

    const updated = await putLeadReview("granted-active", "assessed-call", operatorCookie, { classification: "Uncertain", note: "" });
    expect(updated.response.status).toBe(200);
    expect(updated.body.leadReview).toMatchObject({ classification: "Uncertain", note: null, reviewerName: "Example Operator" });
    const rows = await storedReviews("assessed-call");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ classification: "Uncertain", note: null, reviewer_user_id: operatorId });
    expect((rows[0].reviewed_at as Date).getTime()).toBeGreaterThan((first.reviewed_at as Date).getTime());
    expect(updated.body.leadReview?.reviewedAt).toBe((rows[0].reviewed_at as Date).toISOString());
  });

  it("never modifies the Lead Assessment", async () => {
    const before = (await pool!.query("select * from lead_assessment where call_id = 'assessed-call'")).rows;
    await putLeadReview("granted-active", "assessed-call", operatorCookie, { classification: "Not Good Lead" });
    expect((await pool!.query("select * from lead_assessment where call_id = 'assessed-call'")).rows).toEqual(before);
    expect(before[0]).toMatchObject({ classification: "Good Lead", score: 82 });
  });

  it("appends a Lead Review added event with its classification and reviewer for every add and update", async () => {
    await seedCall("review-history-call");
    await putLeadReview("granted-active", "review-history-call", operatorCookie, { classification: "Not Good Lead", note: "Wrong service area." });
    await putLeadReview("granted-active", "review-history-call", operatorCookie, { classification: "Good Lead" });
    const events = await pool!.query(
      "select kind, detail, actor_user_id, occurred_at from call_event where call_id = 'review-history-call' and kind = 'lead_review_added' order by occurred_at, id",
    );
    expect(events.rows).toEqual([
      { kind: "lead_review_added", detail: { classification: "Not Good Lead" }, actor_user_id: operatorId, occurred_at: expect.any(Date) },
      { kind: "lead_review_added", detail: { classification: "Good Lead" }, actor_user_id: operatorId, occurred_at: (await storedReviews("review-history-call"))[0].reviewed_at },
    ]);
  });

  it("appends no Lead Review event when a Client Viewer's Lead Review is refused", async () => {
    await putLeadReview("granted-active", "review-history-call", clientCookie, { classification: "Uncertain" });
    const events = await pool!.query("select count(*)::int as count from call_event where call_id = 'review-history-call' and kind = 'lead_review_added'");
    expect(events.rows[0].count).toBe(2);
  });

  it("refuses a Client Viewer's Lead Review with the Operator-only refusal and writes nothing", async () => {
    for (const callId of ["unassessed-call", "ungranted-call"]) {
      const { response, body } = await putLeadReview(callId === "ungranted-call" ? "ungranted-active" : "granted-active", callId, clientCookie, { classification: "Good Lead" });
      expect(response.status).toBe(403);
      expect(body).toEqual({ error: "forbidden" });
      expect(await storedReviews(callId)).toEqual([]);
    }
  });

  it("answers the same Not Found as Call Detail for another Workspace's path, another Organization, and a missing Call", async () => {
    const denied = [
      ["granted-quiet", "assessed-call"],
      ["other-organization-workspace", "other-organization-call"],
      ["granted-active", "other-organization-call"],
      ["granted-active", "missing-call"],
    ] as const;
    for (const [workspaceId, callId] of denied) {
      const { response, body } = await putLeadReview(workspaceId, callId, operatorCookie, { classification: "Good Lead" });
      expect(response.status).toBe(404);
      expect(body).toEqual({ error: "not_found" });
    }
    expect(await storedReviews("other-organization-call")).toEqual([]);
  });

  it("rejects an unauthenticated Lead Review", async () => {
    const { response } = await putLeadReview("granted-active", "unassessed-call", "", { classification: "Good Lead" });
    expect(response.status).toBe(401);
    expect(await storedReviews("unassessed-call")).toEqual([]);
  });

  it("rejects an invalid classification, an over-length note, and a malformed body", async () => {
    for (const body of [{ classification: "Pending" }, { note: "No classification" }, { classification: "Good Lead", note: "x".repeat(2001) }, { classification: "Good Lead", note: 3 }, "not json", "[]"]) {
      const result = await putLeadReview("granted-active", "unassessed-call", operatorCookie, body);
      expect(result.response.status).toBe(400);
      expect(result.body).toEqual({ error: "invalid_input" });
    }
    expect(await storedReviews("unassessed-call")).toEqual([]);
  });

  it("lets an Operator review a Call in an Archived Workspace", async () => {
    const { response, body } = await putLeadReview("archived-workspace", "archived-call", operatorCookie, { classification: "Good Lead" });
    expect(response.status).toBe(200);
    expect(body.leadReview).toMatchObject({ classification: "Good Lead" });
  });
});

describe.sequential("Lead Review in Call Detail", () => {
  it("shows no Lead Review and no effective classification before any review or assessment", async () => {
    const call = await callDetail("granted-active", "unassessed-call", operatorCookie);
    expect(call.leadReview).toBeNull();
    expect(call.effectiveLeadClassification).toBeNull();
  });

  it("uses the Lead Assessment as the effective classification until a Lead Review exists", async () => {
    await seedCall("assessment-only-call", "granted-active", "Good Lead");
    const call = await callDetail("granted-active", "assessment-only-call", clientCookie);
    expect(call.leadReview).toBeNull();
    expect(call.effectiveLeadClassification).toEqual({ classification: "Good Lead", source: "assessment" });
  });

  it("gives an Operator and a Client Viewer the Lead Review taking precedence over the Lead Assessment", async () => {
    await putLeadReview("granted-active", "assessed-call", operatorCookie, { classification: "Not Good Lead", note: "Wrong service area." });
    const [stored] = await storedReviews("assessed-call");
    for (const cookie of [operatorCookie, clientCookie]) {
      const call = await callDetail("granted-active", "assessed-call", cookie);
      expect(call.leadReview).toEqual({ classification: "Not Good Lead", note: "Wrong service area.", reviewerName: "Example Operator", reviewedAt: (stored.reviewed_at as Date).toISOString() });
      expect(call.effectiveLeadClassification).toEqual({ classification: "Not Good Lead", source: "review" });
    }
  });

  it("keeps the Lead Review without a reviewer name after its reviewer is deleted", async () => {
    await seedCall("orphaned-review-call");
    await pool!.query(`insert into "user" (id, name, email, email_verified, state, created_at, updated_at)
                       values ('departed-operator', 'Departed Operator', 'departed@example.com', true, 'Active', now(), now())`);
    await pool!.query(`insert into lead_review (call_id, organization_id, classification, reviewer_user_id, reviewed_at) values ('orphaned-review-call', $1, 'Good Lead', 'departed-operator', now())`, [organizationId]);
    await pool!.query(`delete from "user" where id = 'departed-operator'`);
    const call = await callDetail("granted-active", "orphaned-review-call", operatorCookie);
    expect(call.leadReview).toMatchObject({ classification: "Good Lead", note: null, reviewerName: null });
  });
});
