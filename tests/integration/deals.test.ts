/**
 * -------------------------------------------------------------------------
 * @file   deals.test.ts
 * @brief  Verifies Deals and the Site's Domain renewal through the Workspace routes.
 *
 * @description
 *  Exercises creating, editing, and ending a Workspace's Deal: valid
 *  kinds, positive amounts, calendar dates, at most one open Deal per
 *  Workspace with a new Deal ending the open one, history in start order,
 *  and the Site's registrar, annual renewal price, and renewal date. A
 *  Client Viewer gets 403 on every Deal and Domain route and never sees
 *  the Domain renewal on the Site read.
 *
 * @remarks
 *  The suite uses one PostgreSQL container and real Better Auth sessions
 *  like the Site Keywords suite.
 *
 * @see
 *  data/deals.ts
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
import { createIntegrations } from "@/data/integrations";
import { migrateDatabase } from "@/data/migrate";
import { schema } from "@/data/schema";
import { createTracerAuth } from "@/data/tracer-auth";
import type { TwilioClient } from "@/data/twilio-client";
import { createWorkspacesHandler } from "@/data/workspaces-handler";
import type { TransactionalEmailMessage } from "@/data/transactional-email";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let organizationId = "";
let operatorId = "";
const viewerId = "viewer-user-id";
const messages: TransactionalEmailMessage[] = [];
const backgroundTasks: Promise<unknown>[] = [];
const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const dealIds: Record<string, string> = {};

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
  allowedRecipients: new Set(["operator@example.com", "viewer@example.com"]),
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
    integrations: (orgId) => createIntegrations({ pool: pool!, organizationId: orgId, twilio: fakeTwilio, masterKey }),
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
  return { response, body: response.status === 204 ? {} : await response.json() as Record<string, unknown> };
}

function send(cookie: string, method: string, route: string, body?: unknown): Request {
  return new Request(`http://localhost:3000/api/workspaces/${route}`, { method, headers: { cookie, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
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

describe.sequential("Deals", () => {
  it("starts without a Deal and validates kind, amount, and start date", async () => {
    const cookie = await signIn("operator@example.com");
    const empty = await json(send(cookie, "GET", "workspace-a/deal"));
    expect(empty.response.status).toBe(200);
    expect(empty.body).toEqual({ deal: null, history: [] });
    for (const body of [
      { kind: "Yearly", amountCents: 50000, startedOn: "2026-10-01" },
      { kind: "Monthly", amountCents: 0, startedOn: "2026-10-01" },
      { kind: "Monthly", amountCents: 12.5, startedOn: "2026-10-01" },
      { kind: "Monthly", amountCents: "500", startedOn: "2026-10-01" },
      { kind: "Monthly", amountCents: 50000, startedOn: "2026-13-01" },
      { kind: "Monthly", amountCents: 50000, startedOn: "October 1" },
    ]) {
      expect((await json(send(cookie, "POST", "workspace-a/deal", body))).response.status, JSON.stringify(body)).toBe(400);
    }
    expect((await json(send(cookie, "POST", "missing-workspace/deal", { kind: "Monthly", amountCents: 50000, startedOn: "2026-10-01" }))).response.status).toBe(404);
  });

  it("creates a Deal, edits it, and keeps at most one open Deal per Workspace by ending the previous one", async () => {
    const cookie = await signIn("operator@example.com");
    const created = await json(send(cookie, "POST", "workspace-a/deal", { kind: "Weekly", amountCents: 12500, startedOn: "2026-09-01" }));
    expect(created.response.status).toBe(201);
    expect(created.body.deal).toEqual({ id: expect.any(String), workspaceId: "workspace-a", kind: "Weekly", amountCents: 12500, startedOn: "2026-09-01", endedOn: null, createdAt: expect.any(String), updatedAt: expect.any(String) });
    dealIds.weekly = (created.body.deal as { id: string }).id;

    const edited = await json(send(cookie, "PATCH", `workspace-a/deal/${dealIds.weekly}`, { amountCents: 15000 }));
    expect(edited.response.status).toBe(200);
    expect(edited.body.deal).toMatchObject({ id: dealIds.weekly, kind: "Weekly", amountCents: 15000, startedOn: "2026-09-01" });
    expect((await json(send(cookie, "PATCH", `workspace-a/deal/${dealIds.weekly}`, { kind: "Hourly" }))).response.status).toBe(400);
    expect((await json(send(cookie, "PATCH", "workspace-b/deal/" + dealIds.weekly, { amountCents: 1 }))).response.status).toBe(404);

    const replaced = await json(send(cookie, "POST", "workspace-a/deal", { kind: "Monthly", amountCents: 50000, startedOn: "2026-10-01" }));
    expect(replaced.response.status).toBe(201);
    dealIds.monthly = (replaced.body.deal as { id: string }).id;
    const listed = await json(send(cookie, "GET", "workspace-a/deal"));
    expect(listed.body.deal).toMatchObject({ id: dealIds.monthly, kind: "Monthly", amountCents: 50000, endedOn: null });
    expect((listed.body.history as Array<{ id: string; endedOn: string | null }>).map((deal) => [deal.id, deal.endedOn])).toEqual([
      [dealIds.monthly, null],
      [dealIds.weekly, "2026-10-01"],
    ]);
    await expect(
      pool!.query("insert into deal (id, organization_id, workspace_id, kind, amount_cents, started_on, created_at, updated_at) values ('second-open', $1, 'workspace-a', 'Monthly', 100, '2026-10-02', now(), now())", [organizationId]),
    ).rejects.toThrow(/deal_open_workspace_idx/);
  });

  it("ends a Deal on a date and refuses to edit or end it again", async () => {
    const cookie = await signIn("operator@example.com");
    expect((await json(send(cookie, "POST", `workspace-a/deal/${dealIds.monthly}/end`, { endedOn: "2026-09-30" }))).response.status).toBe(400);
    const ended = await json(send(cookie, "POST", `workspace-a/deal/${dealIds.monthly}/end`, { endedOn: "2026-10-31" }));
    expect(ended.response.status).toBe(200);
    expect(ended.body.deal).toMatchObject({ id: dealIds.monthly, endedOn: "2026-10-31" });
    expect((await json(send(cookie, "GET", "workspace-a/deal"))).body.deal).toBeNull();
    const again = await json(send(cookie, "POST", `workspace-a/deal/${dealIds.monthly}/end`, { endedOn: "2026-11-30" }));
    expect(again.response.status).toBe(409);
    expect(again.body).toEqual({ error: "deal_ended" });
    expect((await json(send(cookie, "PATCH", `workspace-a/deal/${dealIds.monthly}`, { amountCents: 1 }))).response.status).toBe(409);
    const reopened = await json(send(cookie, "POST", "workspace-a/deal", { kind: "Per Lead", amountCents: 2500, startedOn: "2026-11-01" }));
    expect(reopened.response.status).toBe(201);
    dealIds.perLead = (reopened.body.deal as { id: string }).id;
    expect((await json(send(cookie, "GET", "workspace-a/deal"))).body.history).toHaveLength(3);
  });

  it("saves the Site's Domain renewal and returns it only to Operators", async () => {
    const cookie = await signIn("operator@example.com");
    expect((await json(send(cookie, "PUT", "workspace-b/site/domain", { registrar: "Porkbun", renewalCents: 1299, renewsOn: "2027-03-14" }))).response.status).toBe(404);
    for (const body of [{ registrar: "Porkbun", renewalCents: -1, renewsOn: "2027-03-14" }, { registrar: 5, renewalCents: 1299, renewsOn: "2027-03-14" }, { registrar: "Porkbun", renewalCents: 1299, renewsOn: "soon" }]) {
      expect((await json(send(cookie, "PUT", "workspace-a/site/domain", body))).response.status, JSON.stringify(body)).toBe(400);
    }
    const saved = await json(send(cookie, "PUT", "workspace-a/site/domain", { registrar: " Porkbun ", renewalCents: 1299, renewsOn: "2027-03-14" }));
    expect(saved.response.status).toBe(200);
    expect(saved.body).toEqual({ domain: { registrar: "Porkbun", renewalCents: 1299, renewsOn: "2027-03-14" } });
    const site = await json(send(cookie, "GET", "workspace-a/site"));
    expect(site.body.site).toMatchObject({ domain: { registrar: "Porkbun", renewalCents: 1299, renewsOn: "2027-03-14" } });
    const cleared = await json(send(cookie, "PUT", "workspace-a/site/domain", { registrar: "", renewalCents: null, renewsOn: null }));
    expect(cleared.body).toEqual({ domain: { registrar: null, renewalCents: null, renewsOn: null } });
    await json(send(cookie, "PUT", "workspace-a/site/domain", { registrar: "Porkbun", renewalCents: 1299, renewsOn: "2027-03-14" }));
  });

  it("answers 403 to a Client Viewer on every Deal and Domain route and hides the Domain renewal from the Site read", async () => {
    const cookie = await signIn("viewer@example.com");
    expect((await json(send(cookie, "GET", "workspace-a/deal"))).response.status).toBe(403);
    expect((await json(send(cookie, "POST", "workspace-a/deal", { kind: "Monthly", amountCents: 1, startedOn: "2026-10-01" }))).response.status).toBe(403);
    expect((await json(send(cookie, "PATCH", `workspace-a/deal/${dealIds.perLead}`, { amountCents: 1 }))).response.status).toBe(403);
    expect((await json(send(cookie, "POST", `workspace-a/deal/${dealIds.perLead}/end`, { endedOn: "2026-12-31" }))).response.status).toBe(403);
    expect((await json(send(cookie, "PUT", "workspace-a/site/domain", { registrar: "x", renewalCents: 1, renewsOn: "2027-01-01" }))).response.status).toBe(403);
    const site = await json(send(cookie, "GET", "workspace-a/site"));
    expect(site.response.status).toBe(200);
    expect(JSON.stringify(site.body)).not.toContain("Porkbun");
    expect(site.body.site).not.toHaveProperty("domain");
  });
});
