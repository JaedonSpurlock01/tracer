/**
 * -------------------------------------------------------------------------
 * @file   keyword-discovery.test.ts
 * @brief  Drives Keyword Discovery against PostgreSQL with fake OpenAI and DataForSEO boundaries.
 *
 * @description
 *  Suggests Keywords for a linked Site whose Business has a niche and
 *  whose Service Area is a picked location, checking the proposed phrases
 *  are measured, deduped against live Keywords, ranked by monthly volume,
 *  cached on the Site, and refused for a Client Viewer or a Business
 *  without a niche.
 *
 * @remarks
 *  Only the OpenAI responder and the DataForSEO client are faked; the
 *  Provider Credential module, the connection, and the Site rows are real.
 *
 * @see
 *  data/keyword-discovery.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./test-pool";

import type { Database } from "@/data/database";
import type { Actor } from "@/data/authorization";
import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import type { DataForSeoClient, DataForSeoKeywordOverviewQuery } from "@/data/dataforseo-client";
import { createKeywordDiscovery, KeywordDiscoveryError, type KeywordSuggestionSet } from "@/data/keyword-discovery";
import { migrateDatabase } from "@/data/migrate";
import type { StructuredRequest, StructuredResponder } from "@/data/openai-client";
import { sealSecret } from "@/data/provider-credential";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let database: Database | undefined;
let organizationId = "";
let operatorId = "";
const viewerId = "viewer-user-id";
const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

const structuredRequests: StructuredRequest[] = [];
let proposedPhrases: string[] = [];
let responderText: string | null = null;
const responder: StructuredResponder = {
  async respond(request) {
    structuredRequests.push(request);
    return { text: responderText ?? JSON.stringify({ phrases: proposedPhrases }), inputTokens: 120, outputTokens: 80 };
  },
};

const overviewQueries: DataForSeoKeywordOverviewQuery[] = [];
const volumes: Record<string, number> = {
  "driveway paving pocatello idaho": 480,
  "asphalt paving pocatello": 210,
  "pocatello asphalt contractor": 90,
  "sealcoating pocatello": 90,
};
const dataforseo: DataForSeoClient = {
  async verify(credential) { return { login: credential.login }; },
  async serp() { throw new Error("not implemented"); },
  async listLocations() { throw new Error("not implemented"); },
  async keywordOverview(_credential, query) {
    overviewQueries.push(query);
    return query.keywords.flatMap((phrase) => (phrase in volumes ? [{ phrase, monthlyVolume: volumes[phrase], difficulty: 20, intent: "commercial" as const }] : []));
  },
};

function operatorActor(): Actor {
  return { userId: operatorId, organizationId, role: "Operator", state: "Active", name: "Example Operator", email: "operator@example.com", timezone: "America/Chicago" };
}

function viewerActor(): Actor {
  return { userId: viewerId, organizationId, role: "Client Viewer", state: "Active", name: "Client Viewer", email: "viewer@example.com", timezone: "UTC" };
}

let now = new Date("2026-10-25T15:00:00.000Z");

function discovery(actor: Actor = operatorActor()) {
  return createKeywordDiscovery({ database: database!, actor, responder, dataforseo, masterKey, now: () => now });
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  database = createTestDatabase(container.getConnectionUri());
  pool = database.pool;
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
    `insert into business (id, organization_id, workspace_id, name, niche, created_at, updated_at) values
       ('business-a', $1, 'workspace-a', 'Pocatello Paving', 'Asphalt paving', now(), now()),
       ('business-b', $1, 'workspace-b', 'St George Paving', null, now(), now())`,
    [organizationId],
  );
  await pool.query(
    `insert into site (id, organization_id, script_name, primary_hostname, zone_id, first_seen_at, last_seen_at, created_at, updated_at,
                       service_area_city, service_area_region, service_area_country, service_area_location_code, service_area_location_name) values
       ('site-pocatello', $1, 'asphalt-paving-pocatello', 'pocatelloasphaltpaving.com', 'zone-1', now(), now(), now(), now(), 'Pocatello', 'Idaho', 'United States', 1016141, 'Pocatello,Idaho,United States'),
       ('site-st-george', $1, 'asphalt-paving-st-george', 'asphaltpavingstgeorge.com', 'zone-2', now(), now(), now(), now(), 'St. George', 'Utah', 'United States', 1026339, 'St. George,Utah,United States')`,
    [organizationId],
  );
  await pool.query(
    `insert into site_link (id, organization_id, site_id, workspace_id, started_at, started_by_user_id) values
       ('link-a', $1, 'site-pocatello', 'workspace-a', now(), $2),
       ('link-b', $1, 'site-st-george', 'workspace-b', now(), $2)`,
    [organizationId, operatorId],
  );
  await pool.query(
    "insert into site_keyword (id, site_id, phrase, weight, created_at, updated_at) values ('keyword-existing', 'site-pocatello', 'Asphalt Paving Pocatello', 3, now(), now())",
  );
  const sealed = await sealSecret(masterKey, "synthetic-dataforseo-password");
  await pool.query(
    `insert into dataforseo_connection (id, organization_id, login, password_ciphertext, master_key_fingerprint, connected_by_user_id, connected_at, last_verified_at, created_at, updated_at)
     values ('discovery-connection', $1, 'operator@example.com', $2, $3, $4, now(), now(), now(), now())`,
    [organizationId, sealed.ciphertext, sealed.fingerprint, operatorId],
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe.sequential("Keyword Discovery", () => {
  it("proposes phrases from the Business niche and Service Area, measures them, drops live Keywords, and ranks by monthly volume", async () => {
    proposedPhrases = [
      "Driveway Paving Pocatello Idaho",
      "asphalt paving pocatello",
      "sealcoating pocatello",
      "pocatello asphalt contractor",
      "  Sealcoating   Pocatello ",
      "asphalt repair pocatello",
      "a phrase with far too many words to be a search phrase anyone types into google for paving",
    ];

    const set = await discovery().suggest("site-pocatello");

    expect(structuredRequests).toHaveLength(1);
    expect(structuredRequests[0].model).toBe("gpt-5-mini");
    expect(structuredRequests[0].input).toContain("Asphalt paving");
    expect(structuredRequests[0].input).toContain("Pocatello,Idaho,United States");
    expect(structuredRequests[0].input).toContain("asphalt paving pocatello");
    expect(overviewQueries).toEqual([{
      keywords: ["driveway paving pocatello idaho", "sealcoating pocatello", "pocatello asphalt contractor", "asphalt repair pocatello"],
      locationCode: 1016141,
      languageCode: "en",
    }]);
    expect(set).toEqual({
      suggestedAt: "2026-10-25T15:00:00.000Z",
      suggestions: [
        { phrase: "driveway paving pocatello idaho", monthlyVolume: 480, difficulty: 20, intent: "commercial" },
        { phrase: "pocatello asphalt contractor", monthlyVolume: 90, difficulty: 20, intent: "commercial" },
        { phrase: "sealcoating pocatello", monthlyVolume: 90, difficulty: 20, intent: "commercial" },
        { phrase: "asphalt repair pocatello", monthlyVolume: 0, difficulty: null, intent: null },
      ],
    });
    const stored = await pool!.query<{ keyword_suggestions: unknown }>("select keyword_suggestions from site where id = 'site-pocatello'");
    expect(stored.rows[0].keyword_suggestions).toEqual(set);
  });

  it("counts one DataForSEO lookup on the connection per suggestion run", async () => {
    const counted = await pool!.query<{ lookups_this_month: number; lookups_month: string }>("select lookups_this_month, lookups_month::text from dataforseo_connection where organization_id = $1", [organizationId]);
    expect(counted.rows[0]).toEqual({ lookups_this_month: 1, lookups_month: "2026-10-01" });
  });

  it("serves the cached set without calling either provider and hides a suggestion once it is tracked", async () => {
    await pool!.query("insert into site_keyword (id, site_id, phrase, weight, created_at, updated_at) values ('keyword-added', 'site-pocatello', 'Sealcoating Pocatello', 3, now(), now())");
    now = new Date("2026-10-26T09:00:00.000Z");

    const set = await discovery().suggest("site-pocatello");

    expect(structuredRequests).toHaveLength(1);
    expect(overviewQueries).toHaveLength(1);
    expect(set.suggestedAt).toBe("2026-10-25T15:00:00.000Z");
    expect(set.suggestions.map((suggestion) => suggestion.phrase)).toEqual(["driveway paving pocatello idaho", "pocatello asphalt contractor", "asphalt repair pocatello"]);
  });

  it("asks both providers again on refresh and replaces the cached set", async () => {
    proposedPhrases = ["pocatello asphalt contractor", "sealcoating pocatello", "asphalt paving pocatello"];

    const set = await discovery().suggest("site-pocatello", { refresh: true });

    expect(structuredRequests).toHaveLength(2);
    expect((await pool!.query<{ lookups_this_month: number }>("select lookups_this_month from dataforseo_connection where organization_id = $1", [organizationId])).rows[0].lookups_this_month).toBe(2);
    expect(structuredRequests[1].input).toContain("sealcoating pocatello");
    expect(overviewQueries[1]).toEqual({ keywords: ["pocatello asphalt contractor"], locationCode: 1016141, languageCode: "en" });
    expect(set).toEqual({ suggestedAt: "2026-10-26T09:00:00.000Z", suggestions: [{ phrase: "pocatello asphalt contractor", monthlyVolume: 90, difficulty: 20, intent: "commercial" }] });
    const stored = await pool!.query<{ keyword_suggestions: unknown }>("select keyword_suggestions from site where id = 'site-pocatello'");
    expect(stored.rows[0].keyword_suggestions).toEqual(set);
  });

  it("refuses a Site whose Business has no niche before calling any provider", async () => {
    await expect(discovery().suggest("site-st-george")).rejects.toMatchObject({ name: "KeywordDiscoveryError", code: "business_niche_missing" });
    expect(structuredRequests).toHaveLength(2);
    expect(overviewQueries).toHaveLength(2);
  });

  it("refuses a Client Viewer and answers Not Found for a Site outside the Organization", async () => {
    await expect(discovery(viewerActor()).suggest("site-pocatello")).rejects.toMatchObject({ name: "AuthorizationError", status: 403 });
    await expect(discovery().suggest("site-missing")).rejects.toBeInstanceOf(KeywordDiscoveryError);
    await expect(discovery().suggest("site-missing")).rejects.toMatchObject({ code: "not_found" });
  });

  it("reports unreadable OpenAI output and keeps the cached set", async () => {
    responderText = "not json";

    await expect(discovery().suggest("site-pocatello", { refresh: true })).rejects.toMatchObject({ name: "KeywordDiscoveryError", code: "invalid_output" });

    responderText = null;
    const stored = await pool!.query<{ keyword_suggestions: KeywordSuggestionSet }>("select keyword_suggestions from site where id = 'site-pocatello'");
    expect(stored.rows[0].keyword_suggestions.suggestedAt).toBe("2026-10-26T09:00:00.000Z");
    expect(overviewQueries).toHaveLength(2);
  });
});
