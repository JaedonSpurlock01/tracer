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
  boolean,
  check,
  foreignKey,
  index,
  integer,
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
};
