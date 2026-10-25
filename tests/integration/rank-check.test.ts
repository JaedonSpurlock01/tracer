/**
 * -------------------------------------------------------------------------
 * @file   rank-check.test.ts
 * @brief  Verifies the daily rank check against a fake DataForSEO client.
 *
 * @description
 *  Runs the check as the runtime role: every live Keyword of every linked
 *  Site with a Service Area is looked up once from its Service Area, the
 *  Site's position is the first organic item on its primary hostname with
 *  or without www, the top ten results and the lookup count are stored, a
 *  rerun within the day never queries a Keyword again, a Site without a
 *  Service Area or an open Site Link is skipped, one Keyword's provider
 *  failure never stops the others and is recorded on the connection, the
 *  month's lookups reset when the month changes, and the check stops
 *  cleanly without a connection.
 *
 * @see
 *  data/rank-check.ts
 *  trigger/rank-check.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { encryptSecret } from "@/data/credential-encryption";
import { DataForSeoClientError, type DataForSeoClient, type DataForSeoSerpItem, type DataForSeoSerpQuery } from "@/data/dataforseo-client";
import { migrateDatabase } from "@/data/migrate";
import { masterKeyFingerprint } from "@/data/provider-credential";
import { checkRankings } from "@/data/rank-check";
import { provisionRuntimeRole, runtimeRole } from "@/data/runtime-role";

const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const password = "fleet-synthetic-dataforseo-password";

let container: StartedPostgreSqlContainer | undefined;
let owner: Pool | undefined;
let runtime: Pool | undefined;

const queries: { login: string; query: DataForSeoSerpQuery }[] = [];
const failing = new Set<string>();

function competitor(position: number): DataForSeoSerpItem {
  return { position, type: "organic", domain: `competitor-${position}.example`, url: `https://competitor-${position}.example/`, title: `Competitor ${position}` };
}

const results: Record<string, DataForSeoSerpItem[]> = {
  "asphalt paving pocatello": [competitor(1), competitor(2), { position: 4, type: "organic", domain: "www.pocatelloasphaltpaving.com", url: "https://www.pocatelloasphaltpaving.com/services", title: "Services" }, competitor(5)],
  "driveway paving pocatello": [competitor(1), competitor(2), competitor(3)],
  "paving contractor pocatello": Array.from({ length: 14 }, (_, index): DataForSeoSerpItem =>
    index === 2
      ? { position: 3, type: "local_pack", domain: "pocatelloasphaltpaving.com", url: "https://pocatelloasphaltpaving.com/", title: "Pocatello Asphalt Paving" }
      : index === 11
        ? { position: 12, type: "organic", domain: "pocatelloasphaltpaving.com", url: "https://pocatelloasphaltpaving.com/", title: "Home" }
        : competitor(index + 1)),
  "asphalt paving st george": [{ position: 1, type: "organic", domain: "asphaltpavingstgeorge.com", url: "https://asphaltpavingstgeorge.com/", title: "St George Asphalt" }],
};

const dataforseo: DataForSeoClient = {
  async verify(credential) { return { login: credential.login }; },
  async serp(credential, query) {
    queries.push({ login: credential.login, query });
    if (failing.has(query.keyword)) throw new DataForSeoClientError("task_failed", 40501, "Invalid Field: 'location_name'.");
    return { items: results[query.keyword] ?? [] };
  },
  async listLocations() { throw new Error("not implemented"); },
};

function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

async function check(now: Date, organizationId?: string) {
  return checkRankings({ pool: runtime!, dataforseo, masterKey, now, organizationId });
}

async function rankStatus(keywordId: string) {
  return (await owner!.query<{ day: string; check_status: string; failure_reason: string | null; matched_type: string | null }>(
    "select day::text as day, check_status, failure_reason, matched_type from keyword_rank_day where site_keyword_id = $1 order by day",
    [keywordId],
  )).rows;
}
async function rankDays(keywordId: string) {
  return (await owner!.query<{ day: string; position: number | null; ranking_url: string | null; top_results: unknown[]; checked_at: Date }>(
    "select day::text as day, position, ranking_url, top_results, checked_at from keyword_rank_day where site_keyword_id = $1 order by day",
    [keywordId],
  )).rows;
}

const firstRun = new Date(`${new Date().toISOString().slice(0, 10)}T01:00:00.000Z`);
const sameDay = new Date(firstRun.getTime() + 60 * 60 * 1000);
const nextDay = new Date(firstRun.getTime() + 24 * 60 * 60 * 1000);

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  await migrateDatabase(container.getConnectionUri());
  owner = new Pool({ connectionString: container.getConnectionUri() });
  const runtimePassword = "D".repeat(64);
  await provisionRuntimeRole(owner, runtimePassword);
  const runtimeUrl = new URL(container.getConnectionUri());
  runtimeUrl.username = runtimeRole;
  runtimeUrl.password = runtimePassword;
  runtime = new Pool({ connectionString: runtimeUrl.toString() });
  await owner.query("insert into organization (id, name, slug, created_at) values ('fleet', 'fleet', 'fleet', now()), ('solo', 'solo', 'solo', now())");
  await owner.query(`insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at) values ('fleet-operator', 'Fleet Operator', 'fleet-operator@example.com', true, 'Active', 'America/Chicago', now(), now())`);
  await owner.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, created_at, updated_at) values
       ('north', 'fleet', 'North Paving', 'America/Chicago', 'Active', now(), now()),
       ('south', 'fleet', 'South Paving', 'America/Chicago', 'Active', now(), now()),
       ('west', 'fleet', 'West Paving', 'America/Chicago', 'Active', now(), now()),
       ('solo-space', 'solo', 'Solo Solar', 'America/Chicago', 'Active', now(), now())`,
  );
  await owner.query(
    `insert into site (id, organization_id, script_name, primary_hostname, zone_id, service_area_city, service_area_region, service_area_country, first_seen_at, last_seen_at, created_at, updated_at) values
       ('site-pocatello', 'fleet', 'paving-pocatello', 'pocatelloasphaltpaving.com', 'zone-1', 'Pocatello', 'Idaho', 'United States', now(), now(), now(), now()),
       ('site-st-george', 'fleet', 'paving-st-george', 'asphaltpavingstgeorge.com', 'zone-2', 'St. George', 'Utah', 'United States', now(), now(), now(), now()),
       ('site-no-area', 'fleet', 'paving-blackfoot', 'asphaltpavingblackfoot.com', 'zone-3', null, null, 'United States', now(), now(), now(), now()),
       ('site-unlinked', 'fleet', 'paving-unlinked', 'unlinked.example', 'zone-4', 'Boise', 'Idaho', 'United States', now(), now(), now(), now()),
       ('site-solo', 'solo', 'solar', 'carsoncitysolar.com', 'zone-5', 'Carson City', 'Nevada', 'United States', now(), now(), now(), now())`,
  );
  await owner.query("update site set service_area_location_code = 1026339, service_area_location_name = 'St. George,Utah,United States' where id = 'site-st-george'");
  await owner.query(
    `insert into site_link (id, organization_id, site_id, workspace_id, started_at, started_by_user_id) values
       ('link-1', 'fleet', 'site-pocatello', 'north', now(), 'fleet-operator'),
       ('link-2', 'fleet', 'site-st-george', 'south', now(), 'fleet-operator'),
       ('link-3', 'fleet', 'site-no-area', 'west', now(), 'fleet-operator'),
       ('link-5', 'solo', 'site-solo', 'solo-space', now(), 'fleet-operator')`,
  );
  await owner.query(
    `insert into site_keyword (id, site_id, phrase, weight, created_at, updated_at, removed_at) values
       ('kw-paving', 'site-pocatello', 'asphalt paving pocatello', 5, now(), now(), null),
       ('kw-driveway', 'site-pocatello', 'driveway paving pocatello', 1, now(), now(), null),
       ('kw-contractor', 'site-pocatello', 'paving contractor pocatello', 2, now(), now(), null),
       ('kw-removed', 'site-pocatello', 'removed phrase', 1, now(), now(), now()),
       ('kw-st-george', 'site-st-george', 'asphalt paving st george', 3, now(), now(), null),
       ('kw-no-area', 'site-no-area', 'asphalt paving blackfoot', 1, now(), now(), null),
       ('kw-unlinked', 'site-unlinked', 'paving boise', 1, now(), now(), null),
       ('kw-solo', 'site-solo', 'solar carson city', 1, now(), now(), null)`,
  );
  await owner.query(
    `insert into dataforseo_connection (id, organization_id, login, password_ciphertext, connected_by_user_id, connected_at, last_verified_at, lookups_this_month, lookups_month, created_at, updated_at)
     values ('fleet-connection', 'fleet', 'fleet@example.com', $1, 'fleet-operator', now(), now(), 40, (date_trunc('month', current_date) - interval '1 month')::date, now(), now())`,
    [await encryptSecret(masterKey, password)],
  );
    await owner.query("update dataforseo_connection set master_key_fingerprint = $1 where master_key_fingerprint is null", [await masterKeyFingerprint(masterKey)]);
}, 120_000);

afterAll(async () => {
  await runtime?.end();
  await owner?.end();
  await container?.stop();
});

describe.sequential("Rank check", () => {
  it("looks up every live Keyword of every linked Site with a Service Area once and stores positions, URLs, and the top ten", async () => {
    expect(await check(firstRun)).toEqual({ sites: 2, keywords: 4, checked: 4, failed: 0 });
    expect(queries.map((entry) => entry.query.keyword).sort()).toEqual(["asphalt paving pocatello", "asphalt paving st george", "driveway paving pocatello", "paving contractor pocatello"]);
    expect(queries[0]).toMatchObject({ login: "fleet@example.com", query: { languageCode: "en", depth: 100 } });
    expect(queries.find((entry) => entry.query.keyword === "asphalt paving pocatello")?.query.locationName).toBe("Pocatello,Idaho,United States");
    expect(queries.find((entry) => entry.query.keyword === "asphalt paving st george")?.query).toMatchObject({ locationCode: 1026339 });
    expect(queries.find((entry) => entry.query.keyword === "asphalt paving st george")?.query.locationName).toBeUndefined();
    expect(await rankDays("kw-paving")).toEqual([{ day: utcDay(firstRun), position: 4, ranking_url: "https://www.pocatelloasphaltpaving.com/services", top_results: results["asphalt paving pocatello"], checked_at: firstRun }]);
    expect(await rankStatus("kw-paving")).toEqual([{ day: utcDay(firstRun), check_status: "checked", failure_reason: null, matched_type: "organic" }]);
    expect(await rankDays("kw-driveway")).toEqual([{ day: utcDay(firstRun), position: null, ranking_url: null, top_results: results["driveway paving pocatello"], checked_at: firstRun }]);
    expect(await rankStatus("kw-driveway")).toEqual([{ day: utcDay(firstRun), check_status: "checked", failure_reason: null, matched_type: null }]);
    const contractor = await rankDays("kw-contractor");
    expect(contractor[0]).toMatchObject({ position: 3, ranking_url: "https://pocatelloasphaltpaving.com/" });
    expect(await rankStatus("kw-contractor")).toEqual([{ day: utcDay(firstRun), check_status: "checked", failure_reason: null, matched_type: "local_pack" }]);
    expect(contractor[0].top_results).toEqual(results["paving contractor pocatello"].slice(0, 10));
    expect(await rankDays("kw-st-george")).toEqual([{ day: utcDay(firstRun), position: 1, ranking_url: "https://asphaltpavingstgeorge.com/", top_results: results["asphalt paving st george"], checked_at: firstRun }]);
    for (const skipped of ["kw-removed", "kw-no-area", "kw-unlinked", "kw-solo"]) expect(await rankDays(skipped), skipped).toEqual([]);
    const connection = (await owner!.query("select lookups_this_month, lookups_month::text as lookups_month, last_checked_at, last_failure_at from dataforseo_connection where organization_id = 'fleet'")).rows[0];
    expect(connection).toEqual({ lookups_this_month: 4, lookups_month: `${utcDay(firstRun).slice(0, 7)}-01`, last_checked_at: firstRun, last_failure_at: null });
  });

  it("never queries a Keyword twice in a day and picks up a Keyword added later in the day", async () => {
    queries.length = 0;
    expect(await check(sameDay)).toEqual({ sites: 2, keywords: 4, checked: 0, failed: 0 });
    expect(queries).toEqual([]);
    await owner!.query("insert into site_keyword (id, site_id, phrase, weight, created_at, updated_at) values ('kw-late', 'site-pocatello', 'late phrase', 1, now(), now())");
    expect(await check(sameDay)).toEqual({ sites: 2, keywords: 5, checked: 1, failed: 0 });
    expect(queries.map((entry) => entry.query.keyword)).toEqual(["late phrase"]);
    expect(await rankDays("kw-late")).toEqual([{ day: utcDay(sameDay), position: null, ranking_url: null, top_results: [], checked_at: sameDay }]);
    expect((await owner!.query("select lookups_this_month from dataforseo_connection where organization_id = 'fleet'")).rows[0].lookups_this_month).toBe(5);
    expect(await rankDays("kw-paving")).toHaveLength(1);
  });

  it("records a failed check on the rank day with the provider's reason and on the connection, keeps checking the other Keywords, and retries the failed Keyword", async () => {
    queries.length = 0;
    failing.add("driveway paving pocatello");
    expect(await check(nextDay)).toEqual({ sites: 2, keywords: 5, checked: 4, failed: 1 });
    expect(await rankDays("kw-driveway")).toHaveLength(2);
    expect((await rankStatus("kw-driveway")).at(-1)).toEqual({ day: utcDay(nextDay), check_status: "failed", failure_reason: "DataForSEO rejected the task (40501): Invalid Field: 'location_name'.", matched_type: null });
    expect(await rankDays("kw-paving")).toHaveLength(2);
    expect(await rankDays("kw-st-george")).toHaveLength(2);
    const connection = (await owner!.query("select lookups_this_month, last_failure_detail, last_checked_at from dataforseo_connection where organization_id = 'fleet'")).rows[0];
    expect(connection).toEqual({ lookups_this_month: 9, last_failure_detail: "DataForSEO rejected the task (40501): Invalid Field: 'location_name'.", last_checked_at: nextDay });
    failing.clear();
    expect(await check(nextDay)).toEqual({ sites: 2, keywords: 5, checked: 1, failed: 0 });
    expect(await rankDays("kw-driveway")).toHaveLength(2);
    expect((await rankStatus("kw-driveway")).at(-1)).toEqual({ day: utcDay(nextDay), check_status: "checked", failure_reason: null, matched_type: null });
  });

  it("stops cleanly for an Organization without a DataForSEO connection", async () => {
    queries.length = 0;
    expect(await check(nextDay, "solo")).toEqual({ sites: 0, keywords: 0, checked: 0, failed: 0 });
    await owner!.query("delete from dataforseo_connection");
    expect(await check(nextDay)).toEqual({ sites: 0, keywords: 0, checked: 0, failed: 0 });
    expect(queries).toEqual([]);
  });
});
