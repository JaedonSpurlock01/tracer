/**
 * -------------------------------------------------------------------------
 * @file   cost-revenue.test.ts
 * @brief  Verifies the cost and revenue query service against seeded usage.
 *
 * @description
 *  Seeds one Organization with an Active Workspace in UTC that has a
 *  linked Site, a prorated Number Assignment, Calls with Recordings,
 *  Transcripts, Lead Assessments, Lead Reviews, rank days, and a Domain
 *  renewal, an Active Workspace in Chicago whose only Call starts in the
 *  last local half hour of the month, and a Setup Required Workspace, and
 *  reproduces each Workspace's October 2026 Telephony, Processing,
 *  Hosting, Search, Domain, cost, revenue, profit, Good Leads, and Cost
 *  per Good Lead by hand from the rate table. Shared hosting splits
 *  evenly across Active Workspaces only, Per Lead revenue follows Good
 *  Leads with Lead Review precedence, a stored usage cost wins over the
 *  fallback rate, the totals helper sums the scope, and a Client Viewer
 *  is refused.
 *
 * @remarks
 *  Rows are seeded directly in the shape their writers persist, because
 *  those writers have their own suites.
 *
 * @see
 *  data/cost-revenue.ts
 *  data/pricing.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./test-database";

import type { OpenedDatabase } from "@/data/database";
import type { Actor } from "@/data/authorization";
import { generateInitialCallFlow } from "@/data/call-flow";
import { calendarMonth, costRevenueTotals, createCostRevenue, monthLabel } from "@/data/cost-revenue";
import { migrateDatabase } from "@/data/migrate";

let container: StartedPostgreSqlContainer | undefined;
let database: OpenedDatabase | undefined;

const organizationId = "paving-co";
const october = { year: 2026, month: 10 };
const operator: Actor = { organizationId, userId: "operator", name: "Operator", email: "operator@example.com", timezone: "America/Chicago", state: "Active", role: "Operator" };
const viewer: Actor = { ...operator, userId: "viewer", role: "Client Viewer" };

const graph = generateInitialCallFlow({ destinationNumber: "+14155550199", recordingEnabled: true, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });
let sequence = 0;

async function seedWorkspace(id: string, timezone: string, state: string, assignmentStartedAt: string | null): Promise<void> {
  await database!.query(
    "insert into workspace (id, organization_id, name, reporting_timezone, state, recording_enabled, created_at, updated_at) values ($1, $2, $1, $3, $4, true, now(), now())",
    [id, organizationId, timezone, state],
  );
  await database!.query("insert into flow_version (id, organization_id, workspace_id, version, graph, published_at) values ($1, $2, $3, 1, $4, now())", [`${id}-flow`, organizationId, id, JSON.stringify(graph)]);
  if (!assignmentStartedAt) return;
  sequence += 1;
  await database!.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ($1, $2, $3, $4, 'Tracking Number', true, now(), now(), now(), now())`,
    [`${id}-number`, organizationId, `PN${String(sequence).padStart(32, "0")}`, `+1415555010${sequence}`],
  );
  await database!.query(
    "insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at) values ($1, $2, $3, $4, $5, $6::timestamptz, now())",
    [`${id}-assignment`, organizationId, id, `${id}-number`, `+1415555010${sequence}`, assignmentStartedAt],
  );
}

interface SeedCall {
  id: string;
  workspaceId: string;
  startedAt: string;
  totalSeconds: number;
  connectedSeconds?: number;
  recording?: { seconds: number; wavBytes: number; mp3Bytes: number; transcriptCostUsd: number | null; audioMs: number; assessment: { classification: string; costUsd: number } | null; deleted?: boolean };
  review?: string;
}

async function seedCall(input: SeedCall): Promise<void> {
  sequence += 1;
  const answered = input.connectedSeconds !== undefined;
  await database!.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, caller_number, state, outcome, outcome_reason,
                       started_at, answered_at, ended_at, duration_seconds, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, '+14155550000', '+13125550142', 'Completed', $7, 'flow_outcome', $8::timestamptz,
             case when $9::boolean then $8::timestamptz + make_interval(secs => $10::int - $11::int) end, $8::timestamptz + make_interval(secs => $10::int), $10::int, now(), now())`,
    [input.id, organizationId, input.workspaceId, `${input.workspaceId}-assignment`, `${input.workspaceId}-flow`, `CA${String(sequence).padStart(32, "0")}`, answered ? "Answered" : "Missed", input.startedAt, answered, input.totalSeconds, input.connectedSeconds ?? 0],
  );
  const recording = input.recording;
  if (recording) {
    await database!.query(
      `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, transfer_state, r2_object_key, size_bytes, sha256, stored_at,
                              mp3_state, mp3_object_key, mp3_size_bytes, mp3_generated_at, transcript_state, transcript_audio_ms, transcript_cost_usd, transcript_completed_at, lead_assessment_state, media_deleted_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, 'connected', 2, $6, 'Stored', $1 || '.wav', $7, 'checksum', now(), 'Stored', $1 || '.mp3', $8, now(), 'Completed', $9, $10, now(), $11, case when $12 then now() end, now(), now())`,
      [`${input.id}-recording`, organizationId, input.workspaceId, input.id, `RE${String(sequence).padStart(32, "0")}`, recording.seconds, recording.wavBytes, recording.mp3Bytes, recording.audioMs, recording.transcriptCostUsd, recording.assessment ? "Completed" : "Pending", recording.deleted ?? false],
    );
    if (recording.assessment) {
      await database!.query(
        `insert into lead_assessment (id, organization_id, call_id, recording_id, classification, score, summary, rationale, model, input_tokens, output_tokens, cost_usd, processed_at)
         values ($1, $2, $3, $4, $5, 70, 'Caller asked for a quote.', 'Clear service need.', 'gpt-5-mini', 6000, 400, $6, now())`,
        [`${input.id}-assessment`, organizationId, input.id, `${input.id}-recording`, recording.assessment.classification, recording.assessment.costUsd],
      );
    }
  }
  if (input.review) {
    await database!.query("insert into lead_review (call_id, organization_id, classification, reviewed_at) values ($1, $2, $3, now())", [input.id, organizationId, input.review]);
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  database = createTestDatabase(container.getConnectionUri());
  await migrateDatabase(container.getConnectionUri());
  await database.query("insert into organization (id, name, slug, created_at) values ($1, $1, $1, now()), ('other-org', 'other-org', 'other-org', now())", [organizationId]);
  await seedWorkspace("pocatello", "UTC", "Active", "2026-10-16T00:00:00Z");
  await seedWorkspace("chicago", "America/Chicago", "Active", "2026-10-01T05:00:00Z");
  await seedWorkspace("setup", "UTC", "Setup Required", null);
  await database.query("insert into workspace (id, organization_id, name, reporting_timezone, state, created_at, updated_at) values ('foreign', 'other-org', 'Foreign', 'UTC', 'Active', now(), now())");
  await seedCall({ id: "two-hour", workspaceId: "pocatello", startedAt: "2026-10-05T10:00:00Z", totalSeconds: 7200, connectedSeconds: 7200, recording: { seconds: 7200, wavBytes: 230_400_000, mp3Bytes: 57_600_000, transcriptCostUsd: 1.44, audioMs: 14_400_000, assessment: { classification: "Good Lead", costUsd: 0.0023 } } });
  await seedCall({ id: "missed", workspaceId: "pocatello", startedAt: "2026-10-06T10:00:00Z", totalSeconds: 45 });
  await seedCall({ id: "reviewed-down", workspaceId: "pocatello", startedAt: "2026-10-07T10:00:00Z", totalSeconds: 100, connectedSeconds: 90, recording: { seconds: 90, wavBytes: 2_880_000, mp3Bytes: 720_000, transcriptCostUsd: null, audioMs: 180_000, assessment: { classification: "Good Lead", costUsd: 0.0021 } }, review: "Not Good Lead" });
  await seedCall({ id: "september", workspaceId: "pocatello", startedAt: "2026-09-30T23:59:00Z", totalSeconds: 600, connectedSeconds: 590, recording: { seconds: 590, wavBytes: 18_880_000, mp3Bytes: 4_720_000, transcriptCostUsd: 0.12, audioMs: 1_180_000, assessment: { classification: "Good Lead", costUsd: 0.002 } } });
  await seedCall({ id: "reviewed-up", workspaceId: "pocatello", startedAt: "2026-10-20T10:00:00Z", totalSeconds: 30, connectedSeconds: 30, recording: { seconds: 30, wavBytes: 960_000, mp3Bytes: 240_000, transcriptCostUsd: 0.006, audioMs: 60_000, assessment: { classification: "Uncertain", costUsd: 0.0005 } }, review: "Good Lead" });
  await seedCall({ id: "purged", workspaceId: "pocatello", startedAt: "2026-10-21T10:00:00Z", totalSeconds: 0, connectedSeconds: 0, recording: { seconds: 0, wavBytes: 100_000_000, mp3Bytes: 0, transcriptCostUsd: 0, audioMs: 0, assessment: null, deleted: true } });
  await seedCall({ id: "late-chicago", workspaceId: "chicago", startedAt: "2026-11-01T04:30:00Z", totalSeconds: 30 });
  await database.query(
    `insert into site (id, organization_id, script_name, primary_hostname, zone_id, domain_registrar, domain_renewal_cents, domain_renews_on, first_seen_at, last_seen_at, created_at, updated_at)
     values ('site-pocatello', $1, 'asphalt-paving-pocatello', 'pocatelloasphaltpaving.com', 'zone-1', 'Porkbun', 1299, '2027-03-14', now(), now(), now(), now())`,
    [organizationId],
  );
  await database.query("insert into site_link (id, organization_id, site_id, workspace_id, started_at) values ('link-pocatello', $1, 'site-pocatello', 'pocatello', now())", [organizationId]);
  await database.query(
    `insert into site_keyword (id, site_id, phrase, weight, created_at, updated_at, removed_at) values
       ('keyword-live', 'site-pocatello', 'asphalt paving pocatello', 1, now(), now(), null),
       ('keyword-removed', 'site-pocatello', 'driveway paving pocatello', 1, now(), now(), now())`,
  );
  await database.query(
    `insert into keyword_rank_day (id, site_keyword_id, day, position, checked_at)
     select 'live-' || d, 'keyword-live', ('2026-10-01'::date + d), 3, now() from generate_series(0, 19) d
     union all select 'live-september', 'keyword-live', '2026-09-30', 3, now()
     union all select 'removed-' || d, 'keyword-removed', ('2026-10-01'::date + d), null, now() from generate_series(0, 4) d`,
  );
  await database.query(
    `insert into deal (id, organization_id, workspace_id, kind, amount_cents, started_on, ended_on, created_at, updated_at) values
       ('deal-pocatello-old', $1, 'pocatello', 'Monthly', 99900, '2026-01-01', '2026-09-30', now(), now()),
       ('deal-pocatello', $1, 'pocatello', 'Per Lead', 2500, '2026-10-01', null, now(), now()),
       ('deal-chicago', $1, 'chicago', 'Weekly', 10000, '2026-10-01', null, now(), now()),
       ('deal-setup', $1, 'setup', 'Monthly', 50000, '2026-10-01', null, now(), now())`,
    [organizationId],
  );
}, 120_000);

afterAll(async () => {
  await database?.close();
  await container?.stop();
});

describe("cost and revenue", () => {
  it("resolves the calendar month in a timezone and labels it", () => {
    expect(calendarMonth(new Date("2026-11-01T04:30:00Z"), "America/Chicago")).toEqual({ year: 2026, month: 10 });
    expect(calendarMonth(new Date("2026-11-01T04:30:00Z"), "UTC")).toEqual({ year: 2026, month: 11 });
    expect(monthLabel(october)).toBe("October 2026");
  });

  it("reproduces the worked October cost, revenue, and profit of each Workspace from the rate table", async () => {
    const monthly = await createCostRevenue(database!, operator).monthly(["pocatello", "chicago", "setup", "foreign", "missing"], october);
    expect(Object.keys(monthly).sort()).toEqual(["chicago", "pocatello", "setup"]);
    expect(monthly.pocatello).toEqual({
      workspaceId: "pocatello",
      telephonyCents: 368,
      processingCents: 147,
      hostingCents: 250,
      searchCents: 5,
      domainCents: 108,
      costCents: 878,
      revenueCents: 5000,
      profitCents: 4122,
      goodLeads: 2,
      costPerGoodLeadCents: 439,
      deal: expect.objectContaining({ id: "deal-pocatello", kind: "Per Lead", amountCents: 2500, startedOn: "2026-10-01", endedOn: null }),
    });
    expect(monthly.chicago).toEqual({
      workspaceId: "chicago",
      telephonyCents: 116,
      processingCents: 0,
      hostingCents: 250,
      searchCents: 0,
      domainCents: 0,
      costCents: 366,
      revenueCents: 43_333,
      profitCents: 42_967,
      goodLeads: 0,
      costPerGoodLeadCents: null,
      deal: expect.objectContaining({ id: "deal-chicago", kind: "Weekly" }),
    });
    expect(monthly.setup).toMatchObject({ telephonyCents: 0, hostingCents: 0, costCents: 0, revenueCents: 50_000, profitCents: 50_000, goodLeads: 0, costPerGoodLeadCents: null });
    expect(costRevenueTotals(Object.values(monthly))).toEqual({ costCents: 1244, yearlyCostCents: 14_928, revenueCents: 98_333, profitCents: 97_089 });
  });

  it("prices September from its own Calls and the Deal open then", async () => {
    const monthly = await createCostRevenue(database!, operator).monthly(["pocatello"], { year: 2026, month: 9 });
    expect(monthly.pocatello).toMatchObject({ telephonyCents: 25, processingCents: 12, goodLeads: 1, searchCents: 0, domainCents: 108 });
    expect(monthly.pocatello.revenueCents).toBe(2500);
  });

  it("refuses a Client Viewer", async () => {
    expect(() => createCostRevenue(database!, viewer)).toThrow(/Operator/);
  });
});
