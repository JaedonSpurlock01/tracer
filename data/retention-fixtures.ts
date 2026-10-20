/**
 * -------------------------------------------------------------------------
 * @file   retention-fixtures.ts
 * @brief  Seeds, verifies, and removes the backdated Calls that demonstrate media expiry on Staging.
 *
 * @description
 *  Owns three clearly marked fixture Calls in one existing Workspace, each
 *  with a Recording: `expired` started 13 months ago with a Stored WAV,
 *  waveform peaks, and MP3 in R2, a Transcript, a Lead Assessment with
 *  evidence and rationale, and a Lead Review; `expired-pending` started 13
 *  months ago with its transfer still Pending, so its audio counts as still
 *  at Twilio under a Recording SID Twilio never had; and `fresh`, started a
 *  day ago with the same content as `expired`, for an Operator to purge
 *  through Purge Media. Seeding inserts a fixture only when its Call does
 *  not exist yet, so a rerun never duplicates rows or restores deleted
 *  content. Verify compares PostgreSQL with R2 for each fixture: a
 *  finished cleanup must have no Transcript, evidence, or rationale, a
 *  deleted Twilio copy, and no R2 object; an unfinished one reports what
 *  remains; a retained one must still have its stored objects. Remove
 *  deletes the fixture objects and then the fixture Calls, whose rows
 *  cascade.
 *
 * @remarks
 *  The fixtures refuse the Production bucket outright, and run only
 *  against a loopback database (Local) or with the Staging bucket
 *  (Staging), the only environment marker the repository declares, in
 *  wrangler.jsonc. Every id starts with `retention-fixture-` and every
 *  Twilio SID with `CAffffffff` or `REffffffff`, so fixtures are easy to
 *  find and never collide with real Calls. Rows are inserted through the
 *  migration role with the same constraints, keys, and object layout real
 *  writers use, and nothing updates the immutable Lead Assessment. The R2
 *  objects are small generated placeholders: a silent 16-second stereo
 *  WAV, matching peaks, and silent MP3 frames. Objects are uploaded before
 *  the rows commit, so a failed upload leaves no row pointing at a missing
 *  object, and removed before the rows, so a failed delete can be retried.
 *
 * @see
 *  data/media-retention.ts
 *  data/recording-transfer.ts
 *  scripts/seed-retention-fixtures.ts
 *  docs/DATA_PLATFORM.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createHash } from "node:crypto";

import type { Pool } from "pg";

import { sha256Hex, type ArtifactObjects, type RecordingObjects } from "@/data/r2-objects";
import { recordingMediaExpiredSql } from "@/data/recording-media";
import { mp3ObjectKey } from "@/data/recording-mp3";
import { recordingObjectKey } from "@/data/recording-transfer";
import { waveformObjectKey } from "@/data/recording-waveform";

export const retentionFixturePrefix = "retention-fixture";
export const stagingRecordingBucket = "tracer-recordings-staging";
export const productionRecordingBucket = "tracer-recordings-production";

export const retentionFixtureKinds = ["expired", "expired-pending", "fresh"] as const;

export type RetentionFixtureKind = (typeof retentionFixtureKinds)[number];
export type RetentionFixtureEnvironment = "Local" | "Staging";
export type RetentionFixtureObjects = Pick<RecordingObjects, "head" | "put"> & Pick<ArtifactObjects, "delete">;

export interface SeededRetentionFixture {
  fixture: RetentionFixtureKind;
  callId: string;
  created: boolean;
}

export interface VerifiedRetentionFixture {
  fixture: RetentionFixtureKind;
  callId: string;
  status: "finished" | "unfinished" | "retained" | "missing";
  agrees: boolean;
  remaining: string[];
}

export class RetentionFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetentionFixtureError";
  }
}

const wavSeconds = 16;
const wavSampleRate = 8000;
const peaksPixelsPerSecond = 50;

const turns = [
  { speaker: "Caller", startMs: 0, endMs: 4200, text: "Retention fixture: hi, I need a quote for a water heater." },
  { speaker: "Business", startMs: 4600, endMs: 9800, text: "Retention fixture: sure, we can come out tomorrow morning." },
  { speaker: "Caller", startMs: 10200, endMs: 15400, text: "Retention fixture: tomorrow works, thank you." },
];

export function resolveRetentionFixtureEnvironment(input: { databaseUrl: string; bucket: string }): RetentionFixtureEnvironment {
  if (input.bucket === productionRecordingBucket) throw new RetentionFixtureError("Retention fixtures refuse to run against Production");
  const host = new URL(input.databaseUrl).hostname;
  if (host === "127.0.0.1" || host === "localhost" || host === "[::1]") return "Local";
  if (input.bucket === stagingRecordingBucket) return "Staging";
  throw new RetentionFixtureError(`Retention fixtures run only on Local or Staging, and ${input.bucket} is not the Staging bucket`);
}

function silentWav(): Uint8Array {
  const channels = 2;
  const dataSize = wavSeconds * wavSampleRate * channels * 2;
  const view = new DataView(new ArrayBuffer(44 + dataSize));
  const text = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, wavSampleRate, true);
  view.setUint32(28, wavSampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataSize, true);
  return new Uint8Array(view.buffer);
}

function waveformPeaks(): Uint8Array {
  const points = wavSeconds * peaksPixelsPerSecond;
  const lane = (phase: number) => Array.from({ length: points }, (_, point) => Math.round(Math.abs(Math.sin(point / 12 + phase)) * 40) / 100);
  return new TextEncoder().encode(JSON.stringify({
    version: 1,
    sampleRate: wavSampleRate,
    samplesPerPixel: wavSampleRate / peaksPixelsPerSecond,
    pixelsPerSecond: peaksPixelsPerSecond,
    durationSeconds: wavSeconds,
    lanes: ["Caller", "Business"],
    peaks: [lane(0), lane(1.3)],
  }));
}

function silentMp3(): Uint8Array {
  const frameBytes = 417;
  const frames = Math.ceil((wavSeconds * 44100) / 1152);
  const bytes = new Uint8Array(frames * frameBytes);
  for (let frame = 0; frame < frames; frame += 1) bytes.set([0xff, 0xfb, 0x90, 0x64], frame * frameBytes);
  return bytes;
}

function fixtureSid(prefix: "CA" | "RE", callId: string): string {
  return `${prefix}ffffffff${createHash("sha256").update(callId).digest("hex").slice(0, 24)}`;
}

function monthsBefore(now: Date, months: number): Date {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date;
}

export function createRetentionFixtures(options: {
  databaseUrl: string;
  bucket: string;
  pool: Pool;
  objects: RetentionFixtureObjects;
  organizationId: string;
  workspaceId: string;
}) {
  const environment = resolveRetentionFixtureEnvironment(options);
  const fixtures = retentionFixtureKinds.map((fixture) => {
    const callId = `${retentionFixturePrefix}-${options.workspaceId}-${fixture}`;
    const recording = { id: `${callId}-recording`, organizationId: options.organizationId, workspaceId: options.workspaceId, callId };
    return { fixture, callId, recordingId: recording.id, keys: { wav: recordingObjectKey(recording), peaks: waveformObjectKey(recording), mp3: mp3ObjectKey(recording) } };
  });

  async function presentKeys(keys: string[]): Promise<string[]> {
    const present: string[] = [];
    for (const key of keys) if (await options.objects.head(key)) present.push(key);
    return present;
  }

  return {
    environment,

    async seed(now: Date): Promise<SeededRetentionFixture[]> {
      const workspace = (await options.pool.query<{ assignment_id: string | null; tracking_number: string | null; flow_version_id: string | null; reviewer_id: string | null }>(
        `select na.id as assignment_id, na.phone_number as tracking_number, fv.id as flow_version_id,
                (select m.user_id from member m join "user" u on u.id = m.user_id
                  where m.organization_id = w.organization_id and m.role = 'owner' and u.state = 'Active'
                  order by m.created_at limit 1) as reviewer_id
           from workspace w
           left join lateral (select id, phone_number from number_assignment where workspace_id = w.id order by started_at desc limit 1) na on true
           left join lateral (select id from flow_version where workspace_id = w.id order by version desc limit 1) fv on true
          where w.id = $1 and w.organization_id = $2`,
        [options.workspaceId, options.organizationId],
      )).rows[0];
      if (!workspace) throw new RetentionFixtureError(`Workspace ${options.workspaceId} is not in Organization ${options.organizationId}`);
      if (!workspace.assignment_id || !workspace.tracking_number || !workspace.flow_version_id) {
        throw new RetentionFixtureError(`Workspace ${options.workspaceId} needs a Number Assignment and a published Call Flow`);
      }
      const wav = silentWav();
      const peaks = waveformPeaks();
      const mp3 = silentMp3();
      const seeded: SeededRetentionFixture[] = [];
      for (const fixture of fixtures) {
        const exists = await options.pool.query("select 1 from call where id = $1", [fixture.callId]);
        if (exists.rowCount) {
          seeded.push({ fixture: fixture.fixture, callId: fixture.callId, created: false });
          continue;
        }
        const stored = fixture.fixture !== "expired-pending";
        const startedAt = fixture.fixture === "fresh" ? new Date(now.getTime() - 86_400_000) : monthsBefore(now, 13);
        const wavSha256 = await sha256Hex(wav);
        if (stored) {
          await options.objects.put(fixture.keys.wav, wav, { sizeBytes: wav.byteLength, sha256: wavSha256 });
          await options.objects.put(fixture.keys.peaks, peaks, { sizeBytes: peaks.byteLength, sha256: await sha256Hex(peaks) }, "application/json");
          await options.objects.put(fixture.keys.mp3, mp3, { sizeBytes: mp3.byteLength, sha256: await sha256Hex(mp3) }, "audio/mpeg");
        }
        const client = await options.pool.connect();
        try {
          await client.query("begin");
          await client.query(
            `insert into call (id, organization_id, workspace_id, number_assignment_id, flow_version_id, twilio_call_sid, tracking_number, caller_number,
                               state, outcome, outcome_reason, started_at, answered_at, ended_at, duration_seconds, created_at, updated_at)
             values ($1, $2, $3, $4, $5, $6, $7, '+12025550199', 'Completed', 'Answered', 'flow_outcome',
                     $8::timestamptz, $8::timestamptz + interval '5 seconds', $8::timestamptz + interval '21 seconds', 16, $8::timestamptz, $8::timestamptz + interval '21 seconds')`,
            [fixture.callId, options.organizationId, options.workspaceId, workspace.assignment_id, workspace.flow_version_id, fixtureSid("CA", fixture.callId), workspace.tracking_number, startedAt],
          );
          await client.query(
            `insert into call_event (organization_id, workspace_id, call_id, kind, occurred_at, detail, idempotency_key)
             values ($1, $2, $3, 'call_received', $4::timestamptz, '{}', 'call_received:' || $3),
                    ($1, $2, $3, 'call_completed', $4::timestamptz + interval '21 seconds', '{"outcome":"Answered"}', 'call_completed:' || $3 || ':Answered')`,
            [options.organizationId, options.workspaceId, fixture.callId, startedAt],
          );
          if (!stored) {
            await client.query(
              `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, created_at, updated_at)
               values ($1, $2, $3, $4, $5, 'connected', 2, $6, $7::timestamptz + interval '21 seconds', $7::timestamptz + interval '21 seconds')`,
              [fixture.recordingId, options.organizationId, options.workspaceId, fixture.callId, fixtureSid("RE", fixture.callId), wavSeconds, startedAt],
            );
          } else {
            await client.query(
              `insert into recording (id, organization_id, workspace_id, call_id, twilio_recording_sid, source, channels, duration_seconds, transfer_state, twilio_cleanup_state,
                                      r2_object_key, size_bytes, sha256, stored_at, twilio_deleted_at, waveform_state, waveform_object_key, waveform_generated_at,
                                      mp3_state, mp3_object_key, mp3_size_bytes, mp3_generated_at, transcript_state, transcript_audio_ms, transcript_cost_usd,
                                      transcript_completed_at, lead_assessment_state, created_at, updated_at)
               values ($1, $2, $3, $4, $5, 'connected', 2, $6, 'Stored', 'Deleted', $7, $8, $9, $10::timestamptz + interval '2 minutes', $10::timestamptz + interval '2 minutes',
                       'Stored', $11, $10::timestamptz + interval '3 minutes', 'Stored', $12, $13, $10::timestamptz + interval '3 minutes',
                       'Completed', $14, 0.0016, $10::timestamptz + interval '4 minutes', 'Completed', $10::timestamptz + interval '21 seconds', $10::timestamptz + interval '5 minutes')`,
              [
                fixture.recordingId, options.organizationId, options.workspaceId, fixture.callId, fixtureSid("RE", fixture.callId), wavSeconds,
                fixture.keys.wav, wav.byteLength, wavSha256, startedAt, fixture.keys.peaks, fixture.keys.mp3, mp3.byteLength, wavSeconds * 1000,
              ],
            );
            await client.query(
              `insert into transcript (recording_id, organization_id, call_id, turns, model, created_at)
               values ($1, $2, $3, $4, 'whisper-1', $5::timestamptz + interval '4 minutes')`,
              [fixture.recordingId, options.organizationId, fixture.callId, JSON.stringify(turns), startedAt],
            );
            await client.query(
              `insert into lead_assessment (id, organization_id, call_id, recording_id, classification, score, summary, rationale, model, input_tokens, output_tokens, cost_usd, processed_at)
               values ($1, $2, $3, $4, 'Good Lead', 86, 'Retention fixture: caller asked for a water heater quote and booked a visit.',
                       'Retention fixture: clear service need and an agreed appointment.', 'gpt-5-mini', 912, 131, 0.000490, $5::timestamptz + interval '5 minutes')`,
              [`${fixture.callId}-assessment`, options.organizationId, fixture.callId, fixture.recordingId, startedAt],
            );
            await client.query(
              "insert into lead_assessment_evidence (lead_assessment_id, position, turn_index, start_ms, quote) values ($1, 0, 0, 0, 'I need a quote for a water heater.')",
              [`${fixture.callId}-assessment`],
            );
            await client.query(
              `insert into lead_review (call_id, organization_id, classification, note, reviewer_user_id, reviewed_at)
               values ($1, $2, 'Good Lead', 'Retention fixture Lead Review.', $3, $4::timestamptz + interval '1 hour')`,
              [fixture.callId, options.organizationId, workspace.reviewer_id, startedAt],
            );
          }
          await client.query("commit");
        } catch (error) {
          await client.query("rollback");
          throw error;
        } finally {
          client.release();
        }
        seeded.push({ fixture: fixture.fixture, callId: fixture.callId, created: true });
      }
      return seeded;
    },

    async verify(): Promise<VerifiedRetentionFixture[]> {
      const report: VerifiedRetentionFixture[] = [];
      for (const fixture of fixtures) {
        const row = (await options.pool.query<{
          media_deleted_at: Date | null;
          cleanup_due: boolean;
          twilio_cleanup_state: string;
          stored_keys: (string | null)[];
          transcripts: number;
          evidence: number;
          rationale: boolean;
        }>(
          `select r.media_deleted_at, (r.media_purged_at is not null or ${recordingMediaExpiredSql("c.started_at", "now()")}) as cleanup_due, r.twilio_cleanup_state,
                  array[case when r.transfer_state = 'Stored' then r.r2_object_key end, case when r.waveform_state = 'Stored' then r.waveform_object_key end,
                        case when r.mp3_state = 'Stored' then r.mp3_object_key end] as stored_keys,
                  (select count(*)::int from transcript where recording_id = r.id) as transcripts,
                  (select count(*)::int from lead_assessment_evidence e join lead_assessment a on a.id = e.lead_assessment_id where a.recording_id = r.id) as evidence,
                  exists (select 1 from lead_assessment where recording_id = r.id and rationale is not null) as rationale
             from call c join recording r on r.call_id = c.id
            where c.id = $1 and c.organization_id = $2`,
          [fixture.callId, options.organizationId],
        )).rows[0];
        const present = await presentKeys([fixture.keys.wav, fixture.keys.peaks, fixture.keys.mp3]);
        const base = { fixture: fixture.fixture, callId: fixture.callId };
        if (!row) {
          report.push({ ...base, status: "missing", agrees: present.length === 0, remaining: present });
          continue;
        }
        if (!row.cleanup_due && !row.media_deleted_at) {
          const missing = row.stored_keys.filter((key): key is string => key !== null && !present.includes(key)).map((key) => `${key} is missing`);
          report.push({ ...base, status: "retained", agrees: missing.length === 0, remaining: missing });
          continue;
        }
        const remaining = [
          ...(row.transcripts ? ["Transcript"] : []),
          ...(row.evidence ? ["Lead Assessment evidence"] : []),
          ...(row.rationale ? ["Lead Assessment rationale"] : []),
          ...present,
          ...(row.twilio_cleanup_state !== "Deleted" ? [`Twilio copy (${row.twilio_cleanup_state})`] : []),
        ];
        report.push(row.media_deleted_at
          ? { ...base, status: "finished", agrees: remaining.length === 0, remaining }
          : { ...base, status: "unfinished", agrees: true, remaining });
      }
      return report;
    },

    async remove(): Promise<{ calls: number; objects: number }> {
      let objects = 0;
      for (const key of await presentKeys(fixtures.flatMap((fixture) => [fixture.keys.wav, fixture.keys.peaks, fixture.keys.mp3]))) {
        await options.objects.delete(key);
        objects += 1;
      }
      const calls = await options.pool.query("delete from call where id = any($1::text[]) and organization_id = $2", [fixtures.map((fixture) => fixture.callId), options.organizationId]);
      return { calls: calls.rowCount ?? 0, objects };
    },
  };
}
