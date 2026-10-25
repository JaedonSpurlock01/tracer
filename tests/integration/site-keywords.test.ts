/**
 * -------------------------------------------------------------------------
 * @file   site-keywords.test.ts
 * @brief  Verifies Service Area, Keywords, and the Search read model.
 *
 * @description
 *  Exercises the Workspace Site routes for the Service Area and Keywords:
 *  phrases unique per Site case-insensitively, weights within 1 to 5, at
 *  most 25 live Keywords, soft removal, Operator-only writes, Client
 *  Viewer reads through an Access Grant, and the Search read model with
 *  its score, 30-day trend, per-Keyword positions, and 7-day change from
 *  stored rank days.
 *
 * @remarks
 *  The suite uses one PostgreSQL container and real Better Auth sessions;
 *  rank days are seeded directly because the daily check has its own
 *  suite.
 *
 * @see
 *  data/site-keywords.ts
 *  data/site-search.ts
 *  data/workspaces-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDatabase } from "./test-database";

import type { OpenedDatabase } from "@/data/database";
import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import type { DataForSeoClient } from "@/data/dataforseo-client";
import { createIntegrations } from "@/data/integrations";
import { migrateDatabase } from "@/data/migrate";
import type { StructuredRequest, StructuredResponder } from "@/data/openai-client";
import { sealSecret } from "@/data/provider-credential";
import { siteSearch } from "@/data/site-search";
import { createTracerAuth } from "@/data/tracer-auth";
import type { TwilioClient } from "@/data/twilio-client";
import { createWorkspacesHandler } from "@/data/workspaces-handler";
import type { TransactionalEmailMessage } from "@/data/transactional-email";

let container: StartedPostgreSqlContainer | undefined;
let database: OpenedDatabase | undefined;
let organizationId = "";
let operatorId = "";
const viewerId = "viewer-user-id";
const messages: TransactionalEmailMessage[] = [];
const backgroundTasks: Promise<unknown>[] = [];
const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const keywordIds: Record<string, string> = {};

const fakeTwilio: TwilioClient = {
  async fetchAccount() { throw new Error("not implemented"); },
  async listIncomingPhoneNumbers() { throw new Error("not implemented"); },
  async fetchIncomingPhoneNumber() { throw new Error("not implemented"); },
  async updateIncomingPhoneNumberVoice() { throw new Error("not implemented"); },
};

const locationLookups: string[] = [];
let failNextLocationLookup = false;
const structuredRequests: StructuredRequest[] = [];
const openai: StructuredResponder = {
  async respond(request) {
    structuredRequests.push(request);
    return { text: JSON.stringify({ phrases: ["Pothole Repair Pocatello", "asphalt paving pocatello", "sealcoating pocatello idaho"] }), inputTokens: 100, outputTokens: 40 };
  },
};
const fakeDataForSeo: DataForSeoClient = {
  async verify(credential) { return { login: credential.login }; },
  async serp() { throw new Error("not implemented"); },
  async keywordOverview(_credential, query) {
    return query.keywords.map((phrase, index) => ({ phrase, monthlyVolume: (index + 1) * 100, difficulty: 25, intent: "commercial" as const }));
  },
  async listLocations(_credential, countryIso) {
    if (failNextLocationLookup) {
      failNextLocationLookup = false;
      throw new TypeError("Cannot read properties of undefined (reading 'tasks')");
    }
    locationLookups.push(countryIso);
    return [
      { code: 2840, name: "United States", kind: "Country" },
      { code: 21146, name: "Idaho,United States", kind: "State" },
      { code: 1016141, name: "Pocatello,Idaho,United States", kind: "City" },
      { code: 1016141, name: "Pocatello,Idaho,United States", kind: "City" },
      { code: 1016142, name: "Pocatello Regional Airport,Idaho,United States", kind: "Airport" },
      { code: 1026339, name: "St. George,Utah,United States", kind: "City" },
    ];
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

function handler() {
  return createWorkspacesHandler({
    auth: auth(),
    database: database!,
    twilio: fakeTwilio,
    dataforseo: fakeDataForSeo,
    openai,
    masterKey,
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

async function json(request: Request): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await handler()(request);
  return { response, body: response.status === 204 ? {} : await response.json() as Record<string, unknown> };
}

function send(cookie: string, method: string, route: string, body?: unknown): Request {
  return new Request(`http://localhost:3000/api/workspaces/${route}`, { method, headers: { cookie, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

function utcDay(offset: number): string {
  return new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  database = createTestDatabase(container.getConnectionUri());
  await migrateDatabase(container.getConnectionUri());
  const bootstrapped = await bootstrapInitialOperator(database, { email: "operator@example.com", name: "Example Operator", timezone: "America/Chicago" });
  organizationId = bootstrapped.organizationId;
  operatorId = bootstrapped.userId;
  await database.query(
    `insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at)
     values ($1, 'Client Viewer', 'viewer@example.com', false, 'Active', 'UTC', now(), now())`,
    [viewerId],
  );
  await database.query("insert into member (id, organization_id, user_id, role, created_at) values ('viewer-membership-id', $1, $2, 'member', now())", [organizationId, viewerId]);
  await database.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, created_at, updated_at) values
       ('workspace-a', $1, 'Pocatello Paving', 'UTC', 'Active', now(), now()),
       ('workspace-b', $1, 'St George Paving', 'America/Denver', 'Active', now(), now()),
       ('workspace-c', $1, 'Blackfoot Paving', 'America/Boise', 'Setup Required', now(), now())`,
    [organizationId],
  );
  await database.query("insert into access_grant (id, organization_id, workspace_id, user_id, created_at) values ('grant-a', $1, 'workspace-a', $2, now())", [organizationId, viewerId]);
  await database.query(
    `insert into business (id, organization_id, workspace_id, name, niche, created_at, updated_at) values
       ('business-a', $1, 'workspace-a', 'Pocatello Paving', 'Asphalt paving', now(), now()),
       ('business-b', $1, 'workspace-b', 'St George Paving', null, now(), now())`,
    [organizationId],
  );
  await database.query(
    `insert into site (id, organization_id, script_name, primary_hostname, zone_id, first_seen_at, last_seen_at, created_at, updated_at) values
       ('site-pocatello', $1, 'asphalt-paving-pocatello', 'pocatelloasphaltpaving.com', 'zone-1', now(), now(), now(), now()),
       ('site-st-george', $1, 'asphalt-paving-st-george', 'asphaltpavingstgeorge.com', 'zone-2', now(), now(), now(), now())`,
    [organizationId],
  );
  await database.query(
    `insert into site_link (id, organization_id, site_id, workspace_id, started_at, started_by_user_id) values
       ('link-a', $1, 'site-pocatello', 'workspace-a', now(), $2),
       ('link-b', $1, 'site-st-george', 'workspace-b', now(), $2)`,
    [organizationId, operatorId],
  );
  const sealed = await sealSecret(masterKey, "synthetic-dataforseo-password");
  await database.query(
    `insert into dataforseo_connection (id, organization_id, login, password_ciphertext, master_key_fingerprint, connected_by_user_id, connected_at, last_verified_at, created_at, updated_at)
     values ('keywords-connection', $1, 'operator@example.com', $2, $3, $4, now(), now(), now(), now())`,
    [organizationId, sealed.ciphertext, sealed.fingerprint, operatorId],
  );
}, 120_000);

afterAll(async () => {
  await database?.close();
  await container?.stop();
});

describe.sequential("Site Keywords and Service Area", () => {
  it("answers Not Found for a Workspace without a Site and starts with an empty Service Area", async () => {
    const cookie = await signIn("operator@example.com");
    expect((await json(send(cookie, "GET", "workspace-c/site/keywords"))).response.status).toBe(404);
    const empty = await json(send(cookie, "GET", "workspace-a/site/keywords"));
    expect(empty.response.status).toBe(200);
    expect(empty.body).toEqual({ serviceArea: { city: null, region: null, country: "United States", locationCode: null, locationName: null }, keywords: [], suggestions: null });
  });

  it("answers 500 and logs the error when a dependency fails unexpectedly, instead of calling it invalid input", async () => {
    const cookie = await signIn("operator@example.com");
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    failNextLocationLookup = true;
    const failed = await json(send(cookie, "GET", "workspace-a/site/locations?q=poca"));
    expect(failed.response.status).toBe(500);
    expect(failed.body).toEqual({ error: "internal_error" });
    expect(logged).toHaveBeenCalledWith("workspaces handler failed", expect.objectContaining({ message: "Cannot read properties of undefined (reading 'tasks')" }));
    logged.mockRestore();
  });

  it("searches DataForSEO locations for the Service Area picker, importing the country list once even when DataForSEO repeats a code", async () => {
    const cookie = await signIn("operator@example.com");
    const first = await json(send(cookie, "GET", "workspace-a/site/locations?q=poca"));
    expect(first.response.status).toBe(200);
    expect(first.body.locations).toEqual([
      { code: 1016141, name: "Pocatello,Idaho,United States", kind: "City" },
      { code: 1016142, name: "Pocatello Regional Airport,Idaho,United States", kind: "Airport" },
    ]);
    const second = await json(send(cookie, "GET", "workspace-a/site/locations?q=george"));
    expect(second.body.locations).toEqual([{ code: 1026339, name: "St. George,Utah,United States", kind: "City" }]);
    expect(locationLookups).toEqual(["us"]);
    expect((await json(send(cookie, "GET", "workspace-a/site/locations?q=p"))).body.locations).toEqual([]);
    const viewer = await signIn("viewer@example.com");
    expect((await json(send(viewer, "GET", "workspace-a/site/locations?q=poca"))).response.status).toBe(403);
  });

  it("saves the Service Area as a picked location and derives the city, region, and country from its name", async () => {
    const cookie = await signIn("operator@example.com");
    const saved = await json(send(cookie, "PUT", "workspace-a/site/service-area", { locationCode: 1016141, locationName: "Pocatello,Idaho,United States" }));
    expect(saved.response.status).toBe(200);
    expect(saved.body).toEqual({ serviceArea: { city: "Pocatello", region: "Idaho", country: "United States", locationCode: 1016141, locationName: "Pocatello,Idaho,United States" } });
    expect((await json(send(cookie, "PUT", "workspace-a/site/service-area", { locationCode: "1016141", locationName: "Pocatello,Idaho,United States" }))).response.status).toBe(400);
    expect((await json(send(cookie, "PUT", "workspace-a/site/service-area", { locationCode: 1016141, locationName: "" }))).response.status).toBe(400);
    const stored = await database!.query("select service_area_city, service_area_region, service_area_country, service_area_location_code, service_area_location_name from site where id = 'site-pocatello'");
    expect(stored.rows[0]).toEqual({ service_area_city: "Pocatello", service_area_region: "Idaho", service_area_country: "United States", service_area_location_code: 1016141, service_area_location_name: "Pocatello,Idaho,United States" });
  });

  it("adds Keywords with a trimmed phrase, a default weight, unique phrases per Site, and weights within 1 to 5", async () => {
    const cookie = await signIn("operator@example.com");
    const added = await json(send(cookie, "POST", "workspace-a/site/keywords", { phrase: "  Asphalt Paving Pocatello  " }));
    expect(added.response.status).toBe(201);
    expect(added.body.keyword).toEqual({ id: expect.any(String), phrase: "Asphalt Paving Pocatello", weight: 1, createdAt: expect.any(String) });
    keywordIds.paving = (added.body.keyword as { id: string }).id;
    const weighted = await json(send(cookie, "POST", "workspace-a/site/keywords", { phrase: "driveway paving pocatello", weight: 5 }));
    expect(weighted.response.status).toBe(201);
    keywordIds.driveway = (weighted.body.keyword as { id: string }).id;
    const duplicate = await json(send(cookie, "POST", "workspace-a/site/keywords", { phrase: "asphalt paving POCATELLO", weight: 2 }));
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.body).toEqual({ error: "duplicate_phrase" });
    for (const body of [{ phrase: "   " }, { phrase: "x", weight: 0 }, { phrase: "x", weight: 6 }, { phrase: "x", weight: 1.5 }, { phrase: "x", weight: "3" }, { phrase: "y".repeat(121) }]) {
      expect((await json(send(cookie, "POST", "workspace-a/site/keywords", body))).response.status, JSON.stringify(body)).toBe(400);
    }
    const elsewhere = await json(send(cookie, "POST", "workspace-b/site/keywords", { phrase: "asphalt paving pocatello" }));
    expect(elsewhere.response.status).toBe(201);
    keywordIds.elsewhere = (elsewhere.body.keyword as { id: string }).id;
    const listed = await json(send(cookie, "GET", "workspace-a/site/keywords"));
    expect((listed.body.keywords as Array<{ phrase: string; weight: number }>)).toEqual([
      { id: keywordIds.paving, phrase: "Asphalt Paving Pocatello", weight: 1, createdAt: expect.any(String) },
      { id: keywordIds.driveway, phrase: "driveway paving pocatello", weight: 5, createdAt: expect.any(String) },
    ]);
  });

  it("changes a weight with PATCH, soft-removes with DELETE, and frees the phrase for reuse", async () => {
    const cookie = await signIn("operator@example.com");
    const patched = await json(send(cookie, "PATCH", `workspace-a/site/keywords/${keywordIds.driveway}`, { weight: 3 }));
    expect(patched.response.status).toBe(200);
    expect(patched.body.keyword).toMatchObject({ id: keywordIds.driveway, weight: 3 });
    expect((await json(send(cookie, "PATCH", `workspace-a/site/keywords/${keywordIds.driveway}`, { weight: 9 }))).response.status).toBe(400);
    expect((await json(send(cookie, "PATCH", `workspace-a/site/keywords/${keywordIds.elsewhere}`, { weight: 2 }))).response.status).toBe(404);
    const removed = await json(send(cookie, "DELETE", `workspace-a/site/keywords/${keywordIds.driveway}`));
    expect(removed.response.status).toBe(204);
    const row = await database!.query<{ removed_at: Date | null }>("select removed_at from site_keyword where id = $1", [keywordIds.driveway]);
    expect(row.rows[0].removed_at).not.toBeNull();
    expect((await json(send(cookie, "DELETE", `workspace-a/site/keywords/${keywordIds.driveway}`))).response.status).toBe(404);
    const again = await json(send(cookie, "POST", "workspace-a/site/keywords", { phrase: "Driveway Paving Pocatello", weight: 2 }));
    expect(again.response.status).toBe(201);
    keywordIds.driveway = (again.body.keyword as { id: string }).id;
    expect((await json(send(cookie, "GET", "workspace-a/site/keywords"))).body.keywords).toHaveLength(2);
  });

  it("keeps at most 25 live Keywords per Site", async () => {
    const cookie = await signIn("operator@example.com");
    for (let index = 3; index <= 25; index += 1) {
      expect((await json(send(cookie, "POST", "workspace-a/site/keywords", { phrase: `filler phrase ${index}` }))).response.status).toBe(201);
    }
    const overflow = await json(send(cookie, "POST", "workspace-a/site/keywords", { phrase: "one too many" }));
    expect(overflow.response.status).toBe(409);
    expect(overflow.body).toEqual({ error: "keyword_limit" });
    const fillers = await database!.query<{ id: string }>("select id from site_keyword where site_id = 'site-pocatello' and phrase like 'filler phrase %'");
    for (const filler of fillers.rows) expect((await json(send(cookie, "DELETE", `workspace-a/site/keywords/${filler.id}`))).response.status).toBe(204);
    expect((await json(send(cookie, "GET", "workspace-a/site/keywords"))).body.keywords).toHaveLength(2);
  });

  it("suggests Keywords for the linked Site, serves the cached set on the Keywords read, and refuses a Business without a niche or a Client Viewer", async () => {
    const cookie = await signIn("operator@example.com");
    const suggested = await json(send(cookie, "POST", "workspace-a/site/keywords/suggest"));
    expect(suggested.response.status).toBe(200);
    expect(structuredRequests).toHaveLength(1);
    expect((suggested.body.suggestions as { suggestions: unknown[] }).suggestions).toEqual([
      { phrase: "sealcoating pocatello idaho", monthlyVolume: 200, difficulty: 25, intent: "commercial" },
      { phrase: "pothole repair pocatello", monthlyVolume: 100, difficulty: 25, intent: "commercial" },
    ]);
    const read = await json(send(cookie, "GET", "workspace-a/site/keywords"));
    expect(read.body.suggestions).toEqual(suggested.body.suggestions);
    expect(structuredRequests).toHaveLength(1);
    const added = await json(send(cookie, "POST", "workspace-a/site/keywords", { phrase: "sealcoating pocatello idaho", weight: 3 }));
    expect(added.response.status).toBe(201);
    expect(((await json(send(cookie, "GET", "workspace-a/site/keywords"))).body.suggestions as { suggestions: { phrase: string }[] }).suggestions.map((suggestion) => suggestion.phrase)).toEqual(["pothole repair pocatello"]);
    expect((await json(send(cookie, "DELETE", `workspace-a/site/keywords/${(added.body.keyword as { id: string }).id}`))).response.status).toBe(204);

    const noNiche = await json(send(cookie, "POST", "workspace-b/site/keywords/suggest"));
    expect(noNiche.response.status).toBe(409);
    expect(noNiche.body).toEqual({ error: "business_niche_missing" });
    expect((await json(send(cookie, "POST", "workspace-c/site/keywords/suggest"))).response.status).toBe(404);
    const viewer = await signIn("viewer@example.com");
    expect((await json(send(viewer, "POST", "workspace-a/site/keywords/suggest"))).response.status).toBe(403);
    expect(structuredRequests).toHaveLength(1);
  });

  it("lets a Client Viewer read Keywords and Search inside a granted Workspace but never edit them", async () => {
    const cookie = await signIn("viewer@example.com");
    const keywords = await json(send(cookie, "GET", "workspace-a/site/keywords"));
    expect(keywords.response.status).toBe(200);
    expect(keywords.body.keywords).toHaveLength(2);
    expect((await json(send(cookie, "GET", "workspace-a/site/search"))).response.status).toBe(200);
    expect((await json(send(cookie, "GET", "workspace-b/site/keywords"))).response.status).toBe(404);
    expect((await json(send(cookie, "GET", "workspace-b/site/search"))).response.status).toBe(404);
    expect((await json(send(cookie, "POST", "workspace-a/site/keywords", { phrase: "viewer phrase" }))).response.status).toBe(403);
    expect((await json(send(cookie, "PATCH", `workspace-a/site/keywords/${keywordIds.paving}`, { weight: 4 }))).response.status).toBe(403);
    expect((await json(send(cookie, "DELETE", `workspace-a/site/keywords/${keywordIds.paving}`))).response.status).toBe(403);
    expect((await json(send(cookie, "PUT", "workspace-a/site/service-area", { city: "Boise", region: "Idaho", country: "United States" }))).response.status).toBe(403);
    expect((await database!.query("select count(*) from site_keyword where site_id = 'site-pocatello' and removed_at is null")).rows[0]).toEqual({ count: "2" });
  });

  it("reads Search with no score before any check and with the weighted score, trend, and 7-day change afterwards", async () => {
    const cookie = await signIn("operator@example.com");
    const before = await json(send(cookie, "GET", "workspace-a/site/search"));
    expect(before.response.status).toBe(200);
    expect(before.body).toMatchObject({ score: null, checkedAt: null, serviceArea: { city: "Pocatello", region: "Idaho", country: "United States", locationCode: 1016141, locationName: "Pocatello,Idaho,United States" } });
    expect((before.body.trend as unknown[])).toHaveLength(30);
    expect((before.body.trend as Array<{ score: number | null }>).every((point) => point.score === null)).toBe(true);
    expect(before.body.keywords).toEqual([
      { id: keywordIds.paving, phrase: "Asphalt Paving Pocatello", weight: 1, status: "unchecked", position: null, change7d: null, rankingUrl: null, matchedType: null, failureReason: null, topResults: [], checkedAt: null },
      { id: keywordIds.driveway, phrase: "Driveway Paving Pocatello", weight: 2, status: "unchecked", position: null, change7d: null, rankingUrl: null, matchedType: null, failureReason: null, topResults: [], checkedAt: null },
    ]);

    const top = JSON.stringify([{ position: 1, domain: "www.idahopaving.example", url: "https://www.idahopaving.example/", title: "Idaho Paving" }, { position: 2, domain: "pocatelloasphaltpaving.com", url: "https://pocatelloasphaltpaving.com/", title: "Pocatello Asphalt Paving" }]);
    await database!.query(
      `insert into keyword_rank_day (id, site_keyword_id, day, position, ranking_url, top_results, checked_at, matched_type) values
         ('rank-paving-7', $1, $3::date, 5, 'https://pocatelloasphaltpaving.com/', '[]'::jsonb, now() - interval '7 days', 'organic'),
         ('rank-paving-1', $1, $4::date, 3, 'https://pocatelloasphaltpaving.com/', '[]'::jsonb, now() - interval '1 day', 'organic'),
         ('rank-paving-0', $1, $5::date, 2, 'https://pocatelloasphaltpaving.com/', $6::jsonb, now(), 'local_pack'),
         ('rank-driveway-0', $2, $5::date, null, null, '[]'::jsonb, now(), null)`,
      [keywordIds.paving, keywordIds.driveway, utcDay(7), utcDay(1), utcDay(0), top],
    );
    const after = await json(send(cookie, "GET", "workspace-a/site/search"));
    expect(after.response.status).toBe(200);
    expect(after.body.score).toBe(20);
    expect(after.body.checkedAt).toEqual(expect.any(String));
    expect(after.body.keywords).toEqual([
      { id: keywordIds.paving, phrase: "Asphalt Paving Pocatello", weight: 1, status: "ranking", position: 2, change7d: 3, rankingUrl: "https://pocatelloasphaltpaving.com/", matchedType: "local_pack", failureReason: null, topResults: JSON.parse(top), checkedAt: expect.any(String) },
      { id: keywordIds.driveway, phrase: "Driveway Paving Pocatello", weight: 2, status: "not_ranking", position: null, change7d: null, rankingUrl: null, matchedType: null, failureReason: null, topResults: [], checkedAt: expect.any(String) },
    ]);

    await database!.query("update keyword_rank_day set check_status = 'failed', failure_reason = 'DataForSEO rejected the task (40501): Invalid Field: ''location_name''.' where id = 'rank-driveway-0'");
    const failed = await json(send(cookie, "GET", "workspace-a/site/search"));
    expect((failed.body.keywords as Array<Record<string, unknown>>)[1]).toMatchObject({ status: "check_failed", position: null, failureReason: expect.stringContaining("Invalid Field"), checkedAt: expect.any(String) });
    expect((failed.body.keywords as Array<Record<string, unknown>>)[0]).toMatchObject({ status: "ranking", position: 2 });
    await database!.query("update keyword_rank_day set check_status = 'checked', failure_reason = null where id = 'rank-driveway-0'");
    const trend = after.body.trend as Array<{ day: string; score: number | null }>;
    expect(trend).toHaveLength(30);
    expect(trend.at(-1)).toEqual({ day: utcDay(0), score: 20 });
    expect(trend.at(-2)).toEqual({ day: utcDay(1), score: 45 });
    expect(trend.at(-8)).toEqual({ day: utcDay(7), score: 25 });
    expect(trend.at(-9)).toEqual({ day: utcDay(8), score: null });
    expect(trend[0]).toEqual({ day: utcDay(29), score: null });
  });

  it("reads a rank day stored on the UTC date just after UTC midnight while the Workspace timezone is still on the previous day", async () => {
    const now = new Date("2026-10-21T00:30:00Z");
    await database!.query(
      "insert into keyword_rank_day (id, site_keyword_id, day, position, ranking_url, top_results, checked_at) values ('rank-elsewhere-utc', $1, '2026-10-21', 4, 'https://asphaltpavingstgeorge.com/', '[]'::jsonb, $2)",
      [keywordIds.elsewhere, now],
    );
    const search = await siteSearch(database!, "site-st-george", "America/Denver", now);
    expect(search?.checkedAt).toBe(now.toISOString());
    expect(search?.score).toBe(35);
    expect(search?.trend.at(-1)).toEqual({ day: "2026-10-21", score: 35 });
  });
});
