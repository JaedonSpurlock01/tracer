/**
 * -------------------------------------------------------------------------
 * @file   workspaces.test.ts
 * @brief  Verifies Organization-scoped Workspace routes and lifecycle.
 *
 * @description
 *  Exercises authenticated Workspace creation, validation, list behavior,
 *  lifecycle transitions, isolation, and the absence of provider mutations.
 *
 * @remarks
 *  The suite uses one PostgreSQL container and real Better Auth sessions.
 *
 * @see
 *  data/workspaces-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { createIntegrations } from "@/data/integrations";
import { migrateDatabase } from "@/data/migrate";
import { schema } from "@/data/schema";
import { createTracerAuth } from "@/data/tracer-auth";
import { type TwilioClient } from "@/data/twilio-client";
import { createWorkspacesHandler } from "@/data/workspaces-handler";
import { createWorkspaces } from "@/data/workspaces";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let firstOrganizationId = "";
let firstOperatorId = "";
let secondOrganizationId = "";
let viewerId = "";
const messages: { to: string; subject: string; text: string; html: string }[] = [];
const backgroundTasks: Promise<unknown>[] = [];
const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const fakeTwilio: TwilioClient = {
  async fetchAccount() { throw new Error("not implemented"); },
  async listIncomingPhoneNumbers() { throw new Error("not implemented"); },
  async fetchIncomingPhoneNumber() { throw new Error("not implemented"); },
  async updateIncomingPhoneNumberVoice() { throw new Error("not implemented"); },
};

const database = () => drizzle(pool!, { schema });
const auth = () => createTracerAuth({
  database: database(),
  email: { async send(message) { messages.push(message); return { messageId: `email-${messages.length}` }; } },
  emailFrom: "auth@example.com",
  allowedRecipients: new Set(["first@example.com", "second@example.com", "viewer@example.com"]),
  backgroundTask: (promise) => backgroundTasks.push(promise),
  secret: "integration-only-secret",
  baseURL: "http://localhost:3000",
});

function handler() {
  return createWorkspacesHandler({
    auth: auth(),
    database: database(),
    pool: pool!,
    twilio: fakeTwilio,
    integrations: (organizationId) => createIntegrations({ pool: pool!, organizationId, twilio: fakeTwilio, masterKey, activeWorkspaceCount: async () => 0 }),
    baseURL: "http://localhost:3000",
  });
}

async function signIn(email: string): Promise<string> {
  const before = messages.length;
  const taskCount = backgroundTasks.length;
  const instance = auth();
  const send = await instance.handler(new Request("http://localhost:3000/api/auth/email-otp/send-verification-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, type: "sign-in" }) }));
  expect(send.status).toBe(200);
  await Promise.all(backgroundTasks.splice(taskCount));
  const code = messages.slice(before).at(-1)?.text.match(/\d{6}/)?.[0];
  const verify = await instance.handler(new Request("http://localhost:3000/api/auth/sign-in/email-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, otp: code }) }));
  expect(verify.status).toBe(200);
  return (verify.headers.get("set-cookie") ?? "").split(";", 1)[0];
}

async function json(request: Request): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await handler()(request);
  return { response, body: await response.json() as Record<string, unknown> };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrateDatabase(container.getConnectionUri());
  const first = await bootstrapInitialOperator(pool, { email: "first@example.com", name: "First Operator", timezone: "America/Chicago" });
  firstOrganizationId = first.organizationId;
  firstOperatorId = first.userId;
  secondOrganizationId = "second-organization-id";
  await pool.query(
    `insert into organization (id, name, slug, created_at) values ($1, 'Second Organization', 'second-organization', now())`,
    [secondOrganizationId],
  );
  await pool.query(
    `insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at)
     values ('second-operator-id', 'Second Operator', 'second@example.com', false, 'Active', 'UTC', now(), now())`,
  );
  await pool.query(
    `insert into member (id, organization_id, user_id, role, created_at) values ('second-membership-id', $1, 'second-operator-id', 'owner', now())`,
    [secondOrganizationId],
  );
  viewerId = "viewer-user-id";
  await pool!.query(
    `insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at)
     values ($1, 'Client Viewer', 'viewer@example.com', false, 'Active', 'UTC', now(), now())`,
    [viewerId],
  );
  await pool!.query(
    `insert into member (id, organization_id, user_id, role, created_at) values ('viewer-membership-id', $1, $2, 'member', now())`,
    [firstOrganizationId, viewerId],
  );
  await pool!.query(
    `insert into twilio_connection
       (id, organization_id, account_sid, api_key_sid, api_key_secret_ciphertext,
        connected_by_user_id, connected_at, created_at, updated_at)
     values ('first-connection-id', $1, 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
             'SK11111111111111111111111111111111', 'v1:placeholder-ciphertext', $2, now(), now(), now())`,
    [firstOrganizationId, firstOperatorId],
  );
  await pool!.query(
    `insert into twilio_number
       (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable,
        first_seen_at, last_seen_at, created_at, updated_at)
     values
       ('first-number-1', $1, 'PN11111111111111111111111111111111', '+14155550101', 'First Number', true, now(), now(), now(), now()),
       ('first-number-2', $1, 'PN22222222222222222222222222222222', '+14155550102', 'Second Number', true, now(), now(), now(), now())`,
    [firstOrganizationId],
  );
}, 120_000);

afterAll(async () => { await pool?.end(); await container?.stop(); });

describe.sequential("Workspaces", () => {
  it("requires authentication and limits ungranted Client Viewers to an empty read scope", async () => {
    expect((await json(new Request("http://localhost:3000/api/workspaces"))).response.status).toBe(401);
    const cookie = await signIn("viewer@example.com");
    const list = await json(new Request("http://localhost:3000/api/workspaces", { headers: { cookie } }));
    expect(list.response.status).toBe(200);
    expect(list.body).toMatchObject({ workspaces: [], total: 0, counts: { setupRequired: 0, active: 0, archived: 0 } });
    const create = await json(new Request("http://localhost:3000/api/workspaces", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Viewer", reportingTimezone: "UTC" }) }));
    expect(create.response.status).toBe(403);
  });

  it("creates Setup Required Workspaces and validates public inputs", async () => {
    const cookie = await signIn("first@example.com");
    const invalidName = await json(new Request("http://localhost:3000/api/workspaces", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: " ", reportingTimezone: "UTC" }) }));
    expect(invalidName.response.status).toBe(400);
    const invalidTimezone = await json(new Request("http://localhost:3000/api/workspaces", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Phoenix", reportingTimezone: "Nope/Nowhere" }) }));
    expect(invalidTimezone.response.status).toBe(400);
    const created = await json(new Request("http://localhost:3000/api/workspaces", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: " Phoenix ", reportingTimezone: "America/Chicago" }) }));
    expect(created.response.status).toBe(201);
    expect(created.body.workspace).toMatchObject({ name: "Phoenix", state: "Setup Required", destinationNumber: null, trackingNumber: null, numberAssignmentStartedAt: null, publishedFlowVersion: null, hasDraft: false, recordingEnabled: false, analysisEnabled: false, spamGateEnabled: false, whisperEnabled: false });
  });

  it("returns active number and latest published flow metadata", async () => {
    const cookie = await signIn("first@example.com");
    const created = await json(new Request("http://localhost:3000/api/workspaces", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Flow Metadata", reportingTimezone: "UTC" }) }));
    const id = (created.body.workspace as { id: string }).id;
    const startedAt = "2026-01-02T03:04:05.000Z";
    const publishedAt = "2026-01-03T04:05:06.000Z";
    await pool!.query(
      `insert into number_assignment
         (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at)
       values ('metadata-assignment-id', $1, $2, 'first-number-1', '+14155550101', $3, $3)`,
      [firstOrganizationId, id, startedAt],
    );
    await pool!.query(
      `insert into flow_version
         (id, organization_id, workspace_id, version, graph, published_at)
       values
         ('metadata-flow-v1', $1, $2, 1, '{"version":1,"nodes":[],"edges":[]}', $3),
         ('metadata-flow-v2', $1, $2, 2, '{"version":1,"nodes":[],"edges":[]}', $4)`,
      [firstOrganizationId, id, publishedAt, "2026-01-04T05:06:07.000Z"],
    );
    await pool!.query(
      `insert into call_flow_draft
         (id, organization_id, workspace_id, graph, created_at, updated_at)
       values ('metadata-draft-id', $1, $2, '{"version":1,"nodes":[],"edges":[]}', now(), now())`,
      [firstOrganizationId, id],
    );

    await expect(createWorkspaces(pool!, firstOrganizationId).find(id)).resolves.toMatchObject({
      trackingNumber: "+14155550101",
      numberAssignmentStartedAt: startedAt,
      publishedFlowVersion: { version: 2, publishedAt: "2026-01-04T05:06:07.000Z" },
      hasDraft: true,
    });
    await expect(createWorkspaces(pool!, firstOrganizationId).list({ search: "Flow Metadata" })).resolves.toMatchObject({
      workspaces: [expect.objectContaining({ id, hasDraft: true })],
    });
  });

  it("rejects duplicate names case-insensitively", async () => {
    const cookie = await signIn("first@example.com");
    const result = await json(new Request("http://localhost:3000/api/workspaces", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "PHOENIX", reportingTimezone: "UTC" }) }));
    expect(result.response.status).toBe(409);
    expect(result.body.error).toBe("name_taken");
  });

  it("lists with Organization-scoped search, state filters, pagination, and counts", async () => {
    const cookie = await signIn("first@example.com");
    for (const name of ["Alpha", "Beta", "Gamma"]) {
      await json(new Request("http://localhost:3000/api/workspaces", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name, reportingTimezone: "UTC" }) }));
    }
    const listed = await json(new Request("http://localhost:3000/api/workspaces?search=alp&state=Setup%20Required&page=1&pageSize=1", { headers: { cookie } }));
    expect(listed.response.status).toBe(200);
    expect((listed.body.workspaces as Array<{ name: string }>).map((value) => value.name)).toEqual(["Alpha"]);
    expect(listed.body.total).toBe(1);
    expect(listed.body.counts).toMatchObject({ setupRequired: 5, active: 0, archived: 0 });
  });

  it("lists each listed Workspace's 30-day Calls, Good Leads, last Call, and integration health", async () => {
    const cookie = await signIn("first@example.com");
    const listed = await json(new Request("http://localhost:3000/api/workspaces?search=Alpha", { headers: { cookie } }));
    const id = (listed.body.workspaces as Array<{ id: string }>)[0].id;
    expect(listed.body.stats).toEqual({
      [id]: { callsLast30Days: 0, goodLeadsLast30Days: 0, lastCallAt: null, lastSuccessfulInboundCallAt: null, integrationHealth: { status: "Not applicable", lastAcceptedVoiceWebhookAt: null } },
    });
  });

  it("updates, archives, restores, and reports active count without provider changes", async () => {
    const cookie = await signIn("first@example.com");
    const listed = await json(new Request("http://localhost:3000/api/workspaces?search=Alpha", { headers: { cookie } }));
    const id = (listed.body.workspaces as Array<{ id: string }>)[0].id;
    const updated = await json(new Request(`http://localhost:3000/api/workspaces/${id}`, { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Alpha Updated", reportingTimezone: "UTC" }) }));
    expect(updated.body.workspace).toMatchObject({ name: "Alpha Updated", reportingTimezone: "UTC" });
    const beforeConnection = await pool!.query("select * from twilio_connection where organization_id = $1", [firstOrganizationId]);
    const beforeNumbers = await pool!.query("select * from twilio_number where organization_id = $1 order by id", [firstOrganizationId]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const archived = await json(new Request(`http://localhost:3000/api/workspaces/${id}/archive`, { method: "POST", headers: { cookie } }));
    expect(archived.body.workspace).toMatchObject({ state: "Archived" });
    expect((archived.body.workspace as { archivedAt: string }).archivedAt).toEqual(expect.any(String));
    expect((await pool!.query("select * from twilio_connection where organization_id = $1", [firstOrganizationId])).rows).toEqual(beforeConnection.rows);
    expect((await pool!.query("select * from twilio_number where organization_id = $1 order by id", [firstOrganizationId])).rows).toEqual(beforeNumbers.rows);
    expect((await json(new Request(`http://localhost:3000/api/workspaces/${id}/archive`, { method: "POST", headers: { cookie } }))).response.status).toBe(409);
    const restored = await json(new Request(`http://localhost:3000/api/workspaces/${id}/restore`, { method: "POST", headers: { cookie } }));
    expect(restored.body.workspace).toMatchObject({ state: "Setup Required", archivedAt: null });
    expect((await pool!.query("select * from twilio_connection where organization_id = $1", [firstOrganizationId])).rows).toEqual(beforeConnection.rows);
    expect((await pool!.query("select * from twilio_number where organization_id = $1 order by id", [firstOrganizationId])).rows).toEqual(beforeNumbers.rows);
    expect((await json(new Request(`http://localhost:3000/api/workspaces/${id}/restore`, { method: "POST", headers: { cookie } }))).response.status).toBe(409);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    await expect(createWorkspaces(pool!, firstOrganizationId).countActive()).resolves.toBe(0);
  });

  it("does not expose another Organization Workspace", async () => {
    const firstCookie = await signIn("first@example.com");
    const created = await json(new Request("http://localhost:3000/api/workspaces", { method: "POST", headers: { cookie: firstCookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Private", reportingTimezone: "UTC" }) }));
    const id = (created.body.workspace as { id: string }).id;
    const secondCookie = await signIn("second@example.com");
    expect((await json(new Request("http://localhost:3000/api/workspaces", { headers: { cookie: secondCookie } }))).body.workspaces).toEqual([]);
    expect((await json(new Request(`http://localhost:3000/api/workspaces/${id}`, { headers: { cookie: secondCookie } }))).response.status).toBe(404);
    expect((await json(new Request(`http://localhost:3000/api/workspaces/${id}`, { method: "PATCH", headers: { cookie: secondCookie, "content-type": "application/json" }, body: JSON.stringify({ name: "Leaked" }) }))).response.status).toBe(404);
    expect((await json(new Request(`http://localhost:3000/api/workspaces/${id}/archive`, { method: "POST", headers: { cookie: secondCookie } }))).response.status).toBe(404);
    expect((await json(new Request(`http://localhost:3000/api/workspaces/${id}/restore`, { method: "POST", headers: { cookie: secondCookie } }))).response.status).toBe(404);
  });
});
