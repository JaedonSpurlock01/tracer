/**
 * -------------------------------------------------------------------------
 * @file   site-preview.test.ts
 * @brief  Verifies the Site preview routes and the local full sync route.
 *
 * @description
 *  Exercises `GET /api/workspaces/{id}/site/preview`, which rechecks the
 *  Workspace authorization on every request and streams the newest
 *  preview from the bucket, `POST /api/workspaces/{id}/site/preview/refresh`,
 *  which lets an Operator force a capture past the hourly rule, and the
 *  Integrations sync route that runs the full Site sync when a local
 *  runner is configured for the E2E fake.
 *
 * @remarks
 *  The Cloudflare client is a fake that counts screenshots and can be
 *  made unavailable, and the bucket is an in-memory map that satisfies the
 *  same interface as the R2 binding.
 *
 * @see
 *  data/site-preview.ts
 *  data/workspaces-handler.ts
 *  data/integrations-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { CloudflareClientError, type CloudflareClient } from "@/data/cloudflare-client";
import { upsertDiscoveredSites } from "@/data/cloudflare-connection";
import { encryptSecret } from "@/data/credential-encryption";
import { createE2eCloudflareFake } from "@/data/e2e-cloudflare-fake";
import { createIntegrations } from "@/data/integrations";
import { createIntegrationsHandler } from "@/data/integrations-handler";
import { migrateDatabase } from "@/data/migrate";
import { masterKeyFingerprint } from "@/data/provider-credential";
import { schema } from "@/data/schema";
import { sitePreviewObjectsFromBinding, type SitePreviewBinding } from "@/data/site-preview";
import { syncSites } from "@/data/site-sync";
import { createTracerAuth } from "@/data/tracer-auth";
import type { TwilioClient } from "@/data/twilio-client";
import { createWorkspacesHandler } from "@/data/workspaces-handler";
import type { TransactionalEmailMessage } from "@/data/transactional-email";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let organizationId = "";
const viewerId = "viewer-user-id";
const messages: TransactionalEmailMessage[] = [];
const backgroundTasks: Promise<unknown>[] = [];
const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const accountId = "0123456789abcdef0123456789abcdef";
let pavingSiteId = "";
let screenshots = 0;
let unavailable = false;

const fakeTwilio: TwilioClient = {
  async fetchAccount() { throw new Error("not implemented"); },
  async listIncomingPhoneNumbers() { throw new Error("not implemented"); },
  async fetchIncomingPhoneNumber() { throw new Error("not implemented"); },
  async updateIncomingPhoneNumberVoice() { throw new Error("not implemented"); },
};

const e2eFake = createE2eCloudflareFake();
const cloudflare: CloudflareClient = {
  ...e2eFake,
  async captureScreenshot(_credential, url) {
    if (unavailable) throw new CloudflareClientError("provider_unavailable", 503);
    screenshots += 1;
    return new TextEncoder().encode(`jpeg:${url}:${screenshots}`);
  },
};

const storedObjects = new Map<string, Uint8Array>();
const binding: SitePreviewBinding = {
  async put(key, value, options) {
    expect(options?.httpMetadata?.contentType).toBe("image/jpeg");
    storedObjects.set(key, new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  },
  async get(key) {
    const bytes = storedObjects.get(key);
    return bytes ? { body: new Blob([bytes.slice()]).stream() } : null;
  },
  async delete(key) {
    storedObjects.delete(key);
  },
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

function workspacesHandler(options: { withBucket?: boolean } = {}) {
  return createWorkspacesHandler({
    auth: auth(),
    database: database(),
    pool: pool!,
    twilio: fakeTwilio,
    integrations: (orgId) => createIntegrations({ pool: pool!, organizationId: orgId, twilio: fakeTwilio, masterKey }),
    baseURL: "http://localhost:3000",
    masterKey,
    cloudflare,
    ...(options.withBucket === false ? {} : { sitePreviews: sitePreviewObjectsFromBinding(binding) }),
  });
}

const fullSyncRuns: string[] = [];

function integrationsHandler(options: { local?: boolean } = {}) {
  return createIntegrationsHandler({
    auth: auth(),
    database: database(),
    pool: pool!,
    twilio: fakeTwilio,
    cloudflare,
    masterKey,
    configuration: { twilioMasterKey: true, hyperdrive: true, email: true, emailFrom: "auth@example.com", emailAllowlistCount: 1, r2: false, r2Bucket: null, openai: false, triggerdev: false },
    email: { async send(message) { messages.push(message); return { messageId: `email-${messages.length}` }; } },
    emailFrom: "auth@example.com",
    allowedRecipients: new Set(["operator@example.com"]),
    ...(options.local
      ? {
          syncSitesLocally: async (orgId: string) => {
            fullSyncRuns.push(orgId);
            return syncSites({ pool: pool!, cloudflare, objects: sitePreviewObjectsFromBinding(binding), masterKey, fetch: async () => new Response("", { status: 200 }), now: new Date(), organizationId: orgId });
          },
        }
      : {}),
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

function get(cookie: string | null, route: string): Request {
  return new Request(`http://localhost:3000/api/workspaces/${route}`, { headers: cookie ? { cookie } : {} });
}

function post(cookie: string, route: string): Request {
  return new Request(`http://localhost:3000/api/workspaces/${route}`, { method: "POST", headers: { cookie, "content-type": "application/json" } });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrateDatabase(container.getConnectionUri());
  const bootstrapped = await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "Example Operator", timezone: "America/Chicago" });
  organizationId = bootstrapped.organizationId;
  await pool.query(
    `insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at)
     values ($1, 'Client Viewer', 'viewer@example.com', false, 'Active', 'UTC', now(), now())`,
    [viewerId],
  );
  await pool.query("insert into member (id, organization_id, user_id, role, created_at) values ('viewer-membership-id', $1, $2, 'member', now())", [organizationId, viewerId]);
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, created_at, updated_at) values
       ('workspace-a', $1, 'Pocatello Paving', 'UTC', 'Active', now(), now()),
       ('workspace-b', $1, 'St George Paving', 'America/Denver', 'Active', now(), now()),
       ('workspace-c', $1, 'Blackfoot Paving', 'America/Boise', 'Setup Required', now(), now())`,
    [organizationId],
  );
  await pool.query("insert into access_grant (id, organization_id, workspace_id, user_id, created_at) values ('grant-a', $1, 'workspace-a', $2, now())", [organizationId, viewerId]);
  await pool.query(
    `insert into cloudflare_connection (id, organization_id, account_id, api_token_ciphertext, connected_by_user_id, connected_at, last_verified_at, created_at, updated_at)
     values ('connection-id', $1, $2, $3, $4, now(), now(), now(), now())`,
    [organizationId, accountId, await encryptSecret(masterKey, "synthetic-token"), bootstrapped.userId],
  );
  await pool.query("update cloudflare_connection set master_key_fingerprint = $1 where master_key_fingerprint is null", [await masterKeyFingerprint(masterKey)]);
  const discovered = await e2eFake.listSites({ accountId, apiToken: "synthetic-token" });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await upsertDiscoveredSites(client, organizationId, discovered, new Date("2026-10-19T12:00:00.000Z"));
    await client.query("commit");
  } finally {
    client.release();
  }
  pavingSiteId = (await pool.query<{ id: string }>("select id from site where script_name = 'asphalt-paving-pocatello'")).rows[0].id;
  await pool.query("update site set live_version_id = 'e2e-asphalt-paving-pocatello-version-1' where id = $1", [pavingSiteId]);
  await pool.query(
    "insert into site_link (id, organization_id, site_id, workspace_id, started_at, started_by_user_id) values ('link-a', $1, $2, 'workspace-a', now(), $3)",
    [organizationId, pavingSiteId, bootstrapped.userId],
  );
  await pool.query(
    "insert into site_link (id, organization_id, site_id, workspace_id, started_at, started_by_user_id) values ('link-b', $1, (select id from site where script_name = 'asphalt-paving-st-george'), 'workspace-b', now(), $2)",
    [organizationId, bootstrapped.userId],
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe.sequential("Site preview routes", () => {
  it("answers 404 without a Site Link or without a captured preview", async () => {
    const cookie = await signIn("operator@example.com");
    const unlinked = await workspacesHandler()(get(cookie, "workspace-c/site/preview"));
    expect(unlinked.status).toBe(404);
    const pending = await workspacesHandler()(get(cookie, "workspace-a/site/preview"));
    expect(pending.status).toBe(404);
    expect(await pending.json()).toEqual({ error: "not_found" });
  });

  it("lets an Operator force a capture past the hourly rule and streams the newest preview to every reader", async () => {
    const cookie = await signIn("operator@example.com");
    const first = await workspacesHandler()(post(cookie, "workspace-a/site/preview/refresh"));
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { site: { latestPreview: { versionId: string | null; capturedAt: string } | null; health: string } };
    expect(firstBody.site.latestPreview).toEqual({ versionId: "e2e-asphalt-paving-pocatello-version-1", capturedAt: expect.any(String) });
    expect(firstBody.site).not.toHaveProperty("latestPreview.objectKey");
    const second = await workspacesHandler()(post(cookie, "workspace-a/site/preview/refresh"));
    expect(second.status).toBe(200);
    expect(screenshots).toBe(2);
    expect((await pool!.query("select count(*)::int as count from site_preview where site_id = $1", [pavingSiteId])).rows[0].count).toBe(2);

    const served = await workspacesHandler()(get(cookie, "workspace-a/site/preview"));
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(served.headers.get("cache-control")).toBe("private, no-store");
    expect(new TextDecoder().decode(await served.arrayBuffer())).toBe("jpeg:https://pocatelloasphaltpaving.com/:2");

    const viewer = await signIn("viewer@example.com");
    const granted = await workspacesHandler()(get(viewer, "workspace-a/site/preview"));
    expect(granted.status).toBe(200);
    expect(granted.headers.get("content-type")).toBe("image/jpeg");
    expect((await workspacesHandler()(get(viewer, "workspace-b/site/preview"))).status).toBe(404);
    expect((await workspacesHandler()(get(null, "workspace-a/site/preview"))).status).toBe(401);
    expect((await workspacesHandler()(post(viewer, "workspace-a/site/preview/refresh"))).status).toBe(403);
  });

  it("answers 404 for a refresh without a Site Link and 502 when Cloudflare is unavailable", async () => {
    const cookie = await signIn("operator@example.com");
    expect((await workspacesHandler()(post(cookie, "workspace-c/site/preview/refresh"))).status).toBe(404);
    unavailable = true;
    const failed = await workspacesHandler()(post(cookie, "workspace-a/site/preview/refresh"));
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "provider_unavailable", detail: "Cloudflare request failed (HTTP 503)" });
    unavailable = false;
    expect((await pool!.query("select last_failure_detail from cloudflare_connection where organization_id = $1", [organizationId])).rows[0].last_failure_detail).toBe("Cloudflare request failed (HTTP 503)");
    const withoutBucket = await workspacesHandler({ withBucket: false })(post(cookie, "workspace-a/site/preview/refresh"));
    expect(withoutBucket.status).toBe(503);
  });

  it("runs the full Site sync from the Integrations sync route only when a local runner is configured", async () => {
    const cookie = await signIn("operator@example.com");
    const request = () => new Request("http://localhost:3000/api/integrations/cloudflare/sync", { method: "POST", headers: { cookie } });
    const discoveryOnly = await integrationsHandler()(request());
    expect(discoveryOnly.status).toBe(200);
    expect(await discoveryOnly.json()).toEqual({ siteCount: 6, syncedAt: expect.any(String) });
    expect(fullSyncRuns).toEqual([]);
    expect((await pool!.query("select count(*)::int as count from site_check")).rows[0].count).toBe(0);

    const full = await integrationsHandler({ local: true })(request());
    expect(full.status).toBe(200);
    expect(await full.json()).toEqual({ siteCount: 6, syncedAt: expect.any(String), sync: { sites: 6, synced: 6, failed: 0 } });
    expect(fullSyncRuns).toEqual([organizationId]);
    expect((await pool!.query("select count(*)::int as count from site_check")).rows[0].count).toBe(6);
    expect((await pool!.query("select count(distinct site_id)::int as count from site_metric_day")).rows[0].count).toBe(6);
  });
});
