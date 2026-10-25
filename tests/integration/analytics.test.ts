/**
 * -------------------------------------------------------------------------
 * @file   analytics.test.ts
 * @brief  Verifies the analytics query service against fixed, non-round Call datasets.
 *
 * @description
 *  Seeds Workspaces in different reporting timezones with known Calls and
 *  checks the dashboard KPIs: Total Calls counts every Call started in the
 *  range, In Progress included; Answer Rate divides Answered Calls by Calls
 *  with a Forwarding attempted event, so Voicemail, Blocked, and spam-gate
 *  failures stay out of it; Good Leads follow Lead Review before Lead
 *  Assessment; and Average Connected Duration averages Answered Calls only.
 *  Each KPI compares with the equal prior window, with none for All Time;
 *  counts and durations change relatively, with no change against a zero
 *  prior, and Answer Rate changes in percentage points. Trend points are zero-filled daily,
 *  weekly Monday through Sunday, or monthly buckets in the user's or the
 *  Workspace's timezone, including across midnight and a daylight saving
 *  change. Workspace performance appears only for an actor who reads more
 *  than one Workspace, and no aggregate ever counts an ungranted Workspace
 *  or another Organization. The Workspaces list stats and routing health
 *  report 30-day Calls and Good Leads, the last Call, and webhook health
 *  from recorded voice provider events. Totals and Good Leads match the
 *  Calls list for the same scope and Started dates. Report analytics read
 *  a job's Workspaces, window, and timezone with Lead Rate, the Call
 *  Outcome and effective Lead classification distributions, notable Good
 *  Leads by AI lead score then recency up to a limit, and a Workspace
 *  comparison only for several Workspaces of the job's Organization.
 *
 * @remarks
 *  Calls, Call events, Recordings, Lead Assessments, Lead Reviews, and
 *  provider events are seeded directly in the shape their writers persist,
 *  because those writers have their own suites. Actors are built directly
 *  because authorization here is the readable Workspace SQL condition,
 *  which checks Organization and Access Grants in the database; session
 *  resolution has its own suites. The clock is fixed at
 *  2026-10-18T17:00:00Z, noon in Chicago.
 *
 * @see
 *  data/analytics.ts
 *  data/analytics-range.ts
 *  data/calls.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestPool } from "./test-pool";

import { createAnalytics, describeWorkspaceAttention, reportAnalyticsSummary, withWorkspaceListStats, type Analytics, type ReportAnalyticsScope } from "@/data/analytics";
import type { AnalyticsRange } from "@/data/analytics-range";
import type { Actor } from "@/data/authorization";
import { generateInitialCallFlow } from "@/data/call-flow";
import { defaultCallSort, emptyCallFilters, type CallFilters } from "@/data/call-list-query";
import { createCallList } from "@/data/calls";
import { migrateDatabase } from "@/data/migrate";

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;

const now = new Date("2026-10-18T17:00:00Z");
const sevenDays: AnalyticsRange = { kind: "days", days: 7 };

const graph = generateInitialCallFlow({
  destinationNumber: "+14155550199",
  recordingEnabled: true,
  spamGateEnabled: false,
  whisperEnabled: false,
  whisperMessage: null,
  disclosureVoice: "Polly.Joanna",
});

function actor(input: { organizationId: string; userId: string; role: Actor["role"]; timezone: string }): Actor {
  return { ...input, name: input.userId, email: `${input.userId}@example.com`, state: "Active" };
}

const operator = actor({ organizationId: "fleet", userId: "fleet-operator", role: "Operator", timezone: "America/Chicago" });
const multiViewer = actor({ organizationId: "fleet", userId: "multi-viewer", role: "Client Viewer", timezone: "UTC" });
const singleViewer = actor({ organizationId: "fleet", userId: "single-viewer", role: "Client Viewer", timezone: "UTC" });
const dstOperator = actor({ organizationId: "dst", userId: "dst-operator", role: "Operator", timezone: "UTC" });

const analytics = (who: Actor) => createAnalytics(pool!, who, { now: () => now });

let sequence = 0;

async function seedOrganization(id: string): Promise<void> {
  await pool!.query("insert into organization (id, name, slug, created_at) values ($1, $1, $1, now())", [id]);
}

async function seedUser(organizationId: string, userId: string, grants: string[]): Promise<void> {
  await pool!.query(
    `insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at) values ($1, $1, $1 || '@example.com', true, 'Active', 'UTC', now(), now())`,
    [userId],
  );
  for (const workspaceId of grants) {
    await pool!.query("insert into access_grant (id, organization_id, workspace_id, user_id, created_at) values ($1, $2, $3, $4, now())", [`${userId}-${workspaceId}`, organizationId, workspaceId, userId]);
  }
}

async function seedWorkspace(input: { organizationId: string; id: string; name: string; timezone: string; state?: string; trackingNumber?: string }): Promise<void> {
  await pool!.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, recording_enabled, created_at, updated_at)
     values ($1, $2, $3, $4, $5, true, now(), now())`,
    [input.id, input.organizationId, input.name, input.timezone, input.state ?? "Active"],
  );
  if (!input.trackingNumber) return;
  await seedAssignment(input.organizationId, input.id, `${input.id}-assignment`, input.trackingNumber, null);
  await pool!.query(
    "insert into flow_version (id, organization_id, workspace_id, version, graph, published_at) values ($1, $2, $3, 1, $4, now())",
    [`${input.id}-flow`, input.organizationId, input.id, JSON.stringify(graph)],
  );
}

async function seedAssignment(organizationId: string, workspaceId: string, id: string, phoneNumber: string, endedReason: string | null): Promise<void> {
  sequence += 1;
  await pool!.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ($1, $2, $3, $4, 'Tracking Number', true, now(), now(), now(), now())`,
    [`${id}-number`, organizationId, `PN${String(sequence).padStart(32, "0")}`, phoneNumber],
  );
  await pool!.query(
    `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, ended_at, ended_reason, created_at)
     values ($1, $2, $3, $4, $5, now() - interval '60 days', case when $6::text is not null then now() - interval '30 days' end, $6, now())`,
    [id, organizationId, workspaceId, `${id}-number`, phoneNumber, endedReason],
  );
}

async function seedVoiceWebhook(organizationId: string, assignmentId: string, receivedAt: string): Promise<void> {
  sequence += 1;
  await pool!.query(
    `insert into provider_event (id, organization_id, number_assignment_id, idempotency_key, kind, disposition, payload, received_at)
     values ($1, $2, $3, $1, 'voice', 'accepted', '{}', $4)`,
    [`voice-${sequence}`, organizationId, assignmentId, receivedAt],
  );
}

type Classification = "Good Lead" | "Not Good Lead" | "Uncertain";

interface SeedCall {
  id: string;
  workspaceId: string;
  startedAt: string;
  outcome: "Answered" | "Voicemail" | "Missed" | "Abandoned" | "Blocked" | "Failed" | "In Progress";
  forwarded?: boolean;
  connectedSeconds?: number;
  assessment?: Classification;
  score?: number;
  review?: Classification;
}

async function seedCall(input: SeedCall): Promise<void> {
  sequence += 1;
  const workspace = (await pool!.query<{ organization_id: string }>("select organization_id from workspace where id = $1", [input.workspaceId])).rows[0];
  const inProgress = input.outcome === "In Progress";
  const answered = input.outcome === "Answered";
  const connected = input.connectedSeconds ?? 0;
  await pool!.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, caller_number,
                       state, outcome, outcome_reason, started_at, answered_at, ended_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, '+14155550000', '+13125550142', $7, $8, $9, $10::timestamptz,
             case when $11 then $10::timestamptz + interval '5 seconds' end,
             case when not $12 then $10::timestamptz + make_interval(secs => $13 + 5) end, now(), now())`,
    [input.id, workspace.organization_id, input.workspaceId, `${input.workspaceId}-assignment`, `${input.workspaceId}-flow`, `CA${String(sequence).padStart(32, "0")}`,
      inProgress ? "In Progress" : "Completed", inProgress ? null : input.outcome, inProgress ? null : "flow_outcome", input.startedAt, answered, inProgress, connected],
  );
  if (input.forwarded) {
    await pool!.query(
      `insert into call_event (organization_id, workspace_id, call_id, kind, occurred_at, detail, idempotency_key)
       values ($1, $2, $3, 'forwarding_attempted', $4::timestamptz + interval '2 seconds', '{}', 'forwarding_attempted:' || $3)`,
      [workspace.organization_id, input.workspaceId, input.id, input.startedAt],
    );
  }
  if (input.assessment) {
    await pool!.query(
      `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, transfer_state, r2_object_key, size_bytes, sha256, stored_at,
                              waveform_state, transcript_state, transcript_audio_ms, transcript_cost_usd, transcript_completed_at, lead_assessment_state, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, 60, 'Stored', $1 || '.wav', 1024, 'checksum', now(), 'Pending', 'Completed', 60000, 0.006, now(), 'Completed', now(), now())`,
      [`${input.id}-recording`, workspace.organization_id, input.workspaceId, input.id, `RE${String(sequence).padStart(32, "0")}`, answered ? "connected" : "voicemail", answered ? 2 : 1],
    );
    await pool!.query(
      `insert into lead_assessment (id, organization_id, call_id, recording_id, classification, score, summary, rationale, model, input_tokens, output_tokens, cost_usd, processed_at)
       values ($1, $2, $3, $4, $5, $6, 'Caller asked for a quote.', 'Clear service need.', 'gpt-5-mini', 900, 120, 0.000465, now())`,
      [`${input.id}-assessment`, workspace.organization_id, input.id, `${input.id}-recording`, input.assessment, input.score ?? 61],
    );
  }
  if (input.review) {
    await pool!.query("insert into lead_review (call_id, organization_id, classification, reviewed_at) values ($1, $2, $3, now())", [input.id, workspace.organization_id, input.review]);
  }
}

const northCurrent: SeedCall[] = [
  { id: "north-a1", workspaceId: "north", startedAt: "2026-10-12T15:00:00Z", outcome: "Answered", forwarded: true, connectedSeconds: 41, assessment: "Good Lead" },
  { id: "north-a2", workspaceId: "north", startedAt: "2026-10-13T04:30:00Z", outcome: "Answered", forwarded: true, connectedSeconds: 67, assessment: "Good Lead", review: "Not Good Lead" },
  { id: "north-a3", workspaceId: "north", startedAt: "2026-10-13T16:00:00Z", outcome: "Answered", forwarded: true, connectedSeconds: 88, assessment: "Uncertain", score: 74, review: "Good Lead" },
  { id: "north-a4", workspaceId: "north", startedAt: "2026-10-14T16:00:00Z", outcome: "Answered", forwarded: true, connectedSeconds: 125, assessment: "Good Lead", score: 88 },
  { id: "north-a5", workspaceId: "north", startedAt: "2026-10-15T16:00:00Z", outcome: "Answered", forwarded: true, connectedSeconds: 203, assessment: "Not Good Lead" },
  { id: "north-a6", workspaceId: "north", startedAt: "2026-10-16T16:00:00Z", outcome: "Answered", forwarded: true, connectedSeconds: 19 },
  { id: "north-a7", workspaceId: "north", startedAt: "2026-10-18T15:00:00Z", outcome: "Answered", forwarded: true, connectedSeconds: 239 },
  { id: "north-m1", workspaceId: "north", startedAt: "2026-10-13T18:00:00Z", outcome: "Missed", forwarded: true },
  { id: "north-m2", workspaceId: "north", startedAt: "2026-10-15T18:00:00Z", outcome: "Missed", forwarded: true },
  { id: "north-ab", workspaceId: "north", startedAt: "2026-10-16T18:00:00Z", outcome: "Abandoned", forwarded: true },
  { id: "north-ip", workspaceId: "north", startedAt: "2026-10-18T16:55:00Z", outcome: "In Progress", forwarded: true },
  { id: "north-v1", workspaceId: "north", startedAt: "2026-10-14T03:00:00Z", outcome: "Voicemail", assessment: "Good Lead" },
  { id: "north-v2", workspaceId: "north", startedAt: "2026-10-17T02:00:00Z", outcome: "Voicemail", assessment: "Not Good Lead", review: "Good Lead" },
  { id: "north-v3", workspaceId: "north", startedAt: "2026-10-17T16:00:00Z", outcome: "Voicemail" },
  { id: "north-b1", workspaceId: "north", startedAt: "2026-10-14T20:00:00Z", outcome: "Blocked" },
  { id: "north-b2", workspaceId: "north", startedAt: "2026-10-17T20:00:00Z", outcome: "Blocked" },
  { id: "north-f1", workspaceId: "north", startedAt: "2026-10-18T13:00:00Z", outcome: "Failed" },
];

const northPrior: SeedCall[] = [
  { id: "north-p1", workspaceId: "north", startedAt: "2026-10-06T15:00:00Z", outcome: "Answered", forwarded: true, connectedSeconds: 30, assessment: "Good Lead" },
  { id: "north-p2", workspaceId: "north", startedAt: "2026-10-08T15:00:00Z", outcome: "Answered", forwarded: true, connectedSeconds: 45 },
  { id: "north-p3", workspaceId: "north", startedAt: "2026-10-09T15:00:00Z", outcome: "Answered", forwarded: true, connectedSeconds: 61, assessment: "Not Good Lead", review: "Good Lead" },
  { id: "north-p4", workspaceId: "north", startedAt: "2026-10-10T15:00:00Z", outcome: "Missed", forwarded: true },
  { id: "north-p5", workspaceId: "north", startedAt: "2026-10-11T15:00:00Z", outcome: "Voicemail" },
  { id: "north-p6", workspaceId: "north", startedAt: "2026-10-12T04:30:00Z", outcome: "Blocked" },
];

const southCurrent: SeedCall[] = [
  { id: "south-1", workspaceId: "south", startedAt: "2026-10-15T10:00:00Z", outcome: "Answered", forwarded: true, connectedSeconds: 100, assessment: "Good Lead" },
  { id: "south-2", workspaceId: "south", startedAt: "2026-10-16T10:00:00Z", outcome: "Answered", forwarded: true, connectedSeconds: 57 },
  { id: "south-3", workspaceId: "south", startedAt: "2026-10-17T10:00:00Z", outcome: "Missed", forwarded: true },
  { id: "south-4", workspaceId: "south", startedAt: "2026-10-18T10:00:00Z", outcome: "Voicemail" },
];

const eastCurrent: SeedCall[] = [1, 2, 3, 4, 5].map((day) => ({
  id: `east-${day}`,
  workspaceId: "east",
  startedAt: `2026-10-1${day + 2}T15:00:00Z`,
  outcome: "Answered" as const,
  forwarded: true,
  connectedSeconds: 500,
  assessment: day <= 3 ? ("Good Lead" as const) : undefined,
}));

const dstCalls: SeedCall[] = [
  { id: "dst-1", workspaceId: "dst-chicago", startedAt: "2026-11-01T04:30:00Z", outcome: "Voicemail" },
  { id: "dst-2", workspaceId: "dst-chicago", startedAt: "2026-11-01T05:30:00Z", outcome: "Voicemail" },
  { id: "dst-3", workspaceId: "dst-chicago", startedAt: "2026-11-01T06:30:00Z", outcome: "Voicemail" },
  { id: "dst-4", workspaceId: "dst-chicago", startedAt: "2026-11-01T07:30:00Z", outcome: "Voicemail" },
  { id: "dst-5", workspaceId: "dst-chicago", startedAt: "2026-11-02T05:30:00Z", outcome: "Voicemail" },
  { id: "dst-6", workspaceId: "dst-chicago", startedAt: "2026-11-02T06:30:00Z", outcome: "Voicemail" },
];

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = createTestPool(container.getConnectionUri());
  await migrateDatabase(container.getConnectionUri());
  for (const id of ["fleet", "other", "dst"]) await seedOrganization(id);
  await seedWorkspace({ organizationId: "fleet", id: "north", name: "North Plumbing", timezone: "America/Chicago", trackingNumber: "+14155550101" });
  await seedWorkspace({ organizationId: "fleet", id: "south", name: "South Dental", timezone: "UTC", trackingNumber: "+14155550102" });
  await seedWorkspace({ organizationId: "fleet", id: "east", name: "East HVAC", timezone: "America/New_York", trackingNumber: "+14155550103" });
  await seedWorkspace({ organizationId: "fleet", id: "setup", name: "Setup Roofing", timezone: "UTC", state: "Setup Required" });
  await seedWorkspace({ organizationId: "other", id: "other-workspace", name: "Other Org", timezone: "UTC", trackingNumber: "+14155550109" });
  await seedWorkspace({ organizationId: "dst", id: "dst-chicago", name: "DST Chicago", timezone: "America/Chicago", trackingNumber: "+14155550110" });
  await seedUser("fleet", "multi-viewer", ["north", "south"]);
  await seedUser("fleet", "single-viewer", ["north"]);
  await pool.query("insert into access_grant (id, organization_id, workspace_id, user_id, created_at) values ('cross-org', 'other', 'other-workspace', 'multi-viewer', now())");
  await seedAssignment("fleet", "south", "south-replaced-assignment", "+14155550199", "replaced");
  await seedVoiceWebhook("fleet", "north-assignment", "2026-10-18T16:55:00Z");
  await seedVoiceWebhook("fleet", "south-replaced-assignment", "2026-09-01T10:00:00Z");
  await seedVoiceWebhook("fleet", "east-assignment", "2026-10-17T15:00:00Z");
  for (const call of [...northCurrent, ...northPrior, ...southCurrent, ...eastCurrent, ...dstCalls]) await seedCall(call);
  await seedCall({ id: "north-old", workspaceId: "north", startedAt: "2026-09-01T15:00:00Z", outcome: "Answered", forwarded: true, connectedSeconds: 75, assessment: "Good Lead" });
  await seedCall({ id: "other-1", workspaceId: "other-workspace", startedAt: "2026-10-15T15:00:00Z", outcome: "Answered", forwarded: true, connectedSeconds: 33, assessment: "Good Lead" });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

const points = (summary: { trend: { points: { start: string; totalCalls: number; answeredCalls: number; goodLeads: number }[] } }) =>
  summary.trend.points.map((point) => [point.start, point.totalCalls, point.answeredCalls, point.goodLeads]);

describe("Workspace KPIs", () => {
  it("count Total Calls, Answer Rate over forwarding attempts, Good Leads with Lead Review precedence, and Average Connected Duration over Answered Calls", async () => {
    const summary = await analytics(operator).summary({ workspaceId: "north", range: sevenDays });
    expect(summary).not.toBeNull();
    expect(summary!.timeZone).toBe("America/Chicago");
    expect(summary!.workspace).toEqual({ id: "north", name: "North Plumbing" });
    expect(summary!.window).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(summary!.previousWindow).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    const { kpis } = summary!;
    expect(kpis.totalCalls.value).toBe(17);
    expect(kpis.answerRate.value).toBeCloseTo(7 / 11, 10);
    expect(kpis.goodLeads.value).toBe(5);
    expect(kpis.averageConnectedSeconds.value).toBeCloseTo(782 / 7, 10);
  });

  it("compare each KPI with the immediately preceding window of equal length", async () => {
    const { kpis } = (await analytics(operator).summary({ workspaceId: "north", range: sevenDays }))!;
    expect(kpis.totalCalls.comparison).toEqual({ previous: 6, change: 11 / 6, unit: "relative" });
    expect(kpis.goodLeads.comparison).toEqual({ previous: 2, change: 1.5, unit: "relative" });
    expect(kpis.answerRate.comparison!.previous).toBeCloseTo(3 / 4, 10);
    expect(kpis.answerRate.comparison!.change).toBeCloseTo(7 / 11 - 3 / 4, 10);
    expect(kpis.answerRate.comparison!.unit).toBe("points");
    expect(kpis.averageConnectedSeconds.comparison!.previous).toBeCloseTo(136 / 3, 10);
    expect(kpis.averageConnectedSeconds.comparison!.change).toBeCloseTo((782 / 7 - 136 / 3) / (136 / 3), 10);
    expect(kpis.averageConnectedSeconds.comparison!.unit).toBe("relative");
  });

  it("report no change against a zero prior window and no rate without a denominator", async () => {
    const { kpis } = (await analytics(operator).summary({ workspaceId: "south", range: sevenDays }))!;
    expect(kpis.totalCalls).toEqual({ value: 4, comparison: { previous: 0, change: null, unit: "relative" } });
    expect(kpis.goodLeads).toEqual({ value: 1, comparison: { previous: 0, change: null, unit: "relative" } });
    expect(kpis.answerRate.value).toBeCloseTo(2 / 3, 10);
    expect(kpis.answerRate.comparison).toEqual({ previous: null, change: null, unit: "points" });
    expect(kpis.averageConnectedSeconds.comparison).toEqual({ previous: null, change: null, unit: "relative" });

    const empty = (await analytics(operator).summary({ workspaceId: "setup", range: sevenDays }))!;
    expect(empty.kpis.totalCalls.value).toBe(0);
    expect(empty.kpis.goodLeads.value).toBe(0);
    expect(empty.kpis.answerRate.value).toBeNull();
    expect(empty.kpis.averageConnectedSeconds.value).toBeNull();
    expect(empty.trend.points.map((point) => point.totalCalls)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("show no comparison for All Time and plot monthly points from the first Call", async () => {
    const summary = (await analytics(operator).summary({ workspaceId: "north", range: { kind: "all" } }))!;
    expect(summary.kpis.totalCalls).toEqual({ value: 24, comparison: null });
    expect(summary.kpis.goodLeads).toEqual({ value: 8, comparison: null });
    expect(summary.previousWindow).toBeNull();
    expect(summary.window).toEqual({ from: "2026-09-01", to: "2026-10-18" });
    expect(summary.trend.interval).toBe("month");
    expect(points(summary)).toEqual([["2026-09-01", 1, 1, 1], ["2026-10-01", 23, 10, 7]]);
    expect(summary.trend.points.map((point) => point.label)).toEqual(["September 2026", "October 2026"]);
  });

  it("answer nothing for an ungranted Workspace or another Organization's Workspace", async () => {
    expect(await analytics(multiViewer).summary({ workspaceId: "east", range: sevenDays })).toBeNull();
    expect(await analytics(multiViewer).summary({ workspaceId: "other-workspace", range: sevenDays })).toBeNull();
    expect(await analytics(operator).summary({ workspaceId: "other-workspace", range: sevenDays })).toBeNull();
  });
});

describe("Trend series", () => {
  it("plot zero-filled daily Total, Answered, and Good Lead points in the Workspace timezone", async () => {
    const summary = (await analytics(operator).summary({ workspaceId: "north", range: sevenDays }))!;
    expect(summary.trend.interval).toBe("day");
    expect(points(summary)).toEqual([
      ["2026-10-12", 2, 2, 1],
      ["2026-10-13", 3, 1, 2],
      ["2026-10-14", 2, 1, 1],
      ["2026-10-15", 2, 1, 0],
      ["2026-10-16", 3, 1, 1],
      ["2026-10-17", 2, 0, 0],
      ["2026-10-18", 3, 1, 0],
    ]);
    expect(summary.trend.points[0]).toMatchObject({ start: "2026-10-12", end: "2026-10-12", label: "Oct 12, 2026" });
  });

  it("resolve the window and buckets in the user's timezone across Workspaces", async () => {
    const summary = (await analytics(multiViewer).summary({ range: sevenDays }))!;
    expect(summary.timeZone).toBe("UTC");
    expect(summary.workspace).toBeNull();
    expect(summary.kpis.totalCalls.value).toBe(22);
    expect(summary.kpis.goodLeads.value).toBe(6);
    expect(summary.kpis.answerRate.value).toBeCloseTo(9 / 14, 10);
    expect(points(summary)).toEqual([
      ["2026-10-12", 2, 1, 1],
      ["2026-10-13", 3, 2, 1],
      ["2026-10-14", 3, 1, 2],
      ["2026-10-15", 3, 2, 1],
      ["2026-10-16", 3, 2, 0],
      ["2026-10-17", 4, 0, 1],
      ["2026-10-18", 4, 1, 0],
    ]);
  });

  it("keep calendar days whole across a daylight saving change", async () => {
    const range: AnalyticsRange = { kind: "custom", from: "2026-10-30", to: "2026-11-03" };
    const workspace = (await analytics(dstOperator).summary({ workspaceId: "dst-chicago", range }))!;
    expect(points(workspace).map(([start, total]) => [start, total])).toEqual([["2026-10-30", 0], ["2026-10-31", 1], ["2026-11-01", 4], ["2026-11-02", 1], ["2026-11-03", 0]]);
    const global = (await analytics(dstOperator).summary({ range }))!;
    expect(points(global).map(([start, total]) => [start, total])).toEqual([["2026-10-30", 0], ["2026-10-31", 0], ["2026-11-01", 4], ["2026-11-02", 2], ["2026-11-03", 0]]);
  });

  it("plot weekly Monday through Sunday points for a custom range over 31 days", async () => {
    const range: AnalyticsRange = { kind: "custom", from: "2026-10-01", to: "2026-11-10" };
    const workspace = (await analytics(dstOperator).summary({ workspaceId: "dst-chicago", range }))!;
    expect(workspace.trend.interval).toBe("week");
    expect(points(workspace).map(([start, total]) => [start, total])).toEqual([["2026-10-01", 0], ["2026-10-05", 0], ["2026-10-12", 0], ["2026-10-19", 0], ["2026-10-26", 5], ["2026-11-02", 1], ["2026-11-09", 0]]);
    const global = (await analytics(dstOperator).summary({ range }))!;
    expect(points(global).map(([start, total]) => [start, total]).slice(4)).toEqual([["2026-10-26", 4], ["2026-11-02", 2], ["2026-11-09", 0]]);
  });
});

describe("Workspace performance", () => {
  it("compares every readable Workspace by Total Calls for an Operator", async () => {
    const summary = (await analytics(operator).summary({ range: sevenDays }))!;
    expect(summary.kpis.totalCalls.value).toBe(26);
    expect(summary.kpis.goodLeads.value).toBe(9);
    expect(summary.workspacePerformance).toEqual([
      { workspace: { id: "north", name: "North Plumbing" }, trackingNumber: "+14155550101", totalCalls: 17, answerRate: 7 / 11, goodLeads: 5, leadRate: 5 / 17 },
      { workspace: { id: "east", name: "East HVAC" }, trackingNumber: "+14155550103", totalCalls: 5, answerRate: 1, goodLeads: 3, leadRate: 3 / 5 },
      { workspace: { id: "south", name: "South Dental" }, trackingNumber: "+14155550102", totalCalls: 4, answerRate: 2 / 3, goodLeads: 1, leadRate: 1 / 4 },
      { workspace: { id: "setup", name: "Setup Roofing" }, trackingNumber: null, totalCalls: 0, answerRate: null, goodLeads: 0, leadRate: null },
    ]);
  });

  it("never counts an ungranted Workspace or another Organization for a multi-Workspace Client Viewer", async () => {
    const summary = (await analytics(multiViewer).summary({ range: sevenDays }))!;
    expect(summary.workspacePerformance).toEqual([
      { workspace: { id: "north", name: "North Plumbing" }, trackingNumber: "+14155550101", totalCalls: 18, answerRate: 7 / 11, goodLeads: 5, leadRate: 5 / 18 },
      { workspace: { id: "south", name: "South Dental" }, trackingNumber: "+14155550102", totalCalls: 4, answerRate: 2 / 3, goodLeads: 1, leadRate: 1 / 4 },
    ]);
  });

  it("is withheld from a single-Workspace viewer and from Workspace scope", async () => {
    const single = (await analytics(singleViewer).summary({ range: sevenDays }))!;
    expect(single.workspacePerformance).toBeNull();
    expect(single.kpis.totalCalls.value).toBe(18);
    expect(single.kpis.goodLeads.value).toBe(5);
    expect((await analytics(operator).summary({ workspaceId: "north", range: sevenDays }))!.workspacePerformance).toBeNull();
  });
});

describe("Consistency with Calls", () => {
  const callsFor = async (who: Actor, workspaceId: string | undefined, filters: Partial<CallFilters>) =>
    (await createCallList(pool!, who).list({ page: 1, sort: defaultCallSort, filters: { ...emptyCallFilters, ...filters }, workspaceId }))!.total;

  it("matches the Calls list Total Calls and Good Leads for the same scope and Started dates", async () => {
    const cases: [Actor, string | undefined, AnalyticsRange][] = [
      [operator, undefined, sevenDays],
      [operator, "north", sevenDays],
      [multiViewer, undefined, sevenDays],
      [singleViewer, undefined, { kind: "days", days: 30 }],
      [dstOperator, "dst-chicago", { kind: "custom", from: "2026-10-31", to: "2026-11-01" }],
      [dstOperator, undefined, { kind: "custom", from: "2026-10-31", to: "2026-11-01" }],
    ];
    for (const [who, workspaceId, range] of cases) {
      const summary = (await analytics(who).summary({ workspaceId, range }))!;
      const dates = { startedFrom: summary.window.from, startedTo: summary.window.to };
      expect(summary.kpis.totalCalls.value).toBe(await callsFor(who, workspaceId, dates));
      expect(summary.kpis.goodLeads.value).toBe(await callsFor(who, workspaceId, { ...dates, leadClassifications: ["Good Lead"] }));
    }
  });
});

describe("Workspaces list stats and routing health", () => {
  it("report 30-day Calls and Good Leads, the last Call, and webhook health from recorded voice webhooks", async () => {
    const stats = await analytics(operator).workspaceListStats(["north", "south", "east", "setup", "other-workspace"]);
    expect(stats).toEqual({
      north: { callsLast30Days: 23, goodLeadsLast30Days: 7, lastCallAt: "2026-10-18T16:55:00.000Z", lastSuccessfulInboundCallAt: "2026-10-18T16:55:00.000Z", integrationHealth: { status: "Healthy", lastAcceptedVoiceWebhookAt: "2026-10-18T16:55:00.000Z" }, siteHealth: null, attention: { status: "Healthy", reason: null } },
      south: { callsLast30Days: 4, goodLeadsLast30Days: 1, lastCallAt: "2026-10-18T10:00:00.000Z", lastSuccessfulInboundCallAt: "2026-10-18T10:00:00.000Z", integrationHealth: { status: "Warning", lastAcceptedVoiceWebhookAt: null }, siteHealth: null, attention: { status: "Needs attention", reason: "No accepted Twilio webhook yet" } },
      east: { callsLast30Days: 5, goodLeadsLast30Days: 3, lastCallAt: "2026-10-17T15:00:00.000Z", lastSuccessfulInboundCallAt: "2026-10-17T15:00:00.000Z", integrationHealth: { status: "Healthy", lastAcceptedVoiceWebhookAt: "2026-10-17T15:00:00.000Z" }, siteHealth: null, attention: { status: "Healthy", reason: null } },
      setup: { callsLast30Days: 0, goodLeadsLast30Days: 0, lastCallAt: null, lastSuccessfulInboundCallAt: null, integrationHealth: { status: "Not applicable", lastAcceptedVoiceWebhookAt: null }, siteHealth: null, attention: { status: "Not applicable", reason: null } },
    });
  });

  it("roll webhook and Site health into one attention reason, Site first", () => {
    const healthy = { status: "Healthy" as const, lastAcceptedVoiceWebhookAt: "2026-10-18T16:55:00.000Z" };
    expect(describeWorkspaceAttention(healthy, null)).toEqual({ status: "Healthy", reason: null });
    expect(describeWorkspaceAttention(healthy, "Unknown")).toEqual({ status: "Healthy", reason: null });
    expect(describeWorkspaceAttention(healthy, "Down")).toEqual({ status: "Needs attention", reason: "Site Down" });
    expect(describeWorkspaceAttention({ status: "Warning", lastAcceptedVoiceWebhookAt: null }, "Warning")).toEqual({ status: "Needs attention", reason: "Site Warning" });
    expect(describeWorkspaceAttention({ status: "Warning", lastAcceptedVoiceWebhookAt: null }, "Healthy")).toEqual({ status: "Needs attention", reason: "No accepted Twilio webhook yet" });
    expect(describeWorkspaceAttention({ status: "Not applicable", lastAcceptedVoiceWebhookAt: null }, null)).toEqual({ status: "Not applicable", reason: null });
  });

  it("omit ungranted Workspaces from a Client Viewer's list stats", async () => {
    const stats = await analytics(multiViewer).workspaceListStats(["north", "south", "east", "other-workspace"]);
    expect(Object.keys(stats).sort()).toEqual(["north", "south"]);
  });

  it("give Workspace Overview the last successful inbound Call and webhook health", async () => {
    expect(await analytics(singleViewer).routingHealth("north")).toEqual({
      lastSuccessfulInboundCallAt: "2026-10-18T16:55:00.000Z",
      webhook: { status: "Healthy", lastAcceptedVoiceWebhookAt: "2026-10-18T16:55:00.000Z" },
    });
    expect(await analytics(operator).routingHealth("south")).toEqual({
      lastSuccessfulInboundCallAt: "2026-10-18T10:00:00.000Z",
      webhook: { status: "Warning", lastAcceptedVoiceWebhookAt: null },
    });
    expect(await analytics(singleViewer).routingHealth("south")).toBeNull();
  });

  it("keep a later Failed Call out of the last successful inbound Call while Last Call still shows it", async () => {
    await seedOrganization("routing");
    await seedWorkspace({ organizationId: "routing", id: "routing-west", name: "West Roofing", timezone: "UTC", trackingNumber: "+14155550191" });
    await seedCall({ id: "routing-missed", workspaceId: "routing-west", startedAt: "2026-10-16T12:00:00Z", outcome: "Missed", forwarded: true });
    await seedCall({ id: "routing-failed", workspaceId: "routing-west", startedAt: "2026-10-17T12:00:00Z", outcome: "Failed" });
    const routingOperator = actor({ organizationId: "routing", userId: "routing-operator", role: "Operator", timezone: "UTC" });
    expect((await analytics(routingOperator).workspaceListStats(["routing-west"]))["routing-west"]).toMatchObject({
      lastCallAt: "2026-10-17T12:00:00.000Z",
      lastSuccessfulInboundCallAt: "2026-10-16T12:00:00.000Z",
    });
    expect((await analytics(routingOperator).routingHealth("routing-west"))?.lastSuccessfulInboundCallAt).toBe("2026-10-16T12:00:00.000Z");
  });

  it("keep the Workspace list readable when its stats fail", async () => {
    const failing = { workspaceListStats: () => Promise.reject(new Error("stats down")) } as unknown as Analytics;
    const listed = { workspaces: [], total: 0, page: 1, pageSize: 25 } as unknown as Parameters<typeof withWorkspaceListStats>[1];
    expect(await withWorkspaceListStats(failing, listed)).toEqual({ ...listed, stats: {} });
  });
});

describe("Report analytics", () => {
  const northWeek: ReportAnalyticsScope = { organizationId: "fleet", workspaceIds: ["north"], timeZone: "America/Chicago", window: { from: "2026-10-12", to: "2026-10-18" } };
  const report = (scope: ReportAnalyticsScope, notableGoodLeadLimit = 10) => reportAnalyticsSummary(pool!, scope, { now, notableGoodLeadLimit });

  it("compute the dashboard KPIs and Lead Rate over the job's Workspaces, window, and timezone with equal prior comparisons", async () => {
    const summary = await report(northWeek);
    expect(summary.timeZone).toBe("America/Chicago");
    expect(summary.window).toEqual({ from: "2026-10-12", to: "2026-10-18" });
    expect(summary.previousWindow).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    const { kpis } = summary;
    expect(kpis.totalCalls).toEqual({ value: 17, comparison: { previous: 6, change: 11 / 6, unit: "relative" } });
    expect(kpis.goodLeads).toEqual({ value: 5, comparison: { previous: 2, change: 1.5, unit: "relative" } });
    expect(kpis.answerRate.value).toBeCloseTo(7 / 11, 10);
    expect(kpis.averageConnectedSeconds.value).toBeCloseTo(782 / 7, 10);
    expect(kpis.leadRate.value).toBeCloseTo(5 / 17, 10);
    expect(kpis.leadRate.comparison!.previous).toBeCloseTo(2 / 6, 10);
    expect(kpis.leadRate.comparison!.change).toBeCloseTo(5 / 17 - 2 / 6, 10);
    expect(kpis.leadRate.comparison!.unit).toBe("points");
    expect(summary.trend.interval).toBe("day");
    expect(points(summary)).toEqual((await analytics(operator).summary({ workspaceId: "north", range: sevenDays }))!.trend.points.map((point) => [point.start, point.totalCalls, point.answeredCalls, point.goodLeads]));
  });

  it("distribute Calls by Call Outcome, In Progress included, and by effective Lead classification with Lead Review precedence and its source", async () => {
    const summary = await report(northWeek);
    expect(summary.outcomes).toEqual([
      { outcome: "Answered", calls: 7 },
      { outcome: "Voicemail", calls: 3 },
      { outcome: "Missed", calls: 2 },
      { outcome: "Abandoned", calls: 1 },
      { outcome: "Blocked", calls: 2 },
      { outcome: "Failed", calls: 1 },
      { outcome: "In Progress", calls: 1 },
    ]);
    expect(summary.classifications).toEqual([
      { classification: "Good Lead", reviewed: 2, assessed: 3 },
      { classification: "Not Good Lead", reviewed: 1, assessed: 1 },
      { classification: "Uncertain", reviewed: 0, assessed: 0 },
    ]);
    expect(summary.unclassifiedCalls).toBe(10);
  });

  it("list notable Good Leads by AI lead score then recency up to the limit, with Lead Review precedence and its source", async () => {
    const summary = await report(northWeek, 4);
    expect(summary.notableGoodLeads).toEqual([
      { callId: "north-a4", workspace: { id: "north", name: "North Plumbing" }, startedAt: "2026-10-14T16:00:00.000Z", callerNumber: "+13125550142", outcome: "Answered", connectedSeconds: 125, leadScore: 88, source: "assessment", summary: "Caller asked for a quote." },
      { callId: "north-a3", workspace: { id: "north", name: "North Plumbing" }, startedAt: "2026-10-13T16:00:00.000Z", callerNumber: "+13125550142", outcome: "Answered", connectedSeconds: 88, leadScore: 74, source: "review", summary: "Caller asked for a quote." },
      { callId: "north-v2", workspace: { id: "north", name: "North Plumbing" }, startedAt: "2026-10-17T02:00:00.000Z", callerNumber: "+13125550142", outcome: "Voicemail", connectedSeconds: 0, leadScore: 61, source: "review", summary: "Caller asked for a quote." },
      { callId: "north-v1", workspace: { id: "north", name: "North Plumbing" }, startedAt: "2026-10-14T03:00:00.000Z", callerNumber: "+13125550142", outcome: "Voicemail", connectedSeconds: 0, leadScore: 61, source: "assessment", summary: "Caller asked for a quote." },
    ]);
  });

  it("compare only the job's Workspaces, withholding the comparison for one Workspace and never counting another Organization", async () => {
    const combined = await report({ ...northWeek, workspaceIds: ["north", "south"] });
    expect(combined.kpis.totalCalls.value).toBe(21);
    expect(combined.workspacePerformance?.map((row) => [row.workspace.name, row.totalCalls, row.goodLeads])).toEqual([["North Plumbing", 17, 5], ["South Dental", 4, 1]]);
    expect((await report(northWeek)).workspacePerformance).toBeNull();
    const foreign = await report({ ...northWeek, workspaceIds: ["north", "other-workspace"] });
    expect(foreign.kpis.totalCalls.value).toBe(17);
    expect(foreign.workspacePerformance).toBeNull();
  });

  it("show no comparison for All Time, Lead Rate included", async () => {
    const summary = await report({ ...northWeek, window: null });
    expect(summary.previousWindow).toBeNull();
    expect(summary.window).toEqual({ from: "2026-09-01", to: "2026-10-18" });
    expect(summary.trend.interval).toBe("month");
    expect(summary.kpis.totalCalls).toEqual({ value: 24, comparison: null });
    expect(summary.kpis.leadRate).toEqual({ value: 8 / 24, comparison: null });
  });
});
