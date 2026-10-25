/**
 * -------------------------------------------------------------------------
 * @file   retention-fixtures.test.ts
 * @brief  Verifies the backdated retention fixtures used to demonstrate expiry on Staging.
 *
 * @description
 *  Seeds the fixture Calls into a real migrated PostgreSQL database and a
 *  fake R2 bucket, checks that a rerun adds nothing, runs the real media
 *  retention sweep over them, and checks that the verify report agrees
 *  with R2 and PostgreSQL after cleanup and flags a disagreement when an
 *  object or Transcript survives. It also checks that the fixtures refuse
 *  any environment but Local or Staging and that remove deletes every
 *  fixture row and object.
 *
 * @remarks
 *  Twilio is faked at the HTTP boundary and answers 404, as Twilio does for
 *  the fixture Recording SID that never existed there.
 *
 * @see
 *  data/retention-fixtures.ts
 *  data/media-retention.ts
 *  scripts/seed-retention-fixtures.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./test-database";

import type { OpenedDatabase } from "@/data/database";
import { generateInitialCallFlow } from "@/data/call-flow";
import { encryptSecret } from "@/data/credential-encryption";
import { sweepRecordingMedia } from "@/data/media-retention";
import { migrateDatabase } from "@/data/migrate";
import { masterKeyFingerprint } from "@/data/provider-credential";
import type { ArtifactObjects } from "@/data/r2-objects";
import { createRetentionFixtures, RetentionFixtureError, type RetentionFixtureObjects } from "@/data/retention-fixtures";
import { createTwilioRecordingMedia } from "@/data/twilio-client";

const masterKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const now = new Date("2026-10-19T14:07:31.229Z");
const localUrl = "postgresql://postgres:postgres@127.0.0.1:5433/tracer";
const neonUrl = "postgresql://tracer_owner:secret@ep-example-123456.us-east-2.aws.neon.tech/neondb?sslmode=require";

let container: StartedPostgreSqlContainer | undefined;
let database: OpenedDatabase | undefined;

interface FakeR2 extends RetentionFixtureObjects, Pick<ArtifactObjects, "delete"> {
  objects: Map<string, Uint8Array>;
}

function fakeR2(): FakeR2 {
  const r2: FakeR2 = {
    objects: new Map(),
    async head(key) {
      const body = r2.objects.get(key);
      return body ? { sizeBytes: body.byteLength, sha256: "" } : null;
    },
    async put(key: string, body: Uint8Array) {
      r2.objects.set(key, body);
    },
    async delete(key) {
      r2.objects.delete(key);
    },
  };
  return r2;
}

const twilioDeletes: string[] = [];
const twilio = createTwilioRecordingMedia({
  fetch: async (input) => {
    twilioDeletes.push(String(input));
    return new Response(JSON.stringify({ code: 20404, message: "The requested resource was not found" }), { status: 404 });
  },
});

function fixtures(r2: FakeR2, overrides: { databaseUrl?: string; bucket?: string } = {}) {
  return createRetentionFixtures({
    databaseUrl: overrides.databaseUrl ?? localUrl,
    bucket: overrides.bucket ?? "tracer-recordings-staging",
    database: database!,
    objects: r2,
    organizationId: "fleet",
    workspaceId: "north",
  });
}

async function count(sql: string): Promise<number> {
  return Number((await database!.query<{ count: string }>(sql)).rows[0].count);
}

async function contentCounts() {
  return {
    calls: await count("select count(*) from call where id like 'retention-fixture-%'"),
    recordings: await count("select count(*) from recording where id like 'retention-fixture-%'"),
    transcripts: await count("select count(*) from transcript where recording_id like 'retention-fixture-%'"),
    assessments: await count("select count(*) from lead_assessment where id like 'retention-fixture-%'"),
    evidence: await count("select count(*) from lead_assessment_evidence where lead_assessment_id like 'retention-fixture-%'"),
    reviews: await count("select count(*) from lead_review where call_id like 'retention-fixture-%'"),
  };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  await migrateDatabase(container.getConnectionUri());
  database = createTestDatabase(container.getConnectionUri());
  await database.query("insert into organization (id, name, slug, created_at) values ('fleet', 'fleet', 'fleet', now())");
  await database.query(`insert into "user" (id, name, email, email_verified, state, timezone, created_at, updated_at) values ('fleet-operator', 'Fleet Operator', 'fleet-operator@example.com', true, 'Active', 'America/Chicago', now(), now())`);
  await database.query("insert into member (id, organization_id, user_id, role, created_at) values ('fleet-operator-member', 'fleet', 'fleet-operator', 'owner', now())");
  await database.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, recording_enabled, analysis_enabled, created_at, updated_at)
     values ('north', 'fleet', 'North Plumbing', 'America/Chicago', 'Active', true, true, now(), now())`,
  );
  await database.query(
    `insert into twilio_connection (id, organization_id, account_sid, api_key_sid, api_key_secret_ciphertext, connected_by_user_id, connected_at, created_at, updated_at)
     values ('fleet-connection', 'fleet', 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'SK11111111111111111111111111111111', $1, 'fleet-operator', now(), now(), now())`,
    [await encryptSecret(masterKey, "fixture-api-key-secret")],
  );
  await database.query("update twilio_connection set master_key_fingerprint = $1 where master_key_fingerprint is null", [await masterKeyFingerprint(masterKey)]);
  await database.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ('north-number', 'fleet', 'PN${"1".repeat(32)}', '+14155550101', 'Tracking Number', true, now(), now(), now(), now())`,
  );
  await database.query(
    `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at)
     values ('north-assignment', 'fleet', 'north', 'north-number', '+14155550101', '2025-01-06T15:12:07.311Z', now())`,
  );
  const graph = generateInitialCallFlow({ destinationNumber: "+14155550199", recordingEnabled: true, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });
  await database.query("insert into flow_version (id, organization_id, workspace_id, version, graph, published_at) values ('north-flow', 'fleet', 'north', 1, $1, now())", [JSON.stringify(graph)]);
}, 120_000);

afterAll(async () => {
  await database?.close();
  await container?.stop();
});

describe.sequential("retention fixtures", () => {
  it("refuses Production and any database that is not local unless the bucket is the Staging bucket", () => {
    const r2 = fakeR2();
    expect(() => fixtures(r2, { bucket: "tracer-recordings-production" })).toThrow(RetentionFixtureError);
    expect(() => fixtures(r2, { databaseUrl: neonUrl, bucket: "tracer-recordings-production" })).toThrow(/Production/);
    expect(() => fixtures(r2, { databaseUrl: neonUrl, bucket: "tracer-recordings-preview" })).toThrow(RetentionFixtureError);
    expect(fixtures(r2).environment).toBe("Local");
    expect(fixtures(r2, { databaseUrl: "postgresql://postgres:postgres@localhost:5432/tracer", bucket: "local-bucket" }).environment).toBe("Local");
    expect(fixtures(r2, { databaseUrl: neonUrl }).environment).toBe("Staging");
  });

  it("seeds the expired, expired Pending transfer, and fresh fixture Calls once with their content and R2 objects", async () => {
    const r2 = fakeR2();
    const seeded = await fixtures(r2).seed(now);

    expect(seeded.map((fixture) => [fixture.fixture, fixture.callId, fixture.created])).toEqual([
      ["expired", "retention-fixture-north-expired", true],
      ["expired-pending", "retention-fixture-north-expired-pending", true],
      ["fresh", "retention-fixture-north-fresh", true],
    ]);
    expect(await contentCounts()).toEqual({ calls: 3, recordings: 3, transcripts: 2, assessments: 2, evidence: 2, reviews: 2 });
    const calls = await database!.query<{ id: string; started_at: Date; twilio_call_sid: string; twilio_recording_sid: string; transfer_state: string; twilio_cleanup_state: string }>(
      `select c.id, c.started_at, c.twilio_call_sid, r.twilio_recording_sid, r.transfer_state, r.twilio_cleanup_state
         from call c join recording r on r.call_id = c.id where c.id like 'retention-fixture-%' order by c.id`,
    );
    expect(calls.rows.map((row) => [row.id, row.transfer_state, row.twilio_cleanup_state])).toEqual([
      ["retention-fixture-north-expired", "Stored", "Deleted"],
      ["retention-fixture-north-expired-pending", "Pending", "Pending"],
      ["retention-fixture-north-fresh", "Stored", "Deleted"],
    ]);
    for (const row of calls.rows) {
      expect(row.twilio_call_sid).toMatch(/^CAffffffff[0-9a-f]{24}$/);
      expect(row.twilio_recording_sid).toMatch(/^REffffffff[0-9a-f]{24}$/);
    }
    expect(calls.rows[0].started_at.toISOString()).toBe("2025-09-19T14:07:31.229Z");
    expect(calls.rows[1].started_at.toISOString()).toBe("2025-09-19T14:07:31.229Z");
    expect(calls.rows[2].started_at.getTime()).toBe(now.getTime() - 86_400_000);
    expect([...r2.objects.keys()].sort()).toEqual([
      "organizations/fleet/workspaces/north/calls/retention-fixture-north-expired/recordings/retention-fixture-north-expired-recording.mp3",
      "organizations/fleet/workspaces/north/calls/retention-fixture-north-expired/recordings/retention-fixture-north-expired-recording.peaks.json",
      "organizations/fleet/workspaces/north/calls/retention-fixture-north-expired/recordings/retention-fixture-north-expired-recording.wav",
      "organizations/fleet/workspaces/north/calls/retention-fixture-north-fresh/recordings/retention-fixture-north-fresh-recording.mp3",
      "organizations/fleet/workspaces/north/calls/retention-fixture-north-fresh/recordings/retention-fixture-north-fresh-recording.peaks.json",
      "organizations/fleet/workspaces/north/calls/retention-fixture-north-fresh/recordings/retention-fixture-north-fresh-recording.wav",
    ]);
    const sizes = await database!.query<{ size_bytes: string; mp3_size_bytes: string; r2_object_key: string; mp3_object_key: string }>(
      "select size_bytes, mp3_size_bytes, r2_object_key, mp3_object_key from recording where id = 'retention-fixture-north-fresh-recording'",
    );
    expect(Number(sizes.rows[0].size_bytes)).toBe(r2.objects.get(sizes.rows[0].r2_object_key)?.byteLength);
    expect(Number(sizes.rows[0].mp3_size_bytes)).toBe(r2.objects.get(sizes.rows[0].mp3_object_key)?.byteLength);

    const rerun = await fixtures(r2).seed(now);
    expect(rerun.map((fixture) => fixture.created)).toEqual([false, false, false]);
    expect(await contentCounts()).toEqual({ calls: 3, recordings: 3, transcripts: 2, assessments: 2, evidence: 2, reviews: 2 });
    expect(r2.objects.size).toBe(6);
  });

  it("verifies R2 and PostgreSQL agree once the sweep finishes the expired fixtures, and reports the fresh one as retained", async () => {
    const r2 = fakeR2();
    await fixtures(r2).remove();
    await fixtures(r2).seed(now);
    const before = await fixtures(r2).verify();
    expect(before.map((fixture) => [fixture.fixture, fixture.status, fixture.agrees])).toEqual([
      ["expired", "unfinished", true],
      ["expired-pending", "unfinished", true],
      ["fresh", "retained", true],
    ]);
    expect(before[0].remaining).toEqual(expect.arrayContaining(["Transcript", "Lead Assessment evidence", "Lead Assessment rationale", expect.stringMatching(/\.wav$/)]));
    expect(before[1].remaining).toEqual(["Twilio copy (Pending)"]);

    await expect(sweepRecordingMedia({ database: database!, objects: r2, twilio, masterKey }, now)).resolves.toEqual({ selected: 2, completed: 2, failed: 0 });
    expect(twilioDeletes).toHaveLength(1);
    expect(twilioDeletes[0]).toMatch(/Recordings\/REffffffff[0-9a-f]{24}\.json$/);

    const after = await fixtures(r2).verify();
    expect(after).toEqual([
      expect.objectContaining({ fixture: "expired", status: "finished", agrees: true, remaining: [] }),
      expect.objectContaining({ fixture: "expired-pending", status: "finished", agrees: true, remaining: [] }),
      expect.objectContaining({ fixture: "fresh", status: "retained", agrees: true }),
    ]);
    expect(r2.objects.size).toBe(3);

    const rerun = await fixtures(r2).seed(now);
    expect(rerun.map((fixture) => fixture.created)).toEqual([false, false, false]);
    expect(await count("select count(*) from transcript where recording_id = 'retention-fixture-north-expired-recording'")).toBe(0);
    expect(r2.objects.size).toBe(3);
  });

  it("reports a disagreement when a finished fixture still has an R2 object or Transcript", async () => {
    const r2 = fakeR2();
    const wav = "organizations/fleet/workspaces/north/calls/retention-fixture-north-expired/recordings/retention-fixture-north-expired-recording.wav";
    r2.objects.set(wav, new Uint8Array([1, 2, 3]));
    await database!.query(
      `insert into transcript (recording_id, organization_id, call_id, turns, model, created_at)
       values ('retention-fixture-north-expired-recording', 'fleet', 'retention-fixture-north-expired', '[]', 'whisper-1', now())`,
    );
    for (const key of [wav.replace(/\.wav$/, ".peaks.json"), wav.replace(/\.wav$/, ".mp3")]) r2.objects.delete(key);
    const fresh = "organizations/fleet/workspaces/north/calls/retention-fixture-north-fresh/recordings/retention-fixture-north-fresh-recording";
    for (const extension of [".wav", ".peaks.json", ".mp3"]) r2.objects.set(fresh + extension, new Uint8Array([1]));

    const report = await fixtures(r2).verify();
    expect(report[0]).toMatchObject({ fixture: "expired", status: "finished", agrees: false, remaining: ["Transcript", wav] });
    expect(report[1]).toMatchObject({ fixture: "expired-pending", agrees: true });
    expect(report[2]).toMatchObject({ fixture: "fresh", status: "retained", agrees: true });

    r2.objects.delete(fresh + ".mp3");
    expect((await fixtures(r2).verify())[2]).toMatchObject({ fixture: "fresh", status: "retained", agrees: false, remaining: [`${fresh}.mp3 is missing`] });
    await database!.query("delete from transcript where recording_id = 'retention-fixture-north-expired-recording'");
  });

  it("removes every fixture row and R2 object and can seed them again", async () => {
    const r2 = fakeR2();
    await fixtures(r2).remove();
    await fixtures(r2).seed(now);
    r2.objects.set("organizations/fleet/workspaces/north/calls/other-call/recordings/other-recording.wav", new Uint8Array([1]));

    await expect(fixtures(r2).remove()).resolves.toEqual({ calls: 3, objects: 6 });
    expect(await contentCounts()).toEqual({ calls: 0, recordings: 0, transcripts: 0, assessments: 0, evidence: 0, reviews: 0 });
    expect([...r2.objects.keys()]).toEqual(["organizations/fleet/workspaces/north/calls/other-call/recordings/other-recording.wav"]);
    const verified = await fixtures(r2).verify();
    expect(verified.map((fixture) => [fixture.status, fixture.agrees])).toEqual([["missing", true], ["missing", true], ["missing", true]]);
    await expect(fixtures(r2).remove()).resolves.toEqual({ calls: 0, objects: 0 });
    expect((await fixtures(r2).seed(now)).map((fixture) => fixture.created)).toEqual([true, true, true]);
  });

  it("refuses a Workspace outside the Organization", async () => {
    const r2 = fakeR2();
    await database!.query("insert into organization (id, name, slug, created_at) values ('other', 'other', 'other', now())");
    const other = createRetentionFixtures({ databaseUrl: localUrl, bucket: "tracer-recordings-staging", database: database!, objects: r2, organizationId: "other", workspaceId: "north" });
    await expect(other.seed(now)).rejects.toThrow(RetentionFixtureError);
    expect(r2.objects.size).toBe(0);
  });
});
