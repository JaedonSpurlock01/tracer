/**
 * -------------------------------------------------------------------------
 * @file   workspace-routing.ts
 * @brief  Provides Workspace activation and Call Flow routing operations.
 *
 * @description
 *  Owns number assignments, Call Flow drafts and versions, Twilio voice
 *  configuration changes, publication, activation, and archive restoration.
 *
 * @remarks
 *  Routing mutations use the Workspace advisory lock and keep provider changes
 *  inside the database transaction boundary wherever rollback is possible.
 *
 * @see
 *  data/call-flow.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import {
  generateInitialCallFlow,
  parseCallFlowGraph,
  ttsVoices,
  validateCallFlow,
  type CallFlowGraph,
  type FlowNode,
  type TtsVoice,
  type ValidationIssue,
  type ValidationResult,
} from "@/data/call-flow";
import { IntegrationsError, type Integrations } from "@/data/integrations";
import { normalizeE164PhoneNumber } from "@/data/phone-number";
import { TwilioClientError, type TwilioClient, type TwilioCredential, type TwilioVoiceConfiguration } from "@/data/twilio-client";
import { type WorkspaceRecord, type Workspaces } from "@/data/workspaces";
import type { WorkspaceState } from "@/data/workspace-policy";

export type RoutingErrorCode =
  | "invalid_input"
  | "not_found"
  | "state_unchanged"
  | "twilio_not_connected"
  | "twilio_auth_token_missing"
  | "number_unavailable"
  | "draft_required"
  | "draft_invalid"
  | "activation_required"
  | "disclosure_required"
  | "provider_unavailable";

export class RoutingError extends Error {
  constructor(
    public readonly code: RoutingErrorCode,
    public readonly detail?: string,
    public readonly issues?: ValidationIssue[],
  ) {
    super(code);
    this.name = "RoutingError";
  }
}

export interface RoutingSettingsInput {
  destinationNumber: string;
  recordingEnabled: boolean;
  analysisEnabled: boolean;
  spamGateEnabled: boolean;
  whisperEnabled: boolean;
  whisperMessage: string | null;
  disclosureVoice?: TtsVoice;
}

export interface AvailableNumber {
  id: string;
  twilioSid: string;
  phoneNumber: string;
  friendlyName: string;
  voiceUrl: string | null;
  assignedWorkspace: { id: string; name: string } | null;
}

export interface FlowVersionSummary {
  id: string;
  version: number;
  publishedAt: string;
  publishedBy: { id: string; name: string } | null;
}

export interface FlowState {
  draft: { graph: CallFlowGraph; basedOnVersion: number | null; updatedAt: string } | null;
  validation: ValidationResult | null;
  versions: FlowVersionSummary[];
  published: { version: number; graph: CallFlowGraph } | null;
  recordingEnabled: boolean;
  workspaceState: WorkspaceState;
}

export interface WorkspaceRouting {
  listAvailableNumbers(): Promise<AvailableNumber[]>;
  updateRoutingSettings(workspaceId: string, input: RoutingSettingsInput, actorUserId: string): Promise<WorkspaceRecord>;
  getFlow(workspaceId: string): Promise<FlowState>;
  getVersion(workspaceId: string, version: number): Promise<{ summary: FlowVersionSummary; graph: CallFlowGraph }>;
  saveDraft(workspaceId: string, graph: unknown, actorUserId: string): Promise<{ validation: ValidationResult; updatedAt: string }>;
  discardDraft(workspaceId: string): Promise<void>;
  activate(workspaceId: string, input: { twilioNumberId: string; actorUserId: string }): Promise<WorkspaceRecord>;
  replaceNumber(workspaceId: string, input: { twilioNumberId: string }): Promise<WorkspaceRecord>;
  publish(workspaceId: string, actorUserId: string): Promise<WorkspaceRecord>;
  archive(workspaceId: string): Promise<WorkspaceRecord>;
}

interface WorkspaceRow {
  id: string;
  state: WorkspaceState;
  recording_enabled: boolean;
  name?: string;
}

interface DraftRow {
  graph: unknown;
  based_on_version: number | null;
  updated_at: Date;
}

interface VersionRow {
  id: string;
  version: number;
  graph: unknown;
  published_at: Date;
  published_by_id: string | null;
  published_by_name: string | null;
}

interface NumberRow {
  id: string;
  twilio_sid: string;
  phone_number: string;
  friendly_name: string;
  voice_url: string | null;
  voice_method: string | null;
  released_at: Date | null;
  voice_capable: boolean;
}

interface AvailableNumberRow extends NumberRow {
  assigned_workspace_id: string | null;
  assigned_workspace_name: string | null;
}

interface AssignmentRow {
  id: string;
  twilio_sid: string;
  phone_number: string;
  prior_voice_url: string | null;
  prior_voice_method: string | null;
  prior_voice_fallback_url: string | null;
  prior_voice_fallback_method: string | null;
  prior_status_callback_url: string | null;
  prior_status_callback_method: string | null;
}

async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function mapIntegrationsError(error: IntegrationsError): RoutingError {
  return error.code === "not_connected"
    ? new RoutingError("twilio_not_connected", error.detail)
    : new RoutingError("provider_unavailable", error.detail);
}

function requireGraph(value: unknown): CallFlowGraph {
  const graph = parseCallFlowGraph(value);
  if (!graph) throw new RoutingError("draft_invalid", "Call Flow graph is malformed.");
  return graph;
}

function validateDraft(graph: CallFlowGraph, recordingEnabled: boolean): ValidationResult {
  return validateCallFlow(graph, { recordingEnabled });
}

function settingsFromGraph(graph: CallFlowGraph): {
  destinationNumber: string;
  spamGateEnabled: boolean;
  whisperEnabled: boolean;
  whisperMessage: string | null;
} {
  const forward = graph.nodes.find((node): node is Extract<FlowNode, { type: "forward_call" }> => node.type === "forward_call");
  const whisper = graph.nodes.find((node): node is Extract<FlowNode, { type: "whisper" }> => node.type === "whisper");
  return {
    destinationNumber: forward ? (normalizeE164PhoneNumber(forward.destinationNumber) ?? forward.destinationNumber) : "",
    spamGateEnabled: graph.nodes.some((node) => node.type === "keypad_gate"),
    whisperEnabled: Boolean(whisper),
    whisperMessage: whisper?.message ?? null,
  };
}

function summary(row: VersionRow): FlowVersionSummary {
  return {
    id: row.id,
    version: Number(row.version),
    publishedAt: row.published_at.toISOString(),
    publishedBy: row.published_by_id && row.published_by_name ? { id: row.published_by_id, name: row.published_by_name } : null,
  };
}

function voiceConfiguration(row: AssignmentRow): TwilioVoiceConfiguration {
  return {
    voiceUrl: row.prior_voice_url,
    voiceMethod: row.prior_voice_method,
    voiceFallbackUrl: row.prior_voice_fallback_url,
    voiceFallbackMethod: row.prior_voice_fallback_method,
    statusCallback: row.prior_status_callback_url,
    statusCallbackMethod: row.prior_status_callback_method,
  };
}

export function createWorkspaceRouting(options: {
  pool: Pool;
  organizationId: string;
  twilio: TwilioClient;
  integrations: Integrations;
  workspaces: Workspaces;
  baseURL: string;
}): WorkspaceRouting {
  const lock = `tracer:workspaces:${options.organizationId}`;
  const baseURL = options.baseURL.replace(/\/$/, "");

  function tracerVoiceConfiguration(assignmentId: string): TwilioVoiceConfiguration {
    return {
      voiceUrl: `${baseURL}/api/twilio/voice/${assignmentId}`,
      voiceMethod: "POST",
      voiceFallbackUrl: null,
      voiceFallbackMethod: null,
      statusCallback: `${baseURL}/api/twilio/status/${assignmentId}`,
      statusCallbackMethod: "POST",
    };
  }

  async function lockAvailableNumber(client: PoolClient, twilioNumberId: string): Promise<NumberRow> {
    const numberResult = await client.query<NumberRow>(
      "select id, twilio_sid, phone_number, friendly_name, voice_url, voice_method, released_at, voice_capable from twilio_number where organization_id = $1 and id = $2 for update",
      [options.organizationId, twilioNumberId],
    );
    const number = numberResult.rows[0];
    if (!number) throw new RoutingError("not_found");
    if (number.released_at || !number.voice_capable) throw new RoutingError("number_unavailable");
    const active = await client.query(
      "select 1 from number_assignment where organization_id = $1 and twilio_number_id = $2 and ended_at is null limit 1",
      [options.organizationId, twilioNumberId],
    );
    if (active.rowCount) throw new RoutingError("number_unavailable");
    return number;
  }

  async function lockOrganization(client: PoolClient): Promise<void> {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [lock]);
  }

  async function findWorkspace(client: Pool | PoolClient, workspaceId: string, forUpdate = false): Promise<WorkspaceRow> {
    const result = await client.query<WorkspaceRow>(
      `select id, state, recording_enabled from workspace where organization_id = $1 and id = $2${forUpdate ? " for update" : ""}`,
      [options.organizationId, workspaceId],
    );
    const row = result.rows[0];
    if (!row) throw new RoutingError("not_found");
    return row;
  }

  async function latestVersion(client: Pool | PoolClient, workspaceId: string): Promise<VersionRow | null> {
    const result = await client.query<VersionRow>(
      `select fv.id, fv.version, fv.graph, fv.published_at, fv.published_by_user_id as published_by_id, u.name as published_by_name
         from flow_version fv
         left join "user" u on u.id = fv.published_by_user_id
        where fv.organization_id = $1 and fv.workspace_id = $2
        order by fv.version desc
        limit 1`,
      [options.organizationId, workspaceId],
    );
    return result.rows[0] ?? null;
  }

  async function draft(client: Pool | PoolClient, workspaceId: string): Promise<DraftRow | null> {
    const result = await client.query<DraftRow>(
      "select graph, based_on_version, updated_at from call_flow_draft where organization_id = $1 and workspace_id = $2",
      [options.organizationId, workspaceId],
    );
    return result.rows[0] ?? null;
  }

  async function saveDraftRow(
    client: PoolClient,
    workspaceId: string,
    graph: CallFlowGraph,
    basedOnVersion: number | null,
    actorUserId: string,
    updatedAt: Date,
  ): Promise<void> {
    await client.query(
      `insert into call_flow_draft (id, organization_id, workspace_id, graph, based_on_version, updated_by_user_id, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $7)
       on conflict (workspace_id) do update set graph = excluded.graph, based_on_version = excluded.based_on_version, updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at`,
      [randomUUID(), options.organizationId, workspaceId, graph, basedOnVersion, actorUserId, updatedAt],
    );
  }

  async function insertVersion(
    client: PoolClient,
    workspaceId: string,
    graph: CallFlowGraph,
    actorUserId: string,
    publishedAt: Date,
  ): Promise<number> {
    const next = await client.query<{ version: number }>(
      "select coalesce(max(version), 0) + 1 as version from flow_version where organization_id = $1 and workspace_id = $2",
      [options.organizationId, workspaceId],
    );
    const version = Number(next.rows[0].version);
    await client.query(
      `insert into flow_version (id, organization_id, workspace_id, version, graph, published_by_user_id, published_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), options.organizationId, workspaceId, version, graph, actorUserId, publishedAt],
    );
    return version;
  }

  async function updateWorkspaceFromGraph(
    client: PoolClient,
    workspaceId: string,
    graph: CallFlowGraph,
    state?: "Active" | "Archived",
    archivedAt: Date | null = null,
  ): Promise<void> {
    const settings = settingsFromGraph(graph);
    await client.query(
      `update workspace
          set destination_number = $3, spam_gate_enabled = $4, whisper_enabled = $5,
              whisper_message = $6, state = coalesce($7, state), archived_at = $8,
              updated_at = $9
        where organization_id = $1 and id = $2`,
      [
        options.organizationId,
        workspaceId,
        settings.destinationNumber,
        settings.spamGateEnabled,
        settings.whisperEnabled,
        settings.whisperMessage,
        state ?? null,
        archivedAt,
        new Date(),
      ],
    );
  }

  async function currentSettingsInput(
    input: RoutingSettingsInput,
  ): Promise<RoutingSettingsInput & { destinationNumber: string; disclosureVoice: TtsVoice }> {
    if (
      typeof input.destinationNumber !== "string" ||
      typeof input.recordingEnabled !== "boolean" ||
      typeof input.analysisEnabled !== "boolean" ||
      typeof input.spamGateEnabled !== "boolean" ||
      typeof input.whisperEnabled !== "boolean" ||
      (input.whisperMessage !== null && typeof input.whisperMessage !== "string")
    )
      throw new RoutingError("invalid_input");
    const destinationNumber = normalizeE164PhoneNumber(input.destinationNumber);
    if (!destinationNumber || (input.analysisEnabled && !input.recordingEnabled)) throw new RoutingError("invalid_input");
    const disclosureVoice = input.disclosureVoice ?? "Polly.Joanna";
    if (!ttsVoices.includes(disclosureVoice)) throw new RoutingError("invalid_input");
    if (
      input.whisperEnabled &&
      (typeof input.whisperMessage !== "string" || input.whisperMessage.trim().length < 1 || input.whisperMessage.trim().length > 500)
    )
      throw new RoutingError("invalid_input");
    return { ...input, destinationNumber, disclosureVoice };
  }

  return {
    async listAvailableNumbers() {
      const result = await options.pool.query<AvailableNumberRow>(
        `select n.id, n.twilio_sid, n.phone_number, n.friendly_name, n.voice_url, n.voice_method,
                n.released_at, n.voice_capable, w.id as assigned_workspace_id, w.name as assigned_workspace_name
           from twilio_number n
           left join number_assignment a on a.twilio_number_id = n.id and a.organization_id = n.organization_id and a.ended_at is null
           left join workspace w on w.id = a.workspace_id and w.organization_id = a.organization_id
          where n.organization_id = $1 and n.released_at is null and n.voice_capable
          order by n.phone_number`,
        [options.organizationId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        twilioSid: row.twilio_sid,
        phoneNumber: row.phone_number,
        friendlyName: row.friendly_name,
        voiceUrl: row.voice_url,
        assignedWorkspace:
          row.assigned_workspace_id && row.assigned_workspace_name
            ? { id: row.assigned_workspace_id, name: row.assigned_workspace_name }
            : null,
      }));
    },

    async updateRoutingSettings(workspaceId, input, actorUserId) {
      const settings = await currentSettingsInput(input);
      await withTransaction(options.pool, async (client) => {
        await lockOrganization(client);
        const workspace = await findWorkspace(client, workspaceId, true);
        if (workspace.state === "Archived") throw new RoutingError("state_unchanged");
        const published = await latestVersion(client, workspaceId);
        if (published && settings.recordingEnabled) {
          const publishedGraph = requireGraph(published.graph);
          if (validateDraft(publishedGraph, true).issues.some((issue) => issue.code === "disclosure_required"))
            throw new RoutingError("disclosure_required");
        }
        await client.query(
          `update workspace
              set destination_number = $3, recording_enabled = $4, analysis_enabled = $5,
                  spam_gate_enabled = $6, whisper_enabled = $7, whisper_message = $8, updated_at = $9
            where organization_id = $1 and id = $2`,
          [
            options.organizationId,
            workspaceId,
            settings.destinationNumber,
            settings.recordingEnabled,
            settings.analysisEnabled,
            settings.spamGateEnabled,
            settings.whisperEnabled,
            settings.whisperMessage,
            new Date(),
          ],
        );
        if (!published) {
          await saveDraftRow(client, workspaceId, generateInitialCallFlow(settings), null, actorUserId, new Date());
        }
      });
      const result = await options.workspaces.find(workspaceId);
      if (!result) throw new RoutingError("not_found");
      return result;
    },

    async getFlow(workspaceId) {
      const workspace = await findWorkspace(options.pool, workspaceId);
      const draftRow = await draft(options.pool, workspaceId);
      const latest = await latestVersion(options.pool, workspaceId);
      const versionsResult = await options.pool.query<VersionRow>(
        `select fv.id, fv.version, fv.graph, fv.published_at, fv.published_by_user_id as published_by_id, u.name as published_by_name
           from flow_version fv
           left join "user" u on u.id = fv.published_by_user_id
          where fv.organization_id = $1 and fv.workspace_id = $2
          order by fv.version desc`,
        [options.organizationId, workspaceId],
      );
      const draftGraph = draftRow ? requireGraph(draftRow.graph) : null;
      const publishedGraph = latest ? requireGraph(latest.graph) : null;
      return {
        draft:
          draftGraph && draftRow
            ? { graph: draftGraph, basedOnVersion: draftRow.based_on_version, updatedAt: draftRow.updated_at.toISOString() }
            : null,
        validation: draftGraph ? validateDraft(draftGraph, workspace.recording_enabled) : null,
        versions: versionsResult.rows.map(summary),
        published: publishedGraph && latest ? { version: Number(latest.version), graph: publishedGraph } : null,
        recordingEnabled: workspace.recording_enabled,
        workspaceState: workspace.state,
      };
    },

    async getVersion(workspaceId, version) {
      await findWorkspace(options.pool, workspaceId);
      const result = await options.pool.query<VersionRow>(
        `select fv.id, fv.version, fv.graph, fv.published_at, fv.published_by_user_id as published_by_id, u.name as published_by_name
           from flow_version fv
           left join "user" u on u.id = fv.published_by_user_id
          where fv.organization_id = $1 and fv.workspace_id = $2 and fv.version = $3`,
        [options.organizationId, workspaceId, version],
      );
      const row = result.rows[0];
      if (!row) throw new RoutingError("not_found");
      return { summary: summary(row), graph: requireGraph(row.graph) };
    },

    async saveDraft(workspaceId, graphValue, actorUserId) {
      const graph = parseCallFlowGraph(graphValue);
      if (!graph) throw new RoutingError("invalid_input");
      let updatedAt = new Date();
      let validation: ValidationResult;
      await withTransaction(options.pool, async (client) => {
        await lockOrganization(client);
        const workspace = await findWorkspace(client, workspaceId, true);
        if (workspace.state === "Archived") throw new RoutingError("state_unchanged");
        const latest = await latestVersion(client, workspaceId);
        validation = validateDraft(graph, workspace.recording_enabled);
        updatedAt = new Date();
        await saveDraftRow(client, workspaceId, graph, latest?.version ?? null, actorUserId, updatedAt);
      });
      return { validation: validation!, updatedAt: updatedAt.toISOString() };
    },

    async discardDraft(workspaceId) {
      await withTransaction(options.pool, async (client) => {
        await lockOrganization(client);
        const workspace = await findWorkspace(client, workspaceId, true);
        if (workspace.state === "Archived") throw new RoutingError("state_unchanged");
        await client.query("delete from call_flow_draft where organization_id = $1 and workspace_id = $2", [
          options.organizationId,
          workspaceId,
        ]);
      });
    },

    async activate(workspaceId, input) {
      let snapshot: TwilioVoiceConfiguration | null = null;
      let updated = false;
      let sid = "";
      try {
        await withTransaction(options.pool, async (client) => {
          await lockOrganization(client);
          const workspace = await findWorkspace(client, workspaceId, true);
          if (workspace.state !== "Setup Required") throw new RoutingError("state_unchanged");
          const number = await lockAvailableNumber(client, input.twilioNumberId);
          const existingDraft = await draft(client, workspaceId);
          const latest = await latestVersion(client, workspaceId);
          const graph = existingDraft ? requireGraph(existingDraft.graph) : latest ? requireGraph(latest.graph) : null;
          if (!graph) throw new RoutingError("draft_required");
          const validation = validateDraft(graph, workspace.recording_enabled);
          if (!validation.valid) throw new RoutingError("draft_invalid", undefined, validation.issues);
          const connection = await options.integrations.getTwilioConnection(client);
          if (connection && !connection.authTokenConfigured) throw new RoutingError("twilio_auth_token_missing");
          sid = number.twilio_sid;
          await options.integrations.withTwilioCredential(
            async (credential: TwilioCredential) => {
              const fetched = await options.twilio.fetchIncomingPhoneNumber(credential, number.twilio_sid);
              snapshot = {
                voiceUrl: fetched.voiceUrl,
                voiceMethod: fetched.voiceMethod,
                voiceFallbackUrl: fetched.voiceFallbackUrl,
                voiceFallbackMethod: fetched.voiceFallbackMethod,
                statusCallback: fetched.statusCallback,
                statusCallbackMethod: fetched.statusCallbackMethod,
              };
              const assignmentId = randomUUID();
              const now = new Date();
              await client.query(
                `insert into number_assignment
                 (id, organization_id, workspace_id, twilio_number_id, phone_number, prior_voice_url, prior_voice_method,
                  prior_voice_fallback_url, prior_voice_fallback_method, prior_status_callback_url, prior_status_callback_method,
                  started_at, created_at)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
                [
                  assignmentId,
                  options.organizationId,
                  workspaceId,
                  input.twilioNumberId,
                  number.phone_number,
                  snapshot.voiceUrl,
                  snapshot.voiceMethod,
                  snapshot.voiceFallbackUrl,
                  snapshot.voiceFallbackMethod,
                  snapshot.statusCallback,
                  snapshot.statusCallbackMethod,
                  now,
                ],
              );
              await insertVersion(client, workspaceId, graph, input.actorUserId, now);
              await client.query("delete from call_flow_draft where organization_id = $1 and workspace_id = $2", [
                options.organizationId,
                workspaceId,
              ]);
              await updateWorkspaceFromGraph(client, workspaceId, graph, "Active", null);
              await options.twilio.updateIncomingPhoneNumberVoice(credential, number.twilio_sid, tracerVoiceConfiguration(assignmentId));
              updated = true;
            },
            { client, deferFailureRecording: true },
          );
        });
      } catch (error) {
        if (updated && snapshot && sid) {
          try {
            await options.integrations.withTwilioCredential((credential) =>
              options.twilio.updateIncomingPhoneNumberVoice(credential, sid, snapshot!),
            );
          } catch {}
        }
        if (error instanceof TwilioClientError) throw mapIntegrationsError(await options.integrations.recordTwilioFailure(error));
        if (error instanceof IntegrationsError) throw mapIntegrationsError(error);
        throw error;
      }
      const result = await options.workspaces.find(workspaceId);
      if (!result) throw new RoutingError("not_found");
      return result;
    },

    async replaceNumber(workspaceId, input) {
      let attached: { sid: string; snapshot: TwilioVoiceConfiguration } | null = null;
      try {
        await withTransaction(options.pool, async (client) => {
          await lockOrganization(client);
          const workspace = await findWorkspace(client, workspaceId, true);
          if (workspace.state === "Setup Required") throw new RoutingError("activation_required");
          if (workspace.state === "Archived") throw new RoutingError("state_unchanged");
          const current = (
            await client.query<AssignmentRow>(
              `select a.id, n.twilio_sid, a.phone_number, a.prior_voice_url, a.prior_voice_method,
                      a.prior_voice_fallback_url, a.prior_voice_fallback_method,
                      a.prior_status_callback_url, a.prior_status_callback_method
                 from number_assignment a
                 join twilio_number n on n.id = a.twilio_number_id and n.organization_id = a.organization_id
                where a.organization_id = $1 and a.workspace_id = $2 and a.ended_at is null
                limit 1`,
              [options.organizationId, workspaceId],
            )
          ).rows[0];
          if (!current) throw new RoutingError("number_unavailable");
          const number = await lockAvailableNumber(client, input.twilioNumberId);
          const connection = await options.integrations.getTwilioConnection(client);
          if (connection && !connection.authTokenConfigured) throw new RoutingError("twilio_auth_token_missing");
          await options.integrations.withTwilioCredential(
            async (credential: TwilioCredential) => {
              const fetched = await options.twilio.fetchIncomingPhoneNumber(credential, number.twilio_sid);
              const snapshot: TwilioVoiceConfiguration = {
                voiceUrl: fetched.voiceUrl,
                voiceMethod: fetched.voiceMethod,
                voiceFallbackUrl: fetched.voiceFallbackUrl,
                voiceFallbackMethod: fetched.voiceFallbackMethod,
                statusCallback: fetched.statusCallback,
                statusCallbackMethod: fetched.statusCallbackMethod,
              };
              const assignmentId = randomUUID();
              const now = new Date();
              await client.query(
                "update number_assignment set ended_at = $3, ended_reason = 'replaced' where organization_id = $1 and id = $2",
                [options.organizationId, current.id, now],
              );
              await client.query(
                `insert into number_assignment
                 (id, organization_id, workspace_id, twilio_number_id, phone_number, prior_voice_url, prior_voice_method,
                  prior_voice_fallback_url, prior_voice_fallback_method, prior_status_callback_url, prior_status_callback_method,
                  started_at, created_at)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
                [
                  assignmentId,
                  options.organizationId,
                  workspaceId,
                  number.id,
                  number.phone_number,
                  snapshot.voiceUrl,
                  snapshot.voiceMethod,
                  snapshot.voiceFallbackUrl,
                  snapshot.voiceFallbackMethod,
                  snapshot.statusCallback,
                  snapshot.statusCallbackMethod,
                  now,
                ],
              );
              await options.twilio.updateIncomingPhoneNumberVoice(credential, number.twilio_sid, tracerVoiceConfiguration(assignmentId));
              attached = { sid: number.twilio_sid, snapshot };
              await options.twilio.updateIncomingPhoneNumberVoice(credential, current.twilio_sid, voiceConfiguration(current));
            },
            { client, deferFailureRecording: true },
          );
        });
      } catch (error) {
        const compensation = attached as { sid: string; snapshot: TwilioVoiceConfiguration } | null;
        if (compensation) {
          try {
            await options.integrations.withTwilioCredential((credential) =>
              options.twilio.updateIncomingPhoneNumberVoice(credential, compensation.sid, compensation.snapshot),
            );
          } catch {}
        }
        if (error instanceof TwilioClientError) throw mapIntegrationsError(await options.integrations.recordTwilioFailure(error));
        if (error instanceof IntegrationsError) throw mapIntegrationsError(error);
        throw error;
      }
      const result = await options.workspaces.find(workspaceId);
      if (!result) throw new RoutingError("not_found");
      return result;
    },

    async publish(workspaceId, actorUserId) {
      await withTransaction(options.pool, async (client) => {
        await lockOrganization(client);
        const workspace = await findWorkspace(client, workspaceId, true);
        if (workspace.state === "Setup Required") throw new RoutingError("activation_required");
        if (workspace.state === "Archived") throw new RoutingError("state_unchanged");
        const existingDraft = await draft(client, workspaceId);
        if (!existingDraft) throw new RoutingError("draft_required");
        const graph = requireGraph(existingDraft.graph);
        const validation = validateDraft(graph, workspace.recording_enabled);
        if (!validation.valid) throw new RoutingError("draft_invalid", undefined, validation.issues);
        const now = new Date();
        await insertVersion(client, workspaceId, graph, actorUserId, now);
        await updateWorkspaceFromGraph(client, workspaceId, graph);
        await client.query("delete from call_flow_draft where organization_id = $1 and workspace_id = $2", [
          options.organizationId,
          workspaceId,
        ]);
      });
      const result = await options.workspaces.find(workspaceId);
      if (!result) throw new RoutingError("not_found");
      return result;
    },

    async archive(workspaceId) {
      try {
        await withTransaction(options.pool, async (client) => {
          await lockOrganization(client);
          const workspace = await findWorkspace(client, workspaceId, true);
          if (workspace.state === "Archived") throw new RoutingError("state_unchanged");
          if (workspace.state === "Setup Required") {
            await client.query(
              "update workspace set state = 'Archived', archived_at = $3, updated_at = $3 where organization_id = $1 and id = $2",
              [options.organizationId, workspaceId, new Date()],
            );
            return;
          }
          const assignmentResult = await client.query<AssignmentRow>(
            `select a.id, n.twilio_sid, a.phone_number, a.prior_voice_url, a.prior_voice_method,
                    a.prior_voice_fallback_url, a.prior_voice_fallback_method,
                    a.prior_status_callback_url, a.prior_status_callback_method
               from number_assignment a
               join twilio_number n on n.id = a.twilio_number_id and n.organization_id = a.organization_id
              where a.organization_id = $1 and a.workspace_id = $2 and a.ended_at is null
              limit 1`,
            [options.organizationId, workspaceId],
          );
          const assignment = assignmentResult.rows[0];
          if (!assignment) throw new RoutingError("number_unavailable");
          await options.integrations.withTwilioCredential(
            async (credential) => {
              await options.twilio.updateIncomingPhoneNumberVoice(credential, assignment.twilio_sid, voiceConfiguration(assignment));
              const now = new Date();
              await client.query(
                "update number_assignment set ended_at = $3, ended_reason = 'archived' where organization_id = $1 and id = $2",
                [options.organizationId, assignment.id, now],
              );
              await client.query(
                "update workspace set state = 'Archived', archived_at = $3, updated_at = $3 where organization_id = $1 and id = $2",
                [options.organizationId, workspaceId, now],
              );
            },
            { client, deferFailureRecording: true },
          );
        });
      } catch (error) {
        if (error instanceof TwilioClientError) throw mapIntegrationsError(await options.integrations.recordTwilioFailure(error));
        if (error instanceof IntegrationsError) throw mapIntegrationsError(error);
        throw error;
      }
      const result = await options.workspaces.find(workspaceId);
      if (!result) throw new RoutingError("not_found");
      return result;
    },
  };
}
