/**
 * -------------------------------------------------------------------------
 * @file   business.test.ts
 * @brief  Proves the Workspace Business and city lookup routes.
 *
 * @description
 *  Runs the Workspace handler against a migrated PostgreSQL container
 *  and checks that a Workspace starts without a Business, that a save
 *  upserts the one Business with trimmed fields, a normalized website,
 *  and a city point only beside a city, that invalid input answers 400,
 *  that a Client Viewer gets 403 on the Business and Places routes, and
 *  that the Places route proxies the injected client and answers 502
 *  when the geocoder fails.
 *
 * @see
 *  data/business.ts
 *  data/workspaces-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./test-database";

import type { OpenedDatabase } from "@/data/database";
import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { createIntegrations } from "@/data/integrations";
import { migrateDatabase } from "@/data/migrate";
import { PlacesClientError, type PlacesClient } from "@/data/places-client";
import { createTracerAuth } from "@/data/tracer-auth";
import type { TwilioClient } from "@/data/twilio-client";
import { createWorkspacesHandler } from "@/data/workspaces-handler";
import type { TransactionalEmailMessage } from "@/data/transactional-email";

let container: StartedPostgreSqlContainer | undefined;
let database: OpenedDatabase | undefined;
let organizationId = "";
const viewerId = "viewer-user-id";
const messages: TransactionalEmailMessage[] = [];
const backgroundTasks: Promise<unknown>[] = [];
const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
let placesFail = false;
const placesQueries: string[] = [];

const fakeTwilio: TwilioClient = {
  async fetchAccount() { throw new Error("not implemented"); },
  async listIncomingPhoneNumbers() { throw new Error("not implemented"); },
  async fetchIncomingPhoneNumber() { throw new Error("not implemented"); },
  async updateIncomingPhoneNumberVoice() { throw new Error("not implemented"); },
};

const fakePlaces: PlacesClient = {
  async searchCities(query) {
    placesQueries.push(query);
    if (placesFail) throw new PlacesClientError(503);
    return [{ label: `${query}, Texas, United States`, latitude: 30.26, longitude: -97.74 }];
  },
};

const auth = () => createTracerAuth({
  database: database!.drizzle,
  email: { async send(message) { messages.push(message); return { messageId: `email-${messages.length}` }; } },
  emailFrom: "auth@example.com",
  allowedRecipients: new Set(["operator@example.com", "viewer@example.com"]),
  backgroundTask: (promise) => backgroundTasks.push(promise),
  secret: "integration-only-secret",
  baseURL: "http://localhost:3000",
});

function handler(places: PlacesClient | null) {
  return createWorkspacesHandler({
    auth: auth(),
    database: database!,
    twilio: fakeTwilio,
    places: places ?? undefined,
    integrations: (orgId) => createIntegrations({ database: database!, organizationId: orgId, twilio: fakeTwilio, masterKey }),
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

async function json(request: Request, places: PlacesClient | null = fakePlaces): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await handler(places)(request);
  return { response, body: response.status === 204 ? {} : await response.json() as Record<string, unknown> };
}

function send(cookie: string, method: string, route: string, body?: unknown): Request {
  return new Request(`http://localhost:3000/api/workspaces/${route}`, { method, headers: { cookie, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  database = createTestDatabase(container.getConnectionUri());
  await migrateDatabase(container.getConnectionUri());
  const bootstrapped = await bootstrapInitialOperator(database, { email: "operator@example.com", name: "Example Operator", timezone: "America/Chicago" });
  organizationId = bootstrapped.organizationId;
  await database.query(
    `insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at)
     values ($1, 'Client Viewer', 'viewer@example.com', false, 'Active', 'UTC', now(), now())`,
    [viewerId],
  );
  await database.query("insert into member (id, organization_id, user_id, role, created_at) values ('viewer-membership-id', $1, $2, 'member', now())", [organizationId, viewerId]);
  await database.query(
    "insert into workspace (id, organization_id, name, reporting_timezone, state, created_at, updated_at) values ('workspace-a', $1, 'Pocatello Paving', 'UTC', 'Active', now(), now())",
    [organizationId],
  );
  await database.query("insert into access_grant (id, organization_id, workspace_id, user_id, created_at) values ('grant-a', $1, 'workspace-a', $2, now())", [organizationId, viewerId]);
}, 120_000);

afterAll(async () => {
  await database?.close();
  await container?.stop();
});

describe.sequential("Business", () => {
  it("starts without a Business and saves one whole, trimming fields and normalizing the website", async () => {
    const cookie = await signIn("operator@example.com");
    const empty = await json(send(cookie, "GET", "workspace-a/business"));
    expect(empty.response.status).toBe(200);
    expect(empty.body.business).toBeNull();

    const saved = await json(send(cookie, "PUT", "workspace-a/business", {
      name: "  Pocatello Paving Co ", firstName: "Jordan", lastName: "Lee", email: "jordan@pocatellopaving.example", niche: "Asphalt paving", website: "pocatellopaving.example/about",
      city: "Pocatello, Idaho, United States", cityPoint: { latitude: 42.8713, longitude: -112.4455 },
    }));
    expect(saved.response.status).toBe(200);
    expect(saved.body.business).toMatchObject({
      workspaceId: "workspace-a", name: "Pocatello Paving Co", firstName: "Jordan", lastName: "Lee", email: "jordan@pocatellopaving.example", niche: "Asphalt paving",
      website: "https://pocatellopaving.example/about", city: "Pocatello, Idaho, United States", cityPoint: { latitude: 42.8713, longitude: -112.4455 },
    });

    const again = await json(send(cookie, "PUT", "workspace-a/business", { name: "Pocatello Paving Co", city: "Somewhere typed", cityPoint: null }));
    expect(again.response.status).toBe(200);
    expect(again.body.business).toMatchObject({ name: "Pocatello Paving Co", firstName: null, email: null, website: null, city: "Somewhere typed", cityPoint: null });
    const rows = await database!.query("select count(*)::int as count from business where workspace_id = 'workspace-a'");
    expect(rows.rows[0].count).toBe(1);
    const read = await json(send(cookie, "GET", "workspace-a/business"));
    expect(read.body.business).toMatchObject({ city: "Somewhere typed", cityPoint: null });
  });

  it("rejects a bad email, a bad website, a point without a city, and an out-of-range point", async () => {
    const cookie = await signIn("operator@example.com");
    for (const body of [
      { email: "not-an-email" },
      { website: "not a url" },
      { website: "ftp://files.example" },
      { city: "Pocatello", cityPoint: { latitude: 95, longitude: 0 } },
      { city: "Pocatello", cityPoint: { latitude: "42" } },
      { name: "x".repeat(121) },
    ]) {
      const rejected = await json(send(cookie, "PUT", "workspace-a/business", body));
      expect(rejected.response.status, JSON.stringify(body)).toBe(400);
    }
    const missing = await json(send(cookie, "PUT", "workspace-x/business", { name: "Nobody" }));
    expect(missing.response.status).toBe(404);
  });

  it("looks cities up through the Places client for Operators only and reports a geocoder failure as 502", async () => {
    const cookie = await signIn("operator@example.com");
    const found = await json(send(cookie, "GET", "places?q=Pocatello"));
    expect(found.response.status).toBe(200);
    expect(found.body.places).toEqual([{ label: "Pocatello, Texas, United States", latitude: 30.26, longitude: -97.74 }]);
    expect(placesQueries).toEqual(["Pocatello"]);

    placesFail = true;
    const failed = await json(send(cookie, "GET", "places?q=Pocatello"));
    expect(failed.response.status).toBe(502);
    expect(failed.body.error).toBe("provider_unavailable");
    placesFail = false;

    const unavailable = await json(send(cookie, "GET", "places?q=Pocatello"), null);
    expect(unavailable.response.status).toBe(503);

    const viewer = await signIn("viewer@example.com");
    expect((await json(send(viewer, "GET", "workspace-a/business"))).response.status).toBe(403);
    expect((await json(send(viewer, "PUT", "workspace-a/business", { name: "Nope" }))).response.status).toBe(403);
    expect((await json(send(viewer, "GET", "places?q=Pocatello"))).response.status).toBe(403);
  });
});
