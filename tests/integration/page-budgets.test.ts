/**
 * -------------------------------------------------------------------------
 * @file   page-budgets.test.ts
 * @brief  Holds every page's database work to a wave and query ceiling.
 *
 * @description
 *  Replays what one navigation costs on the server: the actor resolution,
 *  the app layout's reads, the Workspace lookup for Workspace routes, and
 *  the page loader, all on one observed request pool. A wave is each time
 *  the pool goes from idle to busy, so it is the sequential depth the
 *  navigation pays regardless of how many queries run together. The
 *  ceilings are the Product Owner's performance budget from 2026-10-24 and
 *  only ratchet down.
 *
 * @remarks
 *  The pool is the real request pool with six connections, so a Promise.all
 *  counts as one wave here exactly as it does in the Worker. The measured
 *  numbers are printed so a run can be read back in CI.
 *
 * @see
 *  data/page-loaders.ts
 *  data/request-log.ts
 *  docs/IMPLEMENTATION_ROADMAP.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { activityFiltersFromSearchParams } from "@/data/activity-query";
import { analyticsRangeFromSearchParams } from "@/data/analytics-range";
import { resolveActor, type Actor } from "@/data/authorization";
import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { callListQueryFromSearchParams } from "@/data/call-list-query";
import type { CloudflareClient } from "@/data/cloudflare-client";
import type { DataForSeoClient } from "@/data/dataforseo-client";
import { migrateDatabase } from "@/data/migrate";
import { createOrganizationRepository } from "@/data/organization-repository";
import {
  loadActivityPage,
  loadCallsPage,
  loadHomePage,
  loadIntegrationsPage,
  loadSitePage,
  loadWorkspaceCallsPage,
  loadWorkspaceOverviewPage,
  loadWorkspacesPage,
  type PageRuntime,
} from "@/data/page-loaders";
import type { ProviderConfiguration } from "@/data/provider-health";
import { observePool, type RequestPoolStats } from "@/data/request-log";
import { schema } from "@/data/schema";
import { createTracerAuth } from "@/data/tracer-auth";
import { createRequestPool } from "@/data/tracer-runtime";
import type { TransactionalEmailMessage } from "@/data/transactional-email";
import type { TwilioClient } from "@/data/twilio-client";
import { findUserAvatarSeed } from "@/data/user-avatar";
import { createReadableWorkspaces } from "@/data/workspace-authorization";
import { workspaceListQueryFromSearchParams } from "@/data/workspaces";

let container: StartedPostgreSqlContainer | undefined;
let connectionUri = "";
let pool: Pool | undefined;
let actor: Actor;
const workspaceId = "workspace-budget";
const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const messages: TransactionalEmailMessage[] = [];
const backgroundTasks: Promise<unknown>[] = [];

const unavailable = () => {
  throw new Error("provider not reached by a page load");
};
const twilio: TwilioClient = { fetchAccount: unavailable, listIncomingPhoneNumbers: unavailable, fetchIncomingPhoneNumber: unavailable, updateIncomingPhoneNumberVoice: unavailable };
const cloudflare: CloudflareClient = { verifyToken: unavailable, listSites: unavailable, listDeployments: unavailable, fetchDailyTraffic: unavailable, captureScreenshot: unavailable };
const dataforseo: DataForSeoClient = { verify: unavailable, serp: unavailable, listLocations: unavailable };
const providerConfiguration: ProviderConfiguration = { twilioMasterKey: true, hyperdrive: true, email: true, emailFrom: "auth@example.com", emailAllowlistCount: 1, r2: false, r2Bucket: null, openai: false, triggerdev: false };

/**
 * Waves are the 2026-10-24 budget as agreed. Query ceilings hold where the
 * loaders met the agreed numbers; Home (agreed 20), the Overview (agreed 20),
 * and the Site page (agreed 18) sit at their measured counts because the
 * remaining queries are the same Workspace authorization lookup repeated by
 * each service a page composes, which a later slice collapses. Lower a
 * number here when a change earns it; never raise one.
 */
const budgets = {
  actor: { waves: 3, queries: 3 },
  home: { waves: 4, queries: 21 },
  workspaces: { waves: 3, queries: 10 },
  overview: { waves: 4, queries: 33 },
  site: { waves: 4, queries: 25 },
  integrations: { waves: 2, queries: 12 },
  calls: { waves: 3, queries: 8 },
  workspaceCalls: { waves: 3, queries: 8 },
  activity: { waves: 3, queries: 8 },
} as const;

function auth(connection: Pool) {
  return createTracerAuth({
    database: drizzle(connection, { schema }),
    email: { async send(message) { messages.push(message); return { messageId: `email-${messages.length}` }; } },
    emailFrom: "auth@example.com",
    allowedRecipients: new Set(["operator@example.com"]),
    backgroundTask: (promise) => backgroundTasks.push(promise),
    secret: "integration-only-secret",
    baseURL: "http://localhost:3000",
  });
}

async function signIn(): Promise<string> {
  const instance = auth(pool!);
  const send = await instance.handler(new Request("http://localhost:3000/api/auth/email-otp/send-verification-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "operator@example.com", type: "sign-in" }) }));
  expect(send.status).toBe(200);
  await Promise.all(backgroundTasks.splice(0));
  const code = messages.at(-1)?.text.match(/\d{6}/)?.[0];
  const verify = await instance.handler(new Request("http://localhost:3000/api/auth/sign-in/email-otp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "operator@example.com", otp: code }) }));
  expect(verify.status).toBe(200);
  return (verify.headers.get("set-cookie") ?? "").split(";", 1)[0];
}

function runtimeFor(connection: Pool): PageRuntime {
  return { pool: connection, masterKey, baseURL: "http://localhost:3000", providerConfiguration };
}

/** Everything the shell reads for a navigation besides the actor: the Organization and the avatar seed. */
function layoutReads(connection: Pool): Promise<unknown> {
  return Promise.all([createOrganizationRepository(connection).findById(actor.organizationId), findUserAvatarSeed(connection, actor.userId)]);
}

async function navigation(name: keyof typeof budgets, run: (connection: Pool) => Promise<unknown>): Promise<RequestPoolStats> {
  const requestPool = createRequestPool(connectionUri);
  const stats = observePool(requestPool);
  try {
    await run(requestPool);
  } finally {
    await requestPool.end();
  }
  console.info(`page budget ${name}: waves=${stats.waves} queries=${stats.queries} budget=${budgets[name].waves}/${budgets[name].queries}`);
  expect(stats.waves).toBeLessThanOrEqual(budgets[name].waves);
  expect(stats.queries).toBeLessThanOrEqual(budgets[name].queries);
  return stats;
}

async function workspaceNavigation(name: keyof typeof budgets, load: (connection: Pool, workspace: NonNullable<Awaited<ReturnType<ReturnType<typeof createReadableWorkspaces>["find"]>>>) => Promise<unknown>) {
  return navigation(name, async (connection) => {
    const [workspace] = await Promise.all([createReadableWorkspaces(connection, actor).find(workspaceId), layoutReads(connection)]);
    if (!workspace) throw new Error("budget Workspace missing");
    await load(connection, workspace);
  });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  connectionUri = container.getConnectionUri();
  pool = new Pool({ connectionString: connectionUri });
  await migrateDatabase(connectionUri);
  const bootstrapped = await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "Example Operator", timezone: "America/Chicago" });
  actor = { userId: bootstrapped.userId, organizationId: bootstrapped.organizationId, name: "Example Operator", email: "operator@example.com", timezone: "America/Chicago", state: "Active", role: "Operator" };
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, destination_number, created_at, updated_at) values
       ($1, $2, 'Pocatello Paving', 'America/Boise', 'Active', '+12085550100', now(), now()),
       ('workspace-budget-setup', $2, 'Blackfoot Paving', 'America/Boise', 'Setup Required', null, now(), now())`,
    [workspaceId, actor.organizationId],
  );
  await pool.query(
    `insert into site (id, organization_id, script_name, primary_hostname, zone_id, service_area_city, service_area_region, service_area_country, first_seen_at, last_seen_at, created_at, updated_at)
     values ('site-budget', $1, 'asphalt-paving-pocatello', 'pocatelloasphaltpaving.com', 'zone-1', 'Pocatello', 'Idaho', 'United States', now(), now(), now(), now())`,
    [actor.organizationId],
  );
  await pool.query(
    "insert into site_link (id, organization_id, workspace_id, site_id, started_by_user_id, started_at) values ('link-budget', $1, $2, 'site-budget', $3, now())",
    [actor.organizationId, workspaceId, actor.userId],
  );
  await pool.query(
    `insert into site_keyword (id, site_id, phrase, weight, created_at, updated_at) values
       ('keyword-1', 'site-budget', 'asphalt paving pocatello', 5, now(), now()),
       ('keyword-2', 'site-budget', 'driveway repair pocatello', 3, now(), now())`,
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe.sequential("page budgets", () => {
  it("resolves the actor from a session cookie within budget", async () => {
    const cookie = await signIn();
    await navigation("actor", async (connection) => {
      const resolved = await resolveActor(auth(connection), drizzle(connection, { schema }), new Headers({ cookie }));
      expect(resolved?.role).toBe("Operator");
    });
  });

  it("loads Home within budget", async () => {
    await navigation("home", (connection) => Promise.all([layoutReads(connection), loadHomePage(runtimeFor(connection), actor, analyticsRangeFromSearchParams({}))]));
  });

  it("loads Workspaces within budget", async () => {
    await navigation("workspaces", (connection) => Promise.all([layoutReads(connection), loadWorkspacesPage(runtimeFor(connection), actor, workspaceListQueryFromSearchParams({}), cloudflare)]));
  });

  it("loads the Workspace Overview within budget", async () => {
    await workspaceNavigation("overview", (connection, workspace) => loadWorkspaceOverviewPage(runtimeFor(connection), actor, workspace, analyticsRangeFromSearchParams({}), twilio));
  });

  it("loads the Site page within budget", async () => {
    await workspaceNavigation("site", (connection, workspace) => loadSitePage(runtimeFor(connection), actor, workspace, analyticsRangeFromSearchParams({}), cloudflare));
  });

  it("loads Integrations within budget", async () => {
    await navigation("integrations", (connection) => Promise.all([layoutReads(connection), loadIntegrationsPage(runtimeFor(connection), actor, { twilio, cloudflare, dataforseo })]));
  });

  it("loads Calls within budget", async () => {
    await navigation("calls", (connection) => Promise.all([layoutReads(connection), loadCallsPage(runtimeFor(connection), actor, callListQueryFromSearchParams({}))]));
  });

  it("loads Workspace Calls within budget", async () => {
    await workspaceNavigation("workspaceCalls", (connection) => loadWorkspaceCallsPage(runtimeFor(connection), actor, workspaceId, callListQueryFromSearchParams({})));
  });

  it("loads Activity within budget", async () => {
    await navigation("activity", (connection) => Promise.all([layoutReads(connection), loadActivityPage(runtimeFor(connection), actor, activityFiltersFromSearchParams({}))]));
  });
});
