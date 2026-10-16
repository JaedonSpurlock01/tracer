/**
 * -------------------------------------------------------------------------
 * @file   operator-administration.test.ts
 * @brief  Verifies Operator administration through the authenticated handler.
 *
 * @description
 *  Exercises Organization-scoped Operator and Client Viewer provisioning,
 *  Access Grants, access delivery, state protection, and session revocation
 *  through PostgreSQL.
 *
 * @remarks
 *  The suite uses one PostgreSQL container and real Better Auth sessions.
 *
 * @see
 *  data/operator-administration-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { migrateDatabase } from "@/data/migrate";
import { schema } from "@/data/schema";
import { createTracerAuth } from "@/data/tracer-auth";
import { createOperatorAdministrationHandler } from "@/data/operator-administration-handler";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let organizationId = "";
let operatorId = "";
let otherUserId = "";
let viewerId = "";
let secondId = "";
let thirdId = "";
let activeWorkspaceId = "";
let setupWorkspaceId = "";
let secondActiveWorkspaceId = "";
let archivedWorkspaceId = "";
let clientId = "";
const messages: { to: string; subject: string; text: string; html: string }[] = [];
const backgroundTasks: Promise<unknown>[] = [];

const database = () => drizzle(pool!, { schema });

const auth = () => createTracerAuth({
  database: database(),
  email: {
    async send(message) {
      messages.push(message);
      return { messageId: `email-${messages.length}` };
    },
  },
  emailFrom: "auth@example.com",
  allowedRecipients: new Set(["operator@example.com", "second@example.com", "viewer@example.com"]),
  backgroundTask: (promise) => backgroundTasks.push(promise),
  secret: "integration-only-secret",
  baseURL: "http://localhost:3000",
});

const handler = () => createOperatorAdministrationHandler({
  auth: auth(),
  database: database(),
  pool: pool!,
  email: {
    async send(message) {
      messages.push(message);
      return { messageId: `email-${messages.length}` };
    },
  },
  emailFrom: "auth@example.com",
  allowedRecipients: new Set(["operator@example.com", "second@example.com", "viewer@example.com", "client@example.com"]),
  signInUrl: "http://localhost:3000/sign-in",
});

async function signIn(email: string): Promise<string> {
  const currentMessages = messages.length;
  const currentTasks = backgroundTasks.length;
  const instance = auth();
  const send = await instance.handler(new Request("http://localhost:3000/api/auth/email-otp/send-verification-otp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, type: "sign-in" }),
  }));
  expect(send.status).toBe(200);
  await Promise.all(backgroundTasks.splice(currentTasks));
  const code = messages.slice(currentMessages).at(-1)?.text.match(/\d{6}/)?.[0];
  expect(code).toMatch(/^\d{6}$/);
  const verify = await instance.handler(new Request("http://localhost:3000/api/auth/sign-in/email-otp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, otp: code }),
  }));
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
  const bootstrapped = await bootstrapInitialOperator(pool, {
    email: "operator@example.com",
    name: "Example Operator",
    timezone: "America/Chicago",
  });
  organizationId = bootstrapped.organizationId;
  operatorId = bootstrapped.userId;
  otherUserId = "other-user-id";
  viewerId = "viewer-user-id";
  await pool.query(
    `insert into organization (id, name, slug, created_at) values ($1, 'Other Org', 'other-org', now())`,
    ["other-organization-id"],
  );
  await pool.query(
    `insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at)
     values ($1, 'Other Operator', 'other@example.com', false, 'Provisioned', 'UTC', now(), now()),
            ($2, 'Client Viewer', 'viewer@example.com', false, 'Active', 'UTC', now(), now())`,
    [otherUserId, viewerId],
  );
  await pool.query(
    `insert into member (id, organization_id, user_id, role, created_at)
     values ('other-membership-id', 'other-organization-id', $1, 'owner', now()),
            ('viewer-membership-id', $2, $3, 'member', now())`,
    [otherUserId, organizationId, viewerId],
  );
  activeWorkspaceId = "active-workspace-id";
  setupWorkspaceId = "setup-workspace-id";
  secondActiveWorkspaceId = "second-active-workspace-id";
  archivedWorkspaceId = "archived-workspace-id";
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, created_at, updated_at)
     values ($1, $5, 'Acme Plumbing', 'UTC', 'Active', now(), now()),
            ($2, $5, 'Beta Roofing', 'UTC', 'Setup Required', now(), now()),
            ($3, $5, 'Gamma HVAC', 'UTC', 'Active', now(), now()),
            ($4, $5, 'Delta Electric', 'UTC', 'Archived', now(), now())`,
    [activeWorkspaceId, setupWorkspaceId, secondActiveWorkspaceId, archivedWorkspaceId, organizationId],
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe.sequential("Operator administration", () => {
  it("requires an Active Operator for Organization user routes", async () => {
    const unauthenticated = await json(new Request("http://localhost:3000/api/users"));
    expect(unauthenticated.response.status).toBe(401);

    const viewerCookie = await signIn("viewer@example.com");
    const viewer = await json(new Request("http://localhost:3000/api/users", { headers: { cookie: viewerCookie } }));
    expect(viewer.response.status).toBe(403);
  });

  it("lists Organization users for an Active Operator", async () => {
    const cookie = await signIn("operator@example.com");
    const result = await json(new Request("http://localhost:3000/api/users", { headers: { cookie } }));
    expect(result.response.status).toBe(200);
    expect(result.body.users).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: "operator@example.com", role: "Operator", state: "Active" }),
      expect.objectContaining({ email: "viewer@example.com", role: "Client Viewer", state: "Active" }),
    ]));
    expect(result.body.users).not.toEqual(expect.arrayContaining([expect.objectContaining({ email: "other@example.com" })]));
  });

  it("provisions Operators and delivers access notices", async () => {
    const cookie = await signIn("operator@example.com");
    const unavailable = await json(new Request("http://localhost:3000/api/users", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ email: "admin2@example.com", role: "Administrator" }),
    }));
    expect(unavailable.response.status).toBe(400);
    expect(unavailable.body).toEqual({ error: "role_unavailable" });

    const provisioned = await json(new Request("http://localhost:3000/api/users", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ email: "second@example.com", role: "Operator", name: "Second Operator" }),
    }));
    expect(provisioned.response.status).toBe(201);
    expect(provisioned.body.delivery).toBe("sent");
    expect(provisioned.body.user).toMatchObject({ email: "second@example.com", state: "Provisioned", provisionedBy: { id: operatorId } });
    secondId = (provisioned.body.user as { id: string }).id;
    const accessMessage = messages.at(-1)!;
    expect(accessMessage.subject).toBe("Your Tracer access is ready");
    expect(accessMessage.text).toContain("http://localhost:3000/sign-in");
    expect(`${accessMessage.text} ${accessMessage.html}`).not.toMatch(/\d{6}/);

    const duplicate = await json(new Request("http://localhost:3000/api/users", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ email: " SECOND@example.com ", role: "Operator" }),
    }));
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.body).toEqual({ error: "duplicate_email" });

    const skipped = await json(new Request("http://localhost:3000/api/users", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ email: "third@example.com", role: "Operator", sendEmail: false }),
    }));
    expect(skipped.response.status).toBe(201);
    expect(skipped.body.delivery).toBe("skipped");
    thirdId = (skipped.body.user as { id: string }).id;
  });

  it("refuses Client Viewer provisioning without an Access Grant to an Active Workspace", async () => {
    const cookie = await signIn("operator@example.com");
    const missing = await json(new Request("http://localhost:3000/api/users", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ email: "client@example.com", role: "Client Viewer" }),
    }));
    expect(missing.response.status).toBe(400);
    expect(missing.body).toEqual({ error: "access_grant_required" });

    const setupRequired = await json(new Request("http://localhost:3000/api/users", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ email: "client@example.com", role: "Client Viewer", workspaceIds: [activeWorkspaceId, setupWorkspaceId] }),
    }));
    expect(setupRequired.response.status).toBe(409);
    expect(setupRequired.body).toEqual({ error: "workspace_not_grantable" });
    await expect(pool!.query(`select count(*) from "user" where email = 'client@example.com'`)).resolves.toMatchObject({ rows: [{ count: "0" }] });
    await expect(pool!.query("select count(*) from access_grant")).resolves.toMatchObject({ rows: [{ count: "0" }] });
  });

  it("provisions a Client Viewer and the initial Access Grant together", async () => {
    const cookie = await signIn("operator@example.com");
    const provisioned = await json(new Request("http://localhost:3000/api/users", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ email: "client@example.com", role: "Client Viewer", workspaceIds: [activeWorkspaceId, activeWorkspaceId] }),
    }));
    expect(provisioned.response.status).toBe(201);
    expect(provisioned.body.delivery).toBe("sent");
    expect(provisioned.body.user).toMatchObject({
      email: "client@example.com",
      role: "Client Viewer",
      state: "Provisioned",
      accessGrants: [{ workspaceId: activeWorkspaceId, workspaceName: "Acme Plumbing" }],
    });
    clientId = (provisioned.body.user as { id: string }).id;
    const accessMessage = messages.at(-1)!;
    expect(accessMessage.to).toBe("client@example.com");
    expect(accessMessage.text).toContain("Acme Plumbing");
    expect(accessMessage.text).toContain("http://localhost:3000/sign-in");
    expect(`${accessMessage.text} ${accessMessage.html}`).not.toMatch(/\d{6}/);
  });

  it("adds Access Grants idempotently and only for Client Viewers on Active Workspaces", async () => {
    const cookie = await signIn("operator@example.com");
    const grant = (userId: string, workspaceId: string) => json(new Request(`http://localhost:3000/api/users/${userId}/access-grants`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    }));

    const added = await grant(clientId, secondActiveWorkspaceId);
    expect(added.response.status).toBe(200);
    expect((added.body.user as { accessGrants: unknown[] }).accessGrants).toEqual([
      { workspaceId: activeWorkspaceId, workspaceName: "Acme Plumbing" },
      { workspaceId: secondActiveWorkspaceId, workspaceName: "Gamma HVAC" },
    ]);

    const duplicate = await grant(clientId, secondActiveWorkspaceId);
    expect(duplicate.response.status).toBe(200);
    await expect(pool!.query("select count(*) from access_grant where user_id = $1", [clientId])).resolves.toMatchObject({ rows: [{ count: "2" }] });

    const archived = await grant(clientId, archivedWorkspaceId);
    expect(archived.response.status).toBe(409);
    expect(archived.body).toEqual({ error: "workspace_not_grantable" });

    const setupRequired = await grant(clientId, setupWorkspaceId);
    expect(setupRequired.response.status).toBe(409);
    expect(setupRequired.body).toEqual({ error: "workspace_not_grantable" });

    const operator = await grant(secondId, activeWorkspaceId);
    expect(operator.response.status).toBe(409);
    expect(operator.body).toEqual({ error: "not_client_viewer" });

    const outsideOrganization = await grant(otherUserId, activeWorkspaceId);
    expect(outsideOrganization.response.status).toBe(404);
  });

  it("removes Access Grants but never a Client Viewer's last grant", async () => {
    const cookie = await signIn("operator@example.com");
    const revoke = (userId: string, workspaceId: string) => json(new Request(`http://localhost:3000/api/users/${userId}/access-grants/${workspaceId}`, {
      method: "DELETE",
      headers: { cookie },
    }));

    const removed = await revoke(clientId, secondActiveWorkspaceId);
    expect(removed.response.status).toBe(200);
    expect((removed.body.user as { accessGrants: unknown[] }).accessGrants).toEqual([
      { workspaceId: activeWorkspaceId, workspaceName: "Acme Plumbing" },
    ]);

    const missing = await revoke(clientId, secondActiveWorkspaceId);
    expect(missing.response.status).toBe(404);

    const last = await revoke(clientId, activeWorkspaceId);
    expect(last.response.status).toBe(409);
    expect(last.body).toEqual({ error: "last_access_grant" });
    await expect(pool!.query("select count(*) from access_grant where user_id = $1", [clientId])).resolves.toMatchObject({ rows: [{ count: "1" }] });
  });

  it("demotes an Operator to Client Viewer only with an Access Grant", async () => {
    const cookie = await signIn("operator@example.com");
    const changeRole = (body: Record<string, unknown>) => json(new Request(`http://localhost:3000/api/users/${thirdId}/role`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    }));

    const missing = await changeRole({ role: "Client Viewer" });
    expect(missing.response.status).toBe(400);
    expect(missing.body).toEqual({ error: "access_grant_required" });

    const setupRequired = await changeRole({ role: "Client Viewer", workspaceIds: [setupWorkspaceId] });
    expect(setupRequired.response.status).toBe(409);
    expect(setupRequired.body).toEqual({ error: "workspace_not_grantable" });
    await expect(pool!.query("select role from member where user_id = $1", [thirdId])).resolves.toMatchObject({ rows: [{ role: "owner" }] });

    const demoted = await changeRole({ role: "Client Viewer", workspaceIds: [secondActiveWorkspaceId] });
    expect(demoted.response.status).toBe(200);
    expect(demoted.body.user).toMatchObject({
      role: "Client Viewer",
      accessGrants: [{ workspaceId: secondActiveWorkspaceId, workspaceName: "Gamma HVAC" }],
    });
  });

  it("promotes a Client Viewer while preserving Access Grants for later demotion", async () => {
    const cookie = await signIn("operator@example.com");
    const changeRole = (role: string) => json(new Request(`http://localhost:3000/api/users/${thirdId}/role`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ role }),
    }));

    const promoted = await changeRole("Operator");
    expect(promoted.response.status).toBe(200);
    expect(promoted.body.user).toMatchObject({ role: "Operator", accessGrants: [{ workspaceId: secondActiveWorkspaceId }] });

    const unchanged = await changeRole("Operator");
    expect(unchanged.response.status).toBe(409);
    expect(unchanged.body).toEqual({ error: "state_unchanged" });

    const demotedAgain = await changeRole("Client Viewer");
    expect(demotedAgain.response.status).toBe(200);
    expect(demotedAgain.body.user).toMatchObject({ role: "Client Viewer" });
  });

  it("refuses demoting the last Active Operator without granting anything", async () => {
    const cookie = await signIn("operator@example.com");
    const result = await json(new Request(`http://localhost:3000/api/users/${operatorId}/role`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ role: "Client Viewer", workspaceIds: [activeWorkspaceId] }),
    }));
    expect(result.response.status).toBe(409);
    expect(result.body).toEqual({ error: "last_active_operator" });
    await expect(pool!.query("select count(*) from access_grant where user_id = $1", [operatorId])).resolves.toMatchObject({ rows: [{ count: "0" }] });
    await expect(pool!.query("select role from member where user_id = $1", [operatorId])).resolves.toMatchObject({ rows: [{ role: "owner" }] });
  });

  it("protects the last Active Operator from disablement", async () => {
    const cookie = await signIn("operator@example.com");
    const result = await json(new Request(`http://localhost:3000/api/users/${operatorId}/state`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ state: "Disabled" }),
    }));
    expect(result.response.status).toBe(409);
    expect(result.body).toEqual({ error: "last_active_operator" });
    await expect(pool!.query('select state from "user" where id = $1', [operatorId])).resolves.toMatchObject({ rows: [{ state: "Active" }] });
  });

  it("does not mutate a user outside the Operator Organization", async () => {
    const cookie = await signIn("operator@example.com");
    const result = await json(new Request(`http://localhost:3000/api/users/${otherUserId}/state`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ state: "Disabled" }),
    }));
    expect(result.response.status).toBe(404);
  });

  it("resends access only for Provisioned Operators", async () => {
    const cookie = await signIn("operator@example.com");
    const resent = await json(new Request(`http://localhost:3000/api/users/${secondId}/resend-access`, {
      method: "POST",
      headers: { cookie },
    }));
    expect(resent.response.status).toBe(200);
    expect(resent.body).toEqual({ delivery: "sent" });

    const active = await json(new Request(`http://localhost:3000/api/users/${operatorId}/resend-access`, {
      method: "POST",
      headers: { cookie },
    }));
    expect(active.response.status).toBe(409);
    expect(active.body).toEqual({ error: "state_unchanged" });
  });

  it("activates a newly signed-in Operator and grants Organization capabilities", async () => {
    const cookie = await signIn("second@example.com");
    await expect(pool!.query('select state, last_sign_in_at from "user" where id = $1', [secondId])).resolves.toMatchObject({ rows: [{ state: "Active", last_sign_in_at: expect.anything() }] });
    const result = await json(new Request("http://localhost:3000/api/users", { headers: { cookie } }));
    expect(result.response.status).toBe(200);
  });

  it("revokes disabled Operator sessions and preserves unverified re-enable state", async () => {
    const operatorCookie = await signIn("operator@example.com");
    const secondCookie = await signIn("second@example.com");
    const disabled = await json(new Request(`http://localhost:3000/api/users/${secondId}/state`, {
      method: "POST",
      headers: { cookie: operatorCookie, "content-type": "application/json" },
      body: JSON.stringify({ state: "Disabled" }),
    }));
    expect(disabled.response.status).toBe(200);
    await expect(pool!.query("select count(*) from session where user_id = $1", [secondId])).resolves.toMatchObject({ rows: [{ count: "0" }] });
    const revoked = await json(new Request("http://localhost:3000/api/users", { headers: { cookie: secondCookie } }));
    expect(revoked.response.status).toBe(401);

    const reenabled = await json(new Request(`http://localhost:3000/api/users/${secondId}/state`, {
      method: "POST",
      headers: { cookie: operatorCookie, "content-type": "application/json" },
      body: JSON.stringify({ state: "Active" }),
    }));
    expect(reenabled.response.status).toBe(200);
    expect((reenabled.body.user as { state: string }).state).toBe("Active");

    const disabledProvisioned = await json(new Request(`http://localhost:3000/api/users/${thirdId}/state`, {
      method: "POST",
      headers: { cookie: operatorCookie, "content-type": "application/json" },
      body: JSON.stringify({ state: "Disabled" }),
    }));
    expect(disabledProvisioned.response.status).toBe(200);
    const reenabledProvisioned = await json(new Request(`http://localhost:3000/api/users/${thirdId}/state`, {
      method: "POST",
      headers: { cookie: operatorCookie, "content-type": "application/json" },
      body: JSON.stringify({ state: "Active" }),
    }));
    expect(reenabledProvisioned.response.status).toBe(200);
    expect((reenabledProvisioned.body.user as { state: string }).state).toBe("Provisioned");
  });
});
