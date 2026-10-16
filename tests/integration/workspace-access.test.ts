/**
 * -------------------------------------------------------------------------
 * @file   workspace-access.test.ts
 * @brief  Verifies Client Viewer Workspace access through Access Grants.
 *
 * @description
 *  Signs in a real Client Viewer and exercises the Workspaces server
 *  interface to prove granted reads, ungranted denials, Operator-only
 *  mutations, Workspace State rules, and immediate revocation.
 *
 * @remarks
 *  Revocation is checked with a session created before the grant is removed,
 *  because Access Grant checks must not wait for a new sign-in.
 *
 * @see
 *  data/workspace-authorization.ts
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
import { createOperatorAdministrationHandler } from "@/data/operator-administration-handler";
import { schema } from "@/data/schema";
import { createTracerAuth } from "@/data/tracer-auth";
import { type TwilioClient } from "@/data/twilio-client";
import { createWorkspacesHandler } from "@/data/workspaces-handler";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let organizationId = "";
const messages: { to: string; subject: string; text: string; html: string }[] = [];
const backgroundTasks: Promise<unknown>[] = [];
const recipients = new Set(["operator@example.com", "client@example.com"]);
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

async function workspaces(path: string, cookie: string, init: RequestInit = {}) {
  const response = await workspacesHandler()(new Request(`http://localhost:3000/api/workspaces${path}`, { ...init, headers: { cookie, "content-type": "application/json" } }));
  return { response, body: await response.json() as Record<string, unknown> };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrateDatabase(container.getConnectionUri());
  organizationId = (await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "Example Operator", timezone: "UTC" })).organizationId;
  await pool.query(`insert into organization (id, name, slug, created_at) values ('other-organization-id', 'Other', 'other', now())`);
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, created_at, updated_at)
     values ('granted-active', $1, 'Acme Plumbing', 'UTC', 'Active', now(), now()),
            ('granted-archived', $1, 'Delta Electric', 'UTC', 'Active', now(), now()),
            ('granted-restored', $1, 'Echo Dental', 'UTC', 'Active', now(), now()),
            ('ungranted-active', $1, 'Gamma HVAC', 'UTC', 'Active', now(), now()),
            ('other-organization-workspace', 'other-organization-id', 'Other Org Workspace', 'UTC', 'Active', now(), now())`,
    [organizationId],
  );
  const operatorCookie = await signIn("operator@example.com");
  const provisioned = await usersHandler()(new Request("http://localhost:3000/api/users", {
    method: "POST",
    headers: { cookie: operatorCookie, "content-type": "application/json" },
    body: JSON.stringify({ email: "client@example.com", role: "Client Viewer", workspaceIds: ["granted-active", "granted-archived", "granted-restored"], sendEmail: false }),
  }));
  expect(provisioned.status).toBe(201);
  const clientId = ((await provisioned.json()) as { user: { id: string } }).user.id;
  await pool.query(
    `insert into access_grant (id, organization_id, workspace_id, user_id, created_at)
     values ('cross-organization-grant', 'other-organization-id', 'other-organization-workspace', $1, now())`,
    [clientId],
  );
  await pool.query(`update workspace set state = 'Archived', archived_at = now() where id = 'granted-archived'`);
  await pool.query(`update workspace set state = 'Setup Required' where id = 'granted-restored'`);
}, 120_000);

afterAll(async () => { await pool?.end(); await container?.stop(); });

describe.sequential("Workspace access", () => {
  let clientCookie = "";

  it("lists only directly granted Active and Archived Workspaces in the Client Viewer Organization", async () => {
    clientCookie = await signIn("client@example.com");
    const list = await workspaces("", clientCookie);
    expect(list.response.status).toBe(200);
    expect((list.body.workspaces as { id: string }[]).map((workspace) => workspace.id)).toEqual(["granted-active", "granted-archived"]);
    expect(list.body).toMatchObject({ total: 2, counts: { setupRequired: 0, active: 1, archived: 1 } });
    expect((list.body.workspaces as { createdBy: unknown }[]).every((workspace) => workspace.createdBy === null)).toBe(true);
  });

  it("reads a granted Workspace and denies ungranted, dormant, and cross-Organization Workspaces", async () => {
    expect((await workspaces("/granted-active", clientCookie)).response.status).toBe(200);
    expect((await workspaces("/granted-archived", clientCookie)).response.status).toBe(200);
    expect((await workspaces("/ungranted-active", clientCookie)).response.status).toBe(404);
    expect((await workspaces("/granted-restored", clientCookie)).response.status).toBe(404);
    expect((await workspaces("/other-organization-workspace", clientCookie)).response.status).toBe(404);
  });

  it("keeps every Workspace mutation and Operator-only read behind Operator authorization", async () => {
    expect((await workspaces("/granted-active", clientCookie, { method: "PATCH", body: JSON.stringify({ name: "Renamed" }) })).response.status).toBe(403);
    expect((await workspaces("/granted-active/flow", clientCookie)).response.status).toBe(403);
    expect((await workspaces("/granted-active/archive", clientCookie, { method: "POST", body: "{}" })).response.status).toBe(403);
    expect((await workspaces("/numbers", clientCookie)).response.status).toBe(403);
    expect((await workspaces("", clientCookie, { method: "POST", body: JSON.stringify({ name: "New", reportingTimezone: "UTC" }) })).response.status).toBe(403);
  });

  it("blocks the next read from an existing session after an Access Grant is removed", async () => {
    const operatorCookie = await signIn("operator@example.com");
    const clientId = (await pool!.query<{ id: string }>(`select id from "user" where email = 'client@example.com'`)).rows[0].id;
    const removed = await usersHandler()(new Request(`http://localhost:3000/api/users/${clientId}/access-grants/granted-archived`, {
      method: "DELETE",
      headers: { cookie: operatorCookie },
    }));
    expect(removed.status).toBe(200);
    expect((await workspaces("/granted-archived", clientCookie)).response.status).toBe(404);
    const list = await workspaces("", clientCookie);
    expect((list.body.workspaces as { id: string }[]).map((workspace) => workspace.id)).toEqual(["granted-active"]);
  });
});
