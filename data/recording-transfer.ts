/**
 * -------------------------------------------------------------------------
 * @file   recording-transfer.ts
 * @brief  Moves one Recording from Twilio to private R2 durably.
 *
 * @description
 *  Downloads a Recording's WAV from Twilio with its Organization's
 *  credential, uploads it to R2 under a deterministic key, verifies the
 *  stored size and SHA-256 checksum, and records the Recording as Stored
 *  together with its analysis eligibility, so the Transcript becomes Pending
 *  or Skipped with a reason. Only after Stored is committed does it request
 *  waveform generation and, for a Pending Transcript, transcription, and
 *  then delete the Twilio copy and record the cleanup. A rerun skips finished stages, reuses a matching object at
 *  the same key, and replaces a mismatched one.
 *
 * @remarks
 *  Each phase holds a row lock taken with NOWAIT, so a concurrent duplicate
 *  run fails fast and is retried instead of acting twice. Storage and
 *  cleanup commit in separate transactions so the Twilio delete can never
 *  run before the verified copy is durable. A failed stage is rolled back
 *  to a savepoint and recorded under the same lock with a secret-free
 *  reason before the error is rethrown for Trigger.dev to retry. The WAV is
 *  buffered in memory, which suits voicemail and connected-call lengths. A
 *  failed waveform or transcription request is ignored so it never blocks
 *  the transfer or cleanup; the recovery sweep re-requests it. Each request
 *  reuses its own Recording-derived idempotency key so reruns map to one
 *  run. Eligibility is decided once, in the Stored transaction, so the
 *  Workspace analysis setting is read when the Recording becomes Stored and
 *  a later change never backfills it. The Stored commit appends Recording
 *  transferred, and Transcript skipped when analysis is skipped, and a
 *  failed download, upload, or verify appends one Recording transfer
 *  failed event, so a Twilio cleanup failure never reaches Activity.
 *
 * @see
 *  data/r2-objects.ts
 *  data/twilio-client.ts
 *  data/recording-waveform.ts
 *  data/analysis-eligibility.ts
 *  trigger/recording-transfer.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool, PoolClient } from "pg";

import { analysisEligibility } from "@/data/analysis-eligibility";
import { appendCallEvent } from "@/data/call-events";
import { connectedSecondsSql, spamGateResult, type KeypadEvent } from "@/data/call-details";
import { parseCallFlowGraph, type OutcomeKind } from "@/data/call-flow";
import { decryptSecret } from "@/data/credential-encryption";
import { R2ObjectError, sha256Hex, type RecordingObjects, type StoredObject } from "@/data/r2-objects";
import type { RecordingProcessing, RecordingSource } from "@/data/recording";
import { TwilioClientError, type TwilioCredential, type TwilioRecordingMedia } from "@/data/twilio-client";

export interface RecordingTransferDependencies {
  pool: Pool;
  masterKey: string;
  twilio: TwilioRecordingMedia;
  objects: RecordingObjects;
  waveform: RecordingProcessing;
  transcription: RecordingProcessing;
  now: () => Date;
}

type FailureStage = "download" | "upload" | "verify" | "cleanup";

type Progress = { stage: FailureStage | null };

type RecordingRow = {
  id: string;
  organization_id: string;
  workspace_id: string;
  call_id: string;
  twilio_recording_sid: string;
  transfer_state: string;
  twilio_cleanup_state: string;
  transcript_state: string | null;
  account_sid: string | null;
  api_key_sid: string | null;
  api_key_secret_ciphertext: string | null;
};

export class RecordingTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingTransferError";
  }
}

export function recordingObjectKey(recording: { id: string; organizationId: string; workspaceId: string; callId: string }): string {
  return `organizations/${recording.organizationId}/workspaces/${recording.workspaceId}/calls/${recording.callId}/recordings/${recording.id}.wav`;
}

function matches(stored: StoredObject | null, object: StoredObject): boolean {
  return stored?.sizeBytes === object.sizeBytes && stored.sha256 === object.sha256;
}

async function lockRecording(client: PoolClient, recordingId: string): Promise<RecordingRow | undefined> {
  const result = await client.query<RecordingRow>(
    `select r.id, r.organization_id, r.workspace_id, r.call_id, r.twilio_recording_sid, r.transfer_state, r.twilio_cleanup_state, r.transcript_state,
            c.account_sid, c.api_key_sid, c.api_key_secret_ciphertext
       from recording r
       left join twilio_connection c on c.organization_id = r.organization_id
      where r.id = $1
        for update of r nowait`,
    [recordingId],
  );
  return result.rows[0];
}

async function credential(deps: RecordingTransferDependencies, row: RecordingRow): Promise<TwilioCredential> {
  return { accountSid: row.account_sid!, apiKeySid: row.api_key_sid!, apiKeySecret: await decryptSecret(deps.masterKey, row.api_key_secret_ciphertext!) };
}

async function transcriptDecision(client: PoolClient, row: RecordingRow): Promise<{ state: "Pending" | "Skipped"; skipReason: string | null }> {
  const facts = await client.query<{ analysis_enabled: boolean; source: RecordingSource; duration_seconds: number | null; connected_seconds: number | null; outcome: OutcomeKind | null; graph: unknown }>(
    `select w.analysis_enabled, r.source, r.duration_seconds, ${connectedSecondsSql} as connected_seconds, c.outcome, f.graph
       from recording r
       join workspace w on w.id = r.workspace_id
       join call c on c.id = r.call_id
       join flow_version f on f.id = c.flow_version_id
      where r.id = $1`,
    [row.id],
  );
  const gathers = await client.query<KeypadEvent>(
    `select kind, idempotency_key, payload->>'Digits' as digits
       from provider_event
      where call_id = $1 and organization_id = $2 and disposition = 'accepted' and kind = 'gather'`,
    [row.call_id, row.organization_id],
  );
  const fact = facts.rows[0];
  const eligibility = analysisEligibility({
    analysisEnabled: fact.analysis_enabled,
    spamGate: spamGateResult(parseCallFlowGraph(fact.graph), fact.outcome, gathers.rows),
    source: fact.source,
    connectedDurationSeconds: fact.connected_seconds,
    recordingDurationSeconds: fact.duration_seconds,
  });
  return eligibility.eligible ? { state: "Pending", skipReason: null } : { state: "Skipped", skipReason: eligibility.reason };
}

async function store(deps: RecordingTransferDependencies, client: PoolClient, row: RecordingRow, progress: Progress): Promise<string> {
  progress.stage = "download";
  const bytes = await deps.twilio.downloadRecording(await credential(deps, row), row.twilio_recording_sid);
  const object = { sizeBytes: bytes.byteLength, sha256: await sha256Hex(bytes) };
  const key = recordingObjectKey({ id: row.id, organizationId: row.organization_id, workspaceId: row.workspace_id, callId: row.call_id });
  progress.stage = "upload";
  if (!matches(await deps.objects.head(key), object)) {
    await deps.objects.put(key, bytes, object);
    progress.stage = "verify";
    if (!matches(await deps.objects.head(key), object)) {
      throw new RecordingTransferError("R2 object does not match the Twilio download");
    }
  }
  const transcript = await transcriptDecision(client, row);
  const now = deps.now();
  await client.query(
    `update recording
        set transfer_state = 'Stored', r2_object_key = $2, size_bytes = $3, sha256 = $4, stored_at = $5,
            transcript_state = $6, transcript_skip_reason = $7,
            failure_stage = null, failure_reason = null, updated_at = $5
      where id = $1`,
    [row.id, key, object.sizeBytes, object.sha256, now, transcript.state, transcript.skipReason],
  );
  await appendCallEvent(client, { callId: row.call_id, kind: "recording_transferred", key: `recording_transferred:${row.id}`, occurredAt: now });
  if (transcript.state === "Skipped") {
    await appendCallEvent(client, { callId: row.call_id, kind: "transcript_skipped", key: `transcript_skipped:${row.id}`, occurredAt: now, detail: { reason: transcript.skipReason! } });
  }
  return transcript.state;
}

async function cleanUp(deps: RecordingTransferDependencies, client: PoolClient, row: RecordingRow, progress: Progress): Promise<void> {
  progress.stage = "cleanup";
  await deps.twilio.deleteRecording(await credential(deps, row), row.twilio_recording_sid);
  await client.query(
    `update recording
        set twilio_cleanup_state = 'Deleted', twilio_deleted_at = $2, failure_stage = null, failure_reason = null, updated_at = $2
      where id = $1`,
    [row.id, deps.now()],
  );
}

function failureReason(error: unknown, stage: FailureStage): string {
  return error instanceof TwilioClientError || error instanceof R2ObjectError || error instanceof RecordingTransferError ? error.message : `Recording ${stage} failed`;
}

async function recordFailure(deps: RecordingTransferDependencies, client: PoolClient, row: RecordingRow, stage: FailureStage, error: unknown): Promise<void> {
  const now = deps.now();
  await client.query(
    stage === "cleanup"
      ? "update recording set twilio_cleanup_state = 'Failed', failure_stage = $2, failure_reason = $3, updated_at = $4 where id = $1"
      : "update recording set transfer_state = 'Failed', failure_stage = $2, failure_reason = $3, updated_at = $4 where id = $1",
    [row.id, stage, failureReason(error, stage), now],
  );
  if (stage !== "cleanup") {
    await appendCallEvent(client, { callId: row.call_id, kind: "recording_transfer_failed", key: `recording_transfer_failed:${row.id}`, occurredAt: now, detail: { stage } });
  }
}

async function withLockedRecording(
  deps: RecordingTransferDependencies,
  recordingId: string,
  work: (client: PoolClient, row: RecordingRow, progress: Progress) => Promise<void>,
): Promise<void> {
  const client = await deps.pool.connect();
  const progress: Progress = { stage: null };
  try {
    await client.query("begin");
    const row = await lockRecording(client, recordingId);
    if (row) {
      await client.query("savepoint stage");
      try {
        await work(client, row, progress);
      } catch (error) {
        if (!progress.stage) throw error;
        await client.query("rollback to savepoint stage");
        await recordFailure(deps, client, row, progress.stage, error);
        await client.query("commit");
        throw error;
      }
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function transferRecording(deps: RecordingTransferDependencies, recordingId: string): Promise<void> {
  let storedOrganizationId: string | null = null;
  let transcriptState = null as string | null;
  await withLockedRecording(deps, recordingId, async (client, row, progress) => {
    transcriptState = row.transfer_state === "Stored" ? row.transcript_state : await store(deps, client, row, progress);
    storedOrganizationId = row.organization_id;
  });
  if (storedOrganizationId) {
    await deps.waveform.request({ id: recordingId, organizationId: storedOrganizationId, idempotencyKey: `recording-waveform:${recordingId}` }).catch(() => undefined);
    if (transcriptState === "Pending") {
      await deps.transcription.request({ id: recordingId, organizationId: storedOrganizationId, idempotencyKey: `recording-transcription:${recordingId}` }).catch(() => undefined);
    }
  }
  await withLockedRecording(deps, recordingId, async (client, row, progress) => {
    if (row.transfer_state === "Stored" && row.twilio_cleanup_state !== "Deleted") await cleanUp(deps, client, row, progress);
  });
}
