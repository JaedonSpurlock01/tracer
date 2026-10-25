/**
 * -------------------------------------------------------------------------
 * @file   form-submissions.test.ts
 * @brief  Verifies Form Submissions from a Site's POST through the Workspace routes.
 *
 * @description
 *  Exercises the public forms route (Forms key, Site hostname, Site Link, validation,
 *  idempotency, the hold rule from the third submission per person in 24
 *  hours), forwarding from the Site's address to the Workspace's
 *  recipients with Not configured, Failed, and Resend, Operator approve,
 *  reject, and review, the Operator-only Forms key and recipients, the
 *  Client Viewer's read-only list, and Good Leads counting Form
 *  Submissions beside Calls in analytics and Per Lead revenue.
 *
 * @remarks
 *  The suite uses one PostgreSQL container and real Better Auth sessions
 *  like the Deals suite. The Email Service is a fake that records messages
 *  and can be made to fail.
 *
 * @see
 *  data/form-submissions.ts
 *  data/forms-handler.ts
 *  data/workspaces-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestPool } from "./test-pool";

import { createAnalytics } from "@/data/analytics";
import type { Actor } from "@/data/authorization";
import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { createCostRevenue } from "@/data/cost-revenue";
import { createFormsKey } from "@/data/form-submissions";
import { createFormsHandler } from "@/data/forms-handler";
import { createIntegrations } from "@/data/integrations";
import { migrateDatabase } from "@/data/migrate";
import { schema } from "@/data/schema";
import { createTracerAuth } from "@/data/tracer-auth";
import type { TransactionalEmail, TransactionalEmailMessage } from "@/data/transactional-email";
import type { TwilioClient } from "@/data/twilio-client";
import { createWorkspacesHandler } from "@/data/workspaces-handler";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let organizationId = "";
let operatorId = "";
const viewerId = "viewer-user-id";
const authMessages: { to: string; subject: string; text: string; html: string }[] = [];
const forwarded: TransactionalEmailMessage[] = [];
let emailDown = false;
const backgroundTasks: Promise<unknown>[] = [];
const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
let formKey = "";
const ids: Record<string, string> = {};

const fakeTwilio: TwilioClient = {
  async fetchAccount() { throw new Error("not implemented"); },
  async listIncomingPhoneNumbers() { throw new Error("not implemented"); },
  async fetchIncomingPhoneNumber() { throw new Error("not implemented"); },
  async updateIncomingPhoneNumberVoice() { throw new Error("not implemented"); },
};

const forwardingEmail: TransactionalEmail = {
  async send(message) {
    if (emailDown) throw new Error("Email Service: 503 temporarily unavailable");
    forwarded.push(message);
    return { messageId: `forward-${forwarded.length}` };
  },
};

const database = () => drizzle(pool!, { schema });
const auth = () => createTracerAuth({
  database: database(),
  email: { async send(message) { authMessages.push(message as typeof authMessages[number]); return { messageId: `email-${authMessages.length}` }; } },
  emailFrom: "auth@example.com",
  allowedRecipients: new Set(["operator@example.com", "viewer@example.com"]),
  backgroundTask: (promise) => backgroundTasks.push(promise),
  secret: "integration-only-secret",
  baseURL: "http://localhost:3000",
});

function handler() {
  return createWorkspacesHandler({
    auth: auth(),
    pool: pool!,
    email: forwardingEmail,
    twilio: fakeTwilio,
    integrations: (orgId) => createIntegrations({ pool: pool!, organizationId: orgId, twilio: fakeTwilio, masterKey }),
    baseURL: "http://localhost:3000",
  });
}

async function signIn(email: string): Promise<string> {
  const before = authMessages.length;
  const taskCount = backgroundTasks.length;
  const instance = auth();
  const send = await instance.handler(new Request("http://localhost:3000/api/auth/email-otp/send-verification-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, type: "sign-in" }) }));
  expect(send.status).toBe(200);
  await Promise.all(backgroundTasks.splice(taskCount));
  const code = authMessages.slice(before).at(-1)?.text.match(/\d{6}/)?.[0];
  const verify = await instance.handler(new Request("http://localhost:3000/api/auth/sign-in/email-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, otp: code }) }));
  expect(verify.status).toBe(200);
  return (verify.headers.get("set-cookie") ?? "").split(";", 1)[0];
}

async function json(request: Request): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await handler()(request);
  return { response, body: response.status === 204 ? {} : await response.json() as Record<string, unknown> };
}

function send(cookie: string, method: string, route: string, body?: unknown): Request {
  return new Request(`http://localhost:3000/api/workspaces/${route}`, { method, headers: { cookie, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

const maria = { Name: "Maria Lopez", Phone: "(208) 555-0142", Email: "maria@example.com", Service: "Asphalt Driveway Paving", "Approx. size": "1,200 sq ft" };
const dan = { Name: "Dan Whitfield", Phone: "(208) 555-0199", Email: "dan.w@example.com", Service: "Asphalt Sealcoating", "Approx. size": "4,000 sq ft" };

async function post(submissionId: string, fields: Record<string, string>, options: { key?: string | null; page?: string; site?: string } = {}): Promise<{ response: Response; body: Record<string, unknown> }> {
  const key = options.key === undefined ? formKey : options.key;
  const response = await createFormsHandler({ pool: pool!, email: forwardingEmail })(
    new Request("http://localhost:3000/api/forms", {
      method: "POST",
      headers: { "content-type": "application/json", ...(key === null ? {} : { authorization: `Bearer ${key}` }) },
      body: JSON.stringify({ site: options.site ?? "https://www.PocatelloAsphaltPaving.com/", submissionId, page: options.page ?? "/contact/", fields }),
    }),
  );
  return { response, body: response.status === 204 ? {} : await response.json() as Record<string, unknown> };
}

function operatorActor(): Actor {
  return { userId: operatorId, organizationId, role: "Operator", state: "Active", name: "Example Operator", email: "operator@example.com", timezone: "America/Chicago" };
}

function viewerActor(): Actor {
  return { userId: viewerId, organizationId, role: "Client Viewer", state: "Active", name: "Client Viewer", email: "viewer@example.com", timezone: "UTC" };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = createTestPool(container.getConnectionUri());
  await migrateDatabase(container.getConnectionUri());
  const bootstrapped = await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "Example Operator", timezone: "America/Chicago" });
  organizationId = bootstrapped.organizationId;
  operatorId = bootstrapped.userId;
  await pool.query(
    `insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at)
     values ($1, 'Client Viewer', 'viewer@example.com', false, 'Active', 'UTC', now(), now())`,
    [viewerId],
  );
  await pool.query("insert into member (id, organization_id, user_id, role, created_at) values ('viewer-membership-id', $1, $2, 'member', now())", [organizationId, viewerId]);
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, created_at, updated_at) values
       ('workspace-a', $1, 'Pocatello Paving', 'UTC', 'Active', now(), now()),
       ('workspace-b', $1, 'St George Paving', 'America/Denver', 'Active', now(), now())`,
    [organizationId],
  );
  await pool.query("insert into access_grant (id, organization_id, workspace_id, user_id, created_at) values ('grant-a', $1, 'workspace-a', $2, now())", [organizationId, viewerId]);
  await pool.query(
    `insert into site (id, organization_id, script_name, primary_hostname, zone_id, first_seen_at, last_seen_at, created_at, updated_at) values
       ('site-pocatello', $1, 'asphalt-paving-pocatello', 'pocatelloasphaltpaving.com', 'zone-1', now(), now(), now(), now())`,
    [organizationId],
  );
  await pool.query(
    "insert into site_link (id, organization_id, site_id, workspace_id, started_at, started_by_user_id) values ('link-a', $1, 'site-pocatello', 'workspace-a', now(), $2)",
    [organizationId, operatorId],
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe.sequential("Form Submissions", () => {
  it("lets an Operator generate the Organization's one Forms key and refuses a Client Viewer", async () => {
    expect(() => createFormsKey(pool!, viewerActor())).toThrow();
    const keys = createFormsKey(pool!, operatorActor());
    expect(await keys.status()).toBeNull();
    const generated = await keys.generate();
    expect(generated).toEqual({ key: expect.stringMatching(/^fk_[A-Za-z0-9_-]{32,}$/), createdAt: expect.any(String) });
    formKey = generated.key;
    expect(await keys.status()).toEqual({ createdAt: generated.createdAt });
    const stored = await pool!.query<{ forms_key_hash: string }>("select forms_key_hash from organization where id = $1", [organizationId]);
    expect(stored.rows[0].forms_key_hash).not.toContain(formKey);
    expect(stored.rows[0].forms_key_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a missing or unknown key, an unknown hostname, an unlinked Site, and a contactless submission without storing a row", async () => {
    expect((await post("s-nokey", maria, { key: null })).response.status).toBe(401);
    expect((await post("s-badkey", maria, { key: "fk_wrong" })).response.status).toBe(401);
    const unknown = await post("s-unknown-site", maria, { site: "someone-elses-site.example" });
    expect(unknown.response.status).toBe(404);
    expect(unknown.body).toEqual({ error: "site_unknown" });
    expect((await post("s-nosite", maria, { site: "" })).response.status).toBe(400);
    await pool!.query("update site_link set ended_at = now() where id = 'link-a'");
    const unlinked = await post("s-unlinked", maria);
    expect(unlinked.response.status).toBe(409);
    expect(unlinked.body).toEqual({ error: "site_not_linked" });
    await pool!.query(
      "insert into site_link (id, organization_id, site_id, workspace_id, started_at, started_by_user_id) values ('link-a2', $1, 'site-pocatello', 'workspace-a', now(), $2)",
      [organizationId, operatorId],
    );
    expect((await post("s-noname", { Phone: "(208) 555-0000" })).response.status).toBe(400);
    expect((await post("s-nocontact", { Name: "Nobody" })).response.status).toBe(400);
    expect((await pool!.query("select count(*)::int as n from form_submission")).rows[0].n).toBe(0);
  });

  it("stores a submission with no recipients as Not forwarded, then forwards it on Resend from the Site's address", async () => {
    const created = await post("s-1", maria);
    expect(created.response.status).toBe(201);
    expect(created.body.submission).toMatchObject({ id: expect.any(String), held: false, forward: { status: "Not configured", to: [] } });
    ids.first = (created.body.submission as { id: string }).id;
    expect(forwarded).toHaveLength(0);

    const operator = await signIn("operator@example.com");
    expect((await json(send(operator, "PUT", "workspace-a/forms/forwarding", { emails: ["not-an-email"] }))).response.status).toBe(400);
    const recipients = await json(send(operator, "PUT", "workspace-a/forms/forwarding", { emails: [" Owner@PocatelloPaving.example ", "jaedon@spurlocklabs.example"] }));
    expect(recipients.response.status).toBe(200);
    expect(recipients.body).toEqual({ forwardTo: ["owner@pocatellopaving.example", "jaedon@spurlocklabs.example"] });

    const resent = await json(send(operator, "POST", `workspace-a/forms/${ids.first}/resend`));
    expect(resent.response.status).toBe(200);
    expect(resent.body.submission).toMatchObject({ id: ids.first, forward: { status: "Sent", to: ["owner@pocatellopaving.example", "jaedon@spurlocklabs.example"], forwardedAt: expect.any(String) } });
    expect(forwarded).toHaveLength(1);
    const message = forwarded[0];
    expect(message.from).toEqual({ name: "Pocatello Paving", email: "info@pocatelloasphaltpaving.com" });
    expect(message.to).toEqual(["owner@pocatellopaving.example", "jaedon@spurlocklabs.example"]);
    expect(message.replyTo).toEqual({ name: "Maria Lopez", email: "maria@example.com" });
    expect(message.subject).toBe("New lead from pocatelloasphaltpaving.com: Maria Lopez");
    expect(message.text).toContain("Service: Asphalt Driveway Paving");
    expect(message.text).toContain("Approx. size: 1,200 sq ft");
    expect(message.html).toContain("Maria Lopez");
  });

  it("answers a repeated submission id with the existing row and sends no second email", async () => {
    const again = await post("s-1", { ...maria, Service: "Changed" });
    expect(again.response.status).toBe(200);
    expect(again.body.submission).toMatchObject({ id: ids.first, forward: { status: "Sent" } });
    expect(forwarded).toHaveLength(1);
    expect((await pool!.query("select count(*)::int as n from form_submission")).rows[0].n).toBe(1);
  });

  it("forwards the same person's second submission but holds the third until approved and rejects a fourth", async () => {
    const second = await post("s-2", { ...maria, Email: "maria.lopez@other.example", Service: "Asphalt Repair" });
    expect(second.response.status).toBe(201);
    expect(second.body.submission).toMatchObject({ held: false, forward: { status: "Sent" } });
    expect((await pool!.query("select repeat_of_id from form_submission where submission_id = 's-2'")).rows[0].repeat_of_id).toBe(ids.first);
    expect(forwarded).toHaveLength(2);

    const third = await post("s-3", maria);
    expect(third.response.status).toBe(201);
    expect(third.body.submission).toMatchObject({ held: true, forward: { status: "Held", to: [] } });
    ids.third = (third.body.submission as { id: string }).id;
    expect(forwarded).toHaveLength(2);

    const operator = await signIn("operator@example.com");
    expect((await json(send(operator, "PUT", `workspace-a/forms/${ids.third}/review`, { classification: "Good Lead" }))).response.status).toBe(409);
    const approved = await json(send(operator, "POST", `workspace-a/forms/${ids.third}/approve`));
    expect(approved.response.status).toBe(200);
    expect(approved.body.submission).toMatchObject({ id: ids.third, held: false, forward: { status: "Sent" }, effectiveClassification: { classification: "Good Lead", source: "default" } });
    expect(forwarded).toHaveLength(3);
    expect((await json(send(operator, "POST", `workspace-a/forms/${ids.third}/approve`))).response.status).toBe(409);

    const fourth = await post("s-4", maria);
    expect(fourth.body.submission).toMatchObject({ held: true });
    ids.fourth = (fourth.body.submission as { id: string }).id;
    const rejected = await json(send(operator, "POST", `workspace-a/forms/${ids.fourth}/reject`));
    expect(rejected.response.status).toBe(200);
    expect(rejected.body.submission).toMatchObject({ id: ids.fourth, held: false, forward: { status: "Rejected" }, effectiveClassification: { classification: "Not Good Lead", source: "review" } });
    expect(forwarded).toHaveLength(3);

    await pool!.query("update form_submission set received_at = received_at - interval '25 hours'");
    const fresh = await post("s-5", maria);
    expect(fresh.body.submission).toMatchObject({ held: false, forward: { status: "Sent" } });
    expect((await pool!.query("select repeat_of_id from form_submission where submission_id = 's-5'")).rows[0].repeat_of_id).toBeNull();
    ids.fresh = (fresh.body.submission as { id: string }).id;
    expect(forwarded).toHaveLength(4);
  });

  it("records a provider failure as Forward failed and recovers with Resend", async () => {
    emailDown = true;
    const failed = await post("s-6", dan);
    expect(failed.response.status).toBe(201);
    expect(failed.body.submission).toMatchObject({ forward: { status: "Failed", error: "Email Service: 503 temporarily unavailable" } });
    ids.dan = (failed.body.submission as { id: string }).id;
    emailDown = false;
    const operator = await signIn("operator@example.com");
    const resent = await json(send(operator, "POST", `workspace-a/forms/${ids.dan}/resend`));
    expect(resent.body.submission).toMatchObject({ forward: { status: "Sent", error: null } });
    expect(forwarded.at(-1)?.replyTo).toEqual({ name: "Dan Whitfield", email: "dan.w@example.com" });
  });

  it("applies and clears an Operator review with reporting precedence", async () => {
    const operator = await signIn("operator@example.com");
    expect((await json(send(operator, "PUT", `workspace-a/forms/${ids.dan}/review`, { classification: "Maybe" }))).response.status).toBe(400);
    const reviewed = await json(send(operator, "PUT", `workspace-a/forms/${ids.dan}/review`, { classification: "Not Good Lead", note: "Asked for a free sealcoat" }));
    expect(reviewed.response.status).toBe(200);
    expect(reviewed.body.submission).toMatchObject({ review: { classification: "Not Good Lead", note: "Asked for a free sealcoat", reviewer: { id: operatorId, name: "Example Operator" } }, effectiveClassification: { classification: "Not Good Lead", source: "review" } });
    const cleared = await json(send(operator, "DELETE", `workspace-a/forms/${ids.dan}/review`));
    expect(cleared.response.status).toBe(200);
    expect(cleared.body.submission).toMatchObject({ review: null, effectiveClassification: { classification: "Good Lead", source: "default" } });
  });

  it("lists submissions for the Workspace, with the key and recipients for Operators only", async () => {
    const operator = await signIn("operator@example.com");
    const listed = await json(send(operator, "GET", "workspace-a/forms"));
    expect(listed.response.status).toBe(200);
    expect(listed.body.workspace).toEqual({ id: "workspace-a", name: "Pocatello Paving" });
    expect(listed.body.site).toEqual({ id: "site-pocatello", primaryHostname: "pocatelloasphaltpaving.com" });
    expect(listed.body.forwardTo).toEqual(["owner@pocatellopaving.example", "jaedon@spurlocklabs.example"]);
    expect(listed.body.heldCount).toBe(0);
    const submissions = listed.body.submissions as { id: string; receivedAt: string }[];
    expect(submissions.map((row) => row.id)).toEqual([ids.dan, ids.fresh, ids.fourth, ids.third, expect.any(String), ids.first]);
    expect(JSON.stringify(listed.body)).not.toContain(formKey);

    const viewer = await signIn("viewer@example.com");
    const viewed = await json(send(viewer, "GET", "workspace-a/forms"));
    expect(viewed.response.status).toBe(200);
    expect(viewed.body.forwardTo).toBeUndefined();
    expect((viewed.body.submissions as unknown[]).length).toBe(6);
    expect((await json(send(viewer, "GET", "workspace-b/forms"))).response.status).toBe(404);
    for (const request of [
      send(viewer, "POST", `workspace-a/forms/${ids.dan}/resend`),
      send(viewer, "POST", `workspace-a/forms/${ids.dan}/approve`),
      send(viewer, "POST", `workspace-a/forms/${ids.dan}/reject`),
      send(viewer, "PUT", `workspace-a/forms/${ids.dan}/review`, { classification: "Good Lead" }),
      send(viewer, "PUT", "workspace-a/forms/forwarding", { emails: [] }),
    ]) {
      expect((await json(request)).response.status, request.url).toBe(403);
    }
    expect((await json(send(operator, "GET", "workspace-b/forms"))).body).toMatchObject({ site: null, submissions: [] });
  });

  it("counts Good Lead Form Submissions beside Calls in analytics and Per Lead revenue", async () => {
    const analytics = createAnalytics(pool!, operatorActor());
    const summary = await analytics.summary({ workspaceId: "workspace-a", range: { kind: "all" } });
    // first, second (repeat), third (approved), fresh, dan are Good Leads; fourth was rejected.
    expect(summary?.kpis.goodLeads.value).toBe(5);
    expect(summary?.kpis.totalCalls.value).toBe(0);
    expect(summary?.trend.points.reduce((sum, point) => sum + point.goodLeads, 0)).toBe(5);
    const stats = await analytics.workspaceListStats(["workspace-a"]);
    expect(stats["workspace-a"].goodLeadsLast30Days).toBe(5);

    const operator = await signIn("operator@example.com");
    const now = new Date();
    const month = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
    expect((await json(send(operator, "POST", "workspace-a/deal", { kind: "Per Lead", amountCents: 7500, startedOn: `${month.year}-${String(month.month).padStart(2, "0")}-01` }))).response.status).toBe(201);
    const monthly = await createCostRevenue(pool!, operatorActor()).monthly(["workspace-a"], month);
    expect(monthly["workspace-a"]).toMatchObject({ goodLeads: 5, revenueCents: 5 * 7500 });
  });

  it("revokes the Forms key so every Site's POSTs are refused until a new one is generated", async () => {
    const keys = createFormsKey(pool!, operatorActor());
    await keys.revoke();
    expect(await keys.status()).toBeNull();
    expect((await post("s-7", dan)).response.status).toBe(401);
    const rotated = await keys.generate();
    expect(rotated.key).not.toBe(formKey);
    expect((await post("s-7", dan, { key: rotated.key })).response.status).toBe(201);
  });
});
