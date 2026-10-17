/**
 * -------------------------------------------------------------------------
 * @file   recording-recovery.test.ts
 * @brief  Verifies the Recording recovery sweep.
 *
 * @description
 *  Seeds Recordings in every transfer and cleanup state against a real
 *  PostgreSQL database and checks that the sweep re-requests processing
 *  only for unfinished Recordings idle for over an hour and created within
 *  the last 7 days, and that one failed request does not stop the rest.
 *
 * @remarks
 *  Recording processing is a fake at the Trigger.dev boundary that records
 *  each request.
 *
 * @see
 *  data/recording-recovery.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { bootstrapInitialOperator } from "@/data/bootstrap-initial-operator";
import { generateInitialCallFlow } from "@/data/call-flow";
import { migrateDatabase } from "@/data/migrate";
import type { RecordingProcessing, RecordingProcessingRequest } from "@/data/recording";
import { sweepStuckRecordings } from "@/data/recording-recovery";

const now = new Date("2026-10-16T12:00:00.000Z");
const hours = (count: number) => new Date(now.getTime() - count * 60 * 60 * 1000);

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let organizationId = "";
let sequence = 0;

async function recording(state: { transfer: string; cleanup: string; createdAt: Date; updatedAt: Date }): Promise<string> {
  sequence += 1;
  const id = randomUUID();
  const stored = state.transfer === "Stored";
  await pool!.query(
    `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, transfer_state, twilio_cleanup_state,
                            r2_object_key, size_bytes, sha256, stored_at, created_at, updated_at)
     values ($1, $2, 'recovery-workspace', 'recovery-call', $3, 'voicemail', 1, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      organizationId,
      `RE${String(sequence).padStart(32, "0")}`,
      state.transfer,
      state.cleanup,
      stored ? `recordings/${id}.wav` : null,
      stored ? 128 : null,
      stored ? "a".repeat(64) : null,
      stored ? state.updatedAt : null,
      state.createdAt,
      state.updatedAt,
    ],
  );
  return id;
}

function recordingProcessing(failingId: string | null = null): RecordingProcessing & { requests: RecordingProcessingRequest[] } {
  const requests: RecordingProcessingRequest[] = [];
  return {
    requests,
    async request(request) {
      requests.push(request);
      if (request.id === failingId) throw new Error("Trigger.dev unavailable");
    },
  };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await migrateDatabase(container.getConnectionUri());
  const operator = await bootstrapInitialOperator(pool, { email: "operator@example.com", name: "Recovery Operator", timezone: "UTC" });
  organizationId = operator.organizationId;
  await pool.query(
    `insert into twilio_number (id, organization_id, twilio_sid, phone_number, friendly_name, voice_capable, first_seen_at, last_seen_at, created_at, updated_at)
     values ('recovery-number', $1, 'PNeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', '+14155550112', 'Recovery Number', true, now(), now(), now(), now())`,
    [organizationId],
  );
  await pool.query(
    `insert into workspace (id, organization_id, name, reporting_timezone, state, destination_number, created_at, updated_at)
     values ('recovery-workspace', $1, 'Recovery Workspace', 'UTC', 'Active', '+14155550199', now(), now())`,
    [organizationId],
  );
  await pool.query(
    `insert into number_assignment (id, organization_id, workspace_id, twilio_number_id, phone_number, started_at, created_at)
     values ('recovery-assignment', $1, 'recovery-workspace', 'recovery-number', '+14155550112', now(), now())`,
    [organizationId],
  );
  const graph = generateInitialCallFlow({ destinationNumber: "+14155550199", recordingEnabled: false, spamGateEnabled: false, whisperEnabled: false, whisperMessage: null, disclosureVoice: "Polly.Joanna" });
  await pool.query(
    `insert into flow_version (id, organization_id, workspace_id, version, graph, published_by_user_id, published_at)
     values ('recovery-flow-version', $1, 'recovery-workspace', 1, $2, $3, now())`,
    [organizationId, JSON.stringify(graph), operator.userId],
  );
  await pool.query(
    `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, started_at, created_at, updated_at)
     values ('recovery-call', $1, 'recovery-workspace', 'recovery-assignment', 'recovery-flow-version', 'CArecovery', '+14155550112', now(), now(), now())`,
    [organizationId],
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

beforeEach(async () => {
  await pool!.query("delete from recording");
});

describe("Recording recovery sweep", () => {
  it("re-requests every unfinished Recording idle for over an hour with its Recording-derived idempotency key", async () => {
    const pending = await recording({ transfer: "Pending", cleanup: "Pending", createdAt: hours(30), updatedAt: hours(2) });
    const failed = await recording({ transfer: "Failed", cleanup: "Pending", createdAt: hours(20), updatedAt: hours(2) });
    const cleanupPending = await recording({ transfer: "Stored", cleanup: "Pending", createdAt: hours(10), updatedAt: hours(2) });
    const cleanupFailed = await recording({ transfer: "Stored", cleanup: "Failed", createdAt: hours(5), updatedAt: hours(2) });
    const processing = recordingProcessing();

    await expect(sweepStuckRecordings({ pool: pool!, recordingProcessing: processing }, now)).resolves.toEqual({ requested: 4, failed: 0 });

    expect(processing.requests).toEqual([pending, failed, cleanupPending, cleanupFailed].map((id) => ({ id, organizationId, idempotencyKey: `recording-processing:${id}` })));
  });

  it("skips fresh, older than 7 days, and fully transferred Recordings", async () => {
    await recording({ transfer: "Pending", cleanup: "Pending", createdAt: hours(1), updatedAt: hours(0.5) });
    await recording({ transfer: "Failed", cleanup: "Pending", createdAt: hours(7 * 24 + 1), updatedAt: hours(7 * 24) });
    await recording({ transfer: "Stored", cleanup: "Deleted", createdAt: hours(30), updatedAt: hours(2) });
    const processing = recordingProcessing();

    await expect(sweepStuckRecordings({ pool: pool!, recordingProcessing: processing }, now)).resolves.toEqual({ requested: 0, failed: 0 });

    expect(processing.requests).toEqual([]);
  });

  it("keeps requesting the remaining Recordings when one request fails", async () => {
    const first = await recording({ transfer: "Pending", cleanup: "Pending", createdAt: hours(30), updatedAt: hours(2) });
    const second = await recording({ transfer: "Failed", cleanup: "Pending", createdAt: hours(20), updatedAt: hours(2) });
    const processing = recordingProcessing(first);

    await expect(sweepStuckRecordings({ pool: pool!, recordingProcessing: processing }, now)).resolves.toEqual({ requested: 1, failed: 1 });

    expect(processing.requests.map((request) => request.id)).toEqual([first, second]);
  });
});
