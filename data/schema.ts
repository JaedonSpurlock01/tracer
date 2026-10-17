/**
 * -------------------------------------------------------------------------
 * @file   schema.ts
 * @brief  Defines Tracer's PostgreSQL schema.
 *
 * @description
 *  Declares application and Better Auth tables shared by migrations and
 *  repository queries.
 *
 * @remarks
 *  The existing singular Organization table is shared with Better Auth.
 *
 * @see
 *  CONTEXT.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const organizations = pgTable(
  "organization",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    slug: text().notNull().unique(),
    logo: text(),
    metadata: text(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("organization_slug_idx").on(table.slug)],
);

export const users = pgTable(
  "user",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    email: text().notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text(),
    state: text().notNull().default("Provisioned"),
    timezone: text().notNull().default("UTC"),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    provisionedByUserId: text("provisioned_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("user_state_check", sql`${table.state} in ('Provisioned', 'Active', 'Disabled')`),
    index("user_email_idx").on(table.email),
    foreignKey({
      columns: [table.provisionedByUserId],
      foreignColumns: [table.id],
      name: "user_provisioned_by_user_id_fk",
    }).onDelete("set null"),
  ],
);

export const sessions = pgTable(
  "session",
  {
    id: text().primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text().notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    activeOrganizationId: text("active_organization_id").references(() => organizations.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const accounts = pgTable(
  "account",
  {
    id: text().primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text(),
    password: text(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("account_user_id_idx").on(table.userId),
    uniqueIndex("account_provider_account_idx").on(table.providerId, table.accountId),
  ],
);

export const verifications = pgTable(
  "verification",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const members = pgTable(
  "member",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text().notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("member_organization_id_idx").on(table.organizationId),
    index("member_user_id_idx").on(table.userId),
    uniqueIndex("member_organization_user_idx").on(table.organizationId, table.userId),
  ],
);

export const invitations = pgTable(
  "invitation",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text().notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text().notNull().default("member"),
    status: text().notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("invitation_organization_id_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ],
);

export const twilioConnections = pgTable(
  "twilio_connection",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" })
      .unique(),
    accountSid: text("account_sid").notNull(),
    apiKeySid: text("api_key_sid").notNull(),
    apiKeySecretCiphertext: text("api_key_secret_ciphertext").notNull(),
    authTokenCiphertext: text("auth_token_ciphertext"),
    masterKeyVersion: integer("master_key_version").notNull().default(1),
    accountFriendlyName: text("account_friendly_name"),
    connectedByUserId: text("connected_by_user_id").references(() => users.id, { onDelete: "set null" }),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    lastFailureDetail: text("last_failure_detail"),
    numbersSyncedAt: timestamp("numbers_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("twilio_connection_organization_id_idx").on(table.organizationId)],
);

export const twilioNumbers = pgTable(
  "twilio_number",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    twilioSid: text("twilio_sid").notNull(),
    phoneNumber: text("phone_number").notNull(),
    friendlyName: text("friendly_name").notNull(),
    voiceCapable: boolean("voice_capable").notNull(),
    voiceUrl: text("voice_url"),
    voiceMethod: text("voice_method"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("twilio_number_organization_sid_idx").on(table.organizationId, table.twilioSid),
    uniqueIndex("twilio_number_active_phone_idx").on(table.organizationId, table.phoneNumber).where(sql`${table.releasedAt} is null`),
    index("twilio_number_organization_id_idx").on(table.organizationId),
  ],
);

export const workspaces = pgTable(
  "workspace",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text().notNull(),
    reportingTimezone: text("reporting_timezone").notNull(),
    state: text().notNull().default("Setup Required"),
    destinationNumber: text("destination_number"),
    recordingEnabled: boolean("recording_enabled").notNull().default(false),
    analysisEnabled: boolean("analysis_enabled").notNull().default(false),
    spamGateEnabled: boolean("spam_gate_enabled").notNull().default(false),
    whisperEnabled: boolean("whisper_enabled").notNull().default(false),
    whisperMessage: text("whisper_message"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    check("workspace_state_check", sql`${table.state} in ('Setup Required', 'Active', 'Archived')`),
    check("workspace_analysis_requires_recording_check", sql`not ${table.analysisEnabled} or ${table.recordingEnabled}`),
    foreignKey({
      columns: [table.createdByUserId],
      foreignColumns: [users.id],
      name: "workspace_created_by_user_id_fk",
    }).onDelete("set null"),
    uniqueIndex("workspace_organization_name_idx").on(table.organizationId, sql`lower(${table.name})`),
    index("workspace_organization_id_idx").on(table.organizationId),
  ],
);

export const numberAssignments = pgTable(
  "number_assignment",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    twilioNumberId: text("twilio_number_id")
      .notNull()
      .references(() => twilioNumbers.id, { onDelete: "restrict" }),
    phoneNumber: text("phone_number").notNull(),
    priorVoiceUrl: text("prior_voice_url"),
    priorVoiceMethod: text("prior_voice_method"),
    priorVoiceFallbackUrl: text("prior_voice_fallback_url"),
    priorVoiceFallbackMethod: text("prior_voice_fallback_method"),
    priorStatusCallbackUrl: text("prior_status_callback_url"),
    priorStatusCallbackMethod: text("prior_status_callback_method"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedReason: text("ended_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("number_assignment_ended_reason_check", sql`${table.endedReason} is null or ${table.endedReason} in ('archived', 'replaced', 'detached', 'activation_failed')`),
    uniqueIndex("number_assignment_active_number_idx").on(table.twilioNumberId).where(sql`${table.endedAt} is null`),
    uniqueIndex("number_assignment_active_workspace_idx").on(table.workspaceId).where(sql`${table.endedAt} is null`),
    index("number_assignment_organization_id_idx").on(table.organizationId),
    index("number_assignment_workspace_id_idx").on(table.workspaceId),
  ],
);

export const callFlowDrafts = pgTable(
  "call_flow_draft",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .unique()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    graph: jsonb().notNull(),
    basedOnVersion: integer("based_on_version"),
    updatedByUserId: text("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("call_flow_draft_organization_id_idx").on(table.organizationId)],
);

export const flowVersions = pgTable(
  "flow_version",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    graph: jsonb().notNull(),
    publishedByUserId: text("published_by_user_id").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("flow_version_workspace_version_idx").on(table.workspaceId, table.version),
    index("flow_version_organization_id_idx").on(table.organizationId),
    index("flow_version_workspace_id_idx").on(table.workspaceId),
  ],
);

export const accessGrants = pgTable(
  "access_grant",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    grantedByUserId: text("granted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("access_grant_user_workspace_idx").on(table.userId, table.workspaceId),
    index("access_grant_organization_id_idx").on(table.organizationId),
    index("access_grant_workspace_id_idx").on(table.workspaceId),
  ],
);

export const calls = pgTable(
  "call",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    numberAssignmentId: text("number_assignment_id")
      .notNull()
      .references(() => numberAssignments.id, { onDelete: "restrict" }),
    flowVersionId: text("flow_version_id")
      .notNull()
      .references(() => flowVersions.id, { onDelete: "restrict" }),
    twilioCallSid: text("twilio_call_sid").notNull(),
    trackingNumber: text("tracking_number").notNull(),
    callerNumber: text("caller_number"),
    state: text().notNull().default("In Progress"),
    outcome: text(),
    outcomeReason: text("outcome_reason"),
    pendingOutcome: text("pending_outcome"),
    pendingOutcomeReason: text("pending_outcome_reason"),
    forwardNodeId: text("forward_node_id"),
    forwardStartedAt: timestamp("forward_started_at", { withTimezone: true }),
    forwardStatus: text("forward_status"),
    voicemailRecordingSid: text("voicemail_recording_sid"),
    voicemailDurationSeconds: integer("voicemail_duration_seconds"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("call_state_check", sql`${table.state} in ('In Progress', 'Completed')`),
    check("call_outcome_check", sql`${table.outcome} is null or ${table.outcome} in ('Answered', 'Voicemail', 'Missed', 'Abandoned', 'Blocked', 'Failed')`),
    check("call_pending_outcome_check", sql`${table.pendingOutcome} is null or ${table.pendingOutcome} in ('Answered', 'Voicemail', 'Missed', 'Abandoned', 'Blocked', 'Failed')`),
    check("call_completed_outcome_check", sql`${table.state} <> 'Completed' or ${table.outcome} is not null`),
    uniqueIndex("call_organization_call_sid_idx").on(table.organizationId, table.twilioCallSid),
    index("call_organization_id_idx").on(table.organizationId),
    index("call_workspace_id_idx").on(table.workspaceId),
  ],
);

export const providerEvents = pgTable(
  "provider_event",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    numberAssignmentId: text("number_assignment_id").references(() => numberAssignments.id, { onDelete: "set null" }),
    callId: text("call_id").references(() => calls.id, { onDelete: "set null" }),
    idempotencyKey: text("idempotency_key").notNull(),
    kind: text().notNull(),
    disposition: text().notNull(),
    detail: text(),
    payload: jsonb().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("provider_event_kind_check", sql`${table.kind} in ('voice', 'forward', 'forward_status', 'status', 'gather', 'whisper', 'voicemail', 'voicemail_status', 'recording_status')`),
    check("provider_event_disposition_check", sql`${table.disposition} in ('accepted', 'rejected')`),
    uniqueIndex("provider_event_organization_key_idx").on(table.organizationId, table.idempotencyKey),
    index("provider_event_organization_id_idx").on(table.organizationId),
    index("provider_event_call_id_idx").on(table.callId),
  ],
);

export const recordings = pgTable(
  "recording",
  {
    id: text().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    callId: text("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    twilioRecordingSid: text("twilio_recording_sid").notNull(),
    source: text().notNull(),
    channels: integer().notNull(),
    durationSeconds: integer("duration_seconds"),
    transferState: text("transfer_state").notNull().default("Pending"),
    twilioCleanupState: text("twilio_cleanup_state").notNull().default("Pending"),
    r2ObjectKey: text("r2_object_key"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    sha256: text(),
    failureStage: text("failure_stage"),
    failureReason: text("failure_reason"),
    storedAt: timestamp("stored_at", { withTimezone: true }),
    twilioDeletedAt: timestamp("twilio_deleted_at", { withTimezone: true }),
    waveformState: text("waveform_state").notNull().default("Pending"),
    waveformObjectKey: text("waveform_object_key"),
    waveformFailureReason: text("waveform_failure_reason"),
    waveformGeneratedAt: timestamp("waveform_generated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("recording_source_check", sql`${table.source} in ('connected', 'voicemail')`),
    check("recording_channels_check", sql`${table.channels} in (1, 2)`),
    check("recording_transfer_state_check", sql`${table.transferState} in ('Pending', 'Stored', 'Failed')`),
    check("recording_twilio_cleanup_state_check", sql`${table.twilioCleanupState} in ('Pending', 'Deleted', 'Failed')`),
    check("recording_stored_metadata_check", sql`${table.transferState} <> 'Stored' or (${table.r2ObjectKey} is not null and ${table.sizeBytes} is not null and ${table.sha256} is not null and ${table.storedAt} is not null)`),
    check("recording_cleanup_requires_stored_check", sql`${table.twilioCleanupState} <> 'Deleted' or ${table.transferState} = 'Stored'`),
    check("recording_waveform_state_check", sql`${table.waveformState} in ('Pending', 'Stored', 'Failed')`),
    check("recording_waveform_stored_metadata_check", sql`${table.waveformState} <> 'Stored' or (${table.waveformObjectKey} is not null and ${table.waveformGeneratedAt} is not null)`),
    check("recording_waveform_requires_stored_check", sql`${table.waveformState} = 'Pending' or ${table.transferState} = 'Stored'`),
    uniqueIndex("recording_organization_recording_sid_idx").on(table.organizationId, table.twilioRecordingSid),
    index("recording_organization_id_idx").on(table.organizationId),
    index("recording_workspace_id_idx").on(table.workspaceId),
    index("recording_call_id_idx").on(table.callId),
    index("recording_unfinished_created_at_idx").on(table.createdAt).where(sql`${table.twilioCleanupState} <> 'Deleted'`),
    index("recording_waveform_unfinished_created_at_idx").on(table.createdAt).where(sql`${table.waveformState} <> 'Stored'`),
  ],
);

export const schema = {
  organization: organizations,
  user: users,
  session: sessions,
  account: accounts,
  verification: verifications,
  member: members,
  invitation: invitations,
  twilioConnection: twilioConnections,
  twilioNumber: twilioNumbers,
  workspace: workspaces,
  numberAssignment: numberAssignments,
  callFlowDraft: callFlowDrafts,
  flowVersion: flowVersions,
  accessGrant: accessGrants,
  call: calls,
  providerEvent: providerEvents,
  recording: recordings,
};
