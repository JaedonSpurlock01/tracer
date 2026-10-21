/**
 * -------------------------------------------------------------------------
 * @file   form-submissions.ts
 * @brief  Stores, forwards, holds, and reviews Form Submissions from linked Sites.
 *
 * @description
 *  A Site's Worker posts its contact form with the Organization's Forms key
 *  and its own hostname. Ingest finds the Organization by the key's SHA-256
 *  hash, the Site by the hostname, follows its open Site Link to the
 *  Workspace, validates a name and a phone or email, stores the Form
 *  Submission once per Site and submission id, and forwards it from the
 *  Site's own address to the Workspace's forwarding recipients with
 *  Reply-To the submitter. The same person (same phone or email) may submit
 *  twice within 24 hours; the third and later are Held: stored, not
 *  forwarded, and not counted until an Operator approves or rejects them.
 *  The authorized service lists a Workspace's submissions, approves,
 *  rejects, reviews, and resends them, and edits the forwarding recipients.
 *  The Forms key is one per Organization, managed on Integrations.
 *
 * @remarks
 *  Forwarding happens here in the Worker through the Email Service
 *  boundary, not in Trigger.dev, which has no email binding. A send is
 *  attempted after the row is committed, so a crash between the two leaves
 *  Forward failed with Resend rather than a lost lead. The key is stored
 *  only as a hash and returned once at generation; one key serves every
 *  Site, so adding a Site needs no new secret. The effective
 *  classification mirrors Calls: the Operator's review, otherwise Good
 *  Lead, or none while Held. Analytics and revenue read the exported SQL
 *  fragments so every surface counts the same submissions.
 *
 * @see
 *  CONTEXT.md
 *  data/forms-handler.ts
 *  data/analytics.ts
 *  data/cost-revenue.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { normalizeIdentityEmail } from "@/data/auth-policy";
import { AuthorizationError, type Actor } from "@/data/authorization";
import { isLeadClassification, leadReviewNoteMaxLength, type LeadClassification } from "@/data/lead-classification";
import type { TransactionalEmail, TransactionalEmailMessage } from "@/data/transactional-email";
import { canManageWorkspaces, createReadableWorkspaces } from "@/data/workspace-authorization";

export type FormForwardStatus = "Sent" | "Failed" | "Not configured" | "Held" | "Rejected";

export interface FormSubmissionRecord {
  id: string;
  workspaceId: string;
  siteId: string;
  submissionId: string;
  receivedAt: string;
  page: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  fields: Record<string, string>;
  repeatOfId: string | null;
  held: boolean;
  forward: { status: FormForwardStatus; to: string[]; error: string | null; forwardedAt: string | null };
  review: { classification: LeadClassification; note: string | null; reviewedAt: string; reviewer: { id: string; name: string } | null } | null;
  effectiveClassification: { classification: LeadClassification; source: "review" | "default" } | null;
}

export interface FormSubmissionList {
  workspace: { id: string; name: string };
  site: { id: string; primaryHostname: string } | null;
  submissions: FormSubmissionRecord[];
  heldCount: number;
  forwardTo?: string[];
}

export type FormSubmissionsErrorCode = "invalid_input" | "not_found" | "unauthorized_key" | "site_unknown" | "site_not_linked" | "not_held" | "held";

export class FormSubmissionsError extends Error {
  constructor(public readonly code: FormSubmissionsErrorCode) {
    super(code);
    this.name = "FormSubmissionsError";
  }
}

export interface FormIngestInput {
  key: string | null;
  site: unknown;
  submissionId: unknown;
  page: unknown;
  fields: unknown;
  now?: Date;
}

export interface FormSubmissions {
  list(workspaceId: string): Promise<FormSubmissionList | null>;
  approve(workspaceId: string, submissionId: string): Promise<FormSubmissionRecord>;
  reject(workspaceId: string, submissionId: string): Promise<FormSubmissionRecord>;
  resend(workspaceId: string, submissionId: string): Promise<FormSubmissionRecord>;
  review(workspaceId: string, submissionId: string, input: { classification: unknown; note: unknown }): Promise<FormSubmissionRecord>;
  clearReview(workspaceId: string, submissionId: string): Promise<FormSubmissionRecord>;
  setForwarding(workspaceId: string, emails: unknown): Promise<string[]>;
}

/** The Organization's one Forms key, shown once at generation and kept only as a hash. */
export interface FormsKey {
  status(): Promise<{ createdAt: string } | null>;
  generate(): Promise<{ key: string; createdAt: string }>;
  revoke(): Promise<void>;
}

/** Submissions by one person within this window count toward the hold rule. */
export const formRepeatWindowHours = 24;
/** The submission number from which a repeat is Held for Operator approval. */
export const formHoldFromSubmission = 3;

export const maxFormFields = 40;
export const maxFormFieldLength = 2000;

/** A Form Submission that counts as a Good Lead: reviewed Good Lead, or unreviewed and not Held. Alias `fs`. */
export const formGoodLeadSql = "(fs.review_classification = 'Good Lead' or (fs.review_classification is null and not fs.held))";
/** Form Submissions joined to their Workspace as `fs` and `w`, so readable-Workspace scopes apply. */
export const formSubmissionSource = "form_submission fs join workspace w on w.id = fs.workspace_id and w.organization_id = fs.organization_id";

type SubmissionRow = {
  id: string;
  workspace_id: string;
  site_id: string;
  submission_id: string;
  received_at: Date;
  page: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  fields: Record<string, string>;
  repeat_of_id: string | null;
  held: boolean;
  forward_status: FormForwardStatus;
  forward_to: string[];
  forward_error: string | null;
  forwarded_at: Date | null;
  review_classification: LeadClassification | null;
  review_note: string | null;
  reviewed_at: Date | null;
  reviewer_id: string | null;
  reviewer_name: string | null;
};

const submissionColumns = `fs.id, fs.workspace_id, fs.site_id, fs.submission_id, fs.received_at, fs.page, fs.name, fs.phone, fs.email, fs.fields, fs.repeat_of_id, fs.held,
       fs.forward_status, fs.forward_to, fs.forward_error, fs.forwarded_at, fs.review_classification, fs.review_note, fs.reviewed_at,
       u.id as reviewer_id, u.name as reviewer_name`;
const submissionFrom = `form_submission fs left join "user" u on u.id = fs.reviewer_user_id`;

function toRecord(row: SubmissionRow): FormSubmissionRecord {
  const review = row.review_classification
    ? {
        classification: row.review_classification,
        note: row.review_note,
        reviewedAt: row.reviewed_at?.toISOString() ?? row.received_at.toISOString(),
        reviewer: row.reviewer_id && row.reviewer_name ? { id: row.reviewer_id, name: row.reviewer_name } : null,
      }
    : null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    siteId: row.site_id,
    submissionId: row.submission_id,
    receivedAt: row.received_at.toISOString(),
    page: row.page,
    name: row.name,
    phone: row.phone,
    email: row.email,
    fields: row.fields,
    repeatOfId: row.repeat_of_id,
    held: row.held,
    forward: { status: row.forward_status, to: row.forward_to, error: row.forward_error, forwardedAt: row.forwarded_at?.toISOString() ?? null },
    review,
    effectiveClassification: review ? { classification: review.classification, source: "review" } : row.held ? null : { classification: "Good Lead", source: "default" },
  };
}

export function hashFormsKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function newFormsKey(): string {
  return `fk_${randomBytes(32).toString("base64url")}`;
}

function normalizeHostname(value: unknown): string {
  const text = cleanText(value, 253).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  return text;
}

export function createFormsKey(pool: Pool, actor: Actor, options: { now?: () => Date } = {}): FormsKey {
  if (!canManageWorkspaces(actor)) throw new AuthorizationError(403);
  const now = options.now ?? (() => new Date());
  return {
    async status() {
      const result = await pool.query<{ forms_key_created_at: Date | null }>("select forms_key_created_at from organization where id = $1", [actor.organizationId]);
      const createdAt = result.rows[0]?.forms_key_created_at ?? null;
      return createdAt ? { createdAt: createdAt.toISOString() } : null;
    },
    async generate() {
      const key = newFormsKey();
      const at = now();
      await pool.query("update organization set forms_key_hash = $2, forms_key_created_at = $3 where id = $1", [actor.organizationId, hashFormsKey(key), at]);
      return { key, createdAt: at.toISOString() };
    },
    async revoke() {
      await pool.query("update organization set forms_key_hash = null, forms_key_created_at = null where id = $1", [actor.organizationId]);
    },
  };
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

function cleanText(value: unknown, max: number): string {
  if (typeof value === "number" || typeof value === "boolean") value = String(value);
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

interface ParsedSubmission {
  submissionId: string;
  page: string | null;
  fields: Record<string, string>;
  name: string;
  phone: string | null;
  email: string | null;
}

function fieldNamed(fields: Record<string, string>, wanted: string): string {
  const key = Object.keys(fields).find((candidate) => candidate.trim().toLowerCase() === wanted);
  return key ? fields[key] : "";
}

function parseSubmission(input: FormIngestInput): ParsedSubmission {
  const submissionId = cleanText(input.submissionId, 200);
  if (!submissionId) throw new FormSubmissionsError("invalid_input");
  if (!input.fields || typeof input.fields !== "object" || Array.isArray(input.fields)) throw new FormSubmissionsError("invalid_input");
  const fields: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input.fields as Record<string, unknown>)) {
    const key = cleanText(rawKey, 100);
    const value = cleanText(rawValue, maxFormFieldLength);
    if (!key || !value) continue;
    fields[key] = value;
    if (Object.keys(fields).length > maxFormFields) throw new FormSubmissionsError("invalid_input");
  }
  const name = fieldNamed(fields, "name");
  const rawPhone = fieldNamed(fields, "phone");
  const rawEmail = fieldNamed(fields, "email");
  const phone = digits(rawPhone).length >= 7 ? rawPhone : null;
  const email = emailPattern.test(rawEmail) ? normalizeIdentityEmail(rawEmail) : null;
  if (name.length < 2 || (!phone && !email)) throw new FormSubmissionsError("invalid_input");
  const page = cleanText(input.page, 500) || null;
  return { submissionId, page, fields, name, phone, email };
}

export function parseForwardingRecipients(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 10) throw new FormSubmissionsError("invalid_input");
  const emails = value.map((entry) => {
    if (typeof entry !== "string" || !emailPattern.test(entry.trim())) throw new FormSubmissionsError("invalid_input");
    return normalizeIdentityEmail(entry);
  });
  return [...new Set(emails)];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** The email Tracer sends on the Site's behalf. Pure, so the message can be inspected without a provider. */
export function forwardingMessage(input: { workspaceName: string; hostname: string; recipients: string[]; submission: Pick<FormSubmissionRecord, "name" | "email" | "fields" | "page"> }): TransactionalEmailMessage {
  const { submission } = input;
  const lines = Object.entries(submission.fields).map(([key, value]) => `${key}: ${value}`);
  const intro = `New request from the website${submission.page ? ` (${submission.page})` : ""}`;
  return {
    from: { name: input.workspaceName, email: `info@${input.hostname}` },
    to: input.recipients,
    ...(submission.email ? { replyTo: { name: submission.name, email: submission.email } } : {}),
    subject: `New lead from ${input.hostname}: ${submission.name}`,
    text: [intro, "", ...lines].join("\n"),
    html: `<p>${escapeHtml(intro)}</p><ul>${Object.entries(submission.fields).map(([key, value]) => `<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</li>`).join("")}</ul>`,
  };
}

async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

type Queryable = Pick<Pool, "query">;

async function selectSubmission(db: Queryable, id: string): Promise<FormSubmissionRecord | null> {
  const result = await db.query<SubmissionRow>(`select ${submissionColumns} from ${submissionFrom} where fs.id = $1`, [id]);
  return result.rows[0] ? toRecord(result.rows[0]) : null;
}

interface ForwardContext {
  workspaceName: string;
  hostname: string;
  recipients: string[];
}

async function forwardContext(db: Queryable, submissionId: string): Promise<ForwardContext> {
  const result = await db.query<{ workspace_name: string; hostname: string; recipients: string[] }>(
    `select w.name as workspace_name, s.primary_hostname as hostname, w.form_forward_to as recipients
       from form_submission fs
       join workspace w on w.id = fs.workspace_id
       join site s on s.id = fs.site_id
      where fs.id = $1`,
    [submissionId],
  );
  if (!result.rows[0]) throw new FormSubmissionsError("not_found");
  return { workspaceName: result.rows[0].workspace_name, hostname: result.rows[0].hostname, recipients: result.rows[0].recipients };
}

/** Sends the forwarding email for a committed submission and records the outcome on its row. */
async function forward(pool: Pool, email: TransactionalEmail, submission: FormSubmissionRecord, now: Date): Promise<FormSubmissionRecord> {
  const context = await forwardContext(pool, submission.id);
  if (context.recipients.length === 0) {
    await pool.query("update form_submission set forward_status = 'Not configured', forward_to = '{}', forward_error = null, updated_at = $2 where id = $1", [submission.id, now]);
    return (await selectSubmission(pool, submission.id))!;
  }
  const message = forwardingMessage({ workspaceName: context.workspaceName, hostname: context.hostname, recipients: context.recipients, submission });
  try {
    const result = await email.send(message);
    await pool.query(
      "update form_submission set forward_status = 'Sent', forward_to = $2, forward_error = null, forwarded_at = $3, forward_message_id = $4, updated_at = $3 where id = $1",
      [submission.id, context.recipients, now, result.messageId],
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 500) : "Email Service error";
    await pool.query("update form_submission set forward_status = 'Failed', forward_to = $2, forward_error = $3, updated_at = $4 where id = $1", [submission.id, context.recipients, reason, now]);
  }
  return (await selectSubmission(pool, submission.id))!;
}

/** What `POST /api/forms` does: authenticate the key, resolve the Site and Workspace, store once, apply the hold rule, forward. */
export async function ingestFormSubmission(pool: Pool, email: TransactionalEmail, input: FormIngestInput): Promise<{ submission: FormSubmissionRecord; created: boolean }> {
  const key = typeof input.key === "string" ? input.key.trim() : "";
  if (!key) throw new FormSubmissionsError("unauthorized_key");
  const organization = await pool.query<{ id: string }>("select id from organization where forms_key_hash = $1", [hashFormsKey(key)]);
  if (!organization.rows[0]) throw new FormSubmissionsError("unauthorized_key");
  const hostname = normalizeHostname(input.site);
  if (!hostname) throw new FormSubmissionsError("invalid_input");
  const site = await pool.query<{ id: string; organization_id: string }>(
    `select s.id, s.organization_id
       from site s
      where s.organization_id = $1 and s.removed_at is null
        and (s.primary_hostname = $2 or exists (select 1 from site_hostname h where h.site_id = s.id and (h.hostname = $2 or h.hostname = 'www.' || $2)))
      order by s.primary_hostname = $2 desc
      limit 1`,
    [organization.rows[0].id, hostname],
  );
  if (!site.rows[0]) throw new FormSubmissionsError("site_unknown");
  const link = await pool.query<{ id: string; workspace_id: string }>("select id, workspace_id from site_link where site_id = $1 and ended_at is null", [site.rows[0].id]);
  if (!link.rows[0]) throw new FormSubmissionsError("site_not_linked");
  const parsed = parseSubmission(input);
  const now = input.now ?? new Date();

  const stored = await withTransaction(pool, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`form-submission:${site.rows[0].id}`]);
    const existing = await client.query<SubmissionRow>(`select ${submissionColumns} from ${submissionFrom} where fs.site_id = $1 and fs.submission_id = $2`, [site.rows[0].id, parsed.submissionId]);
    if (existing.rows[0]) return { submission: toRecord(existing.rows[0]), created: false };
    const earlier = await client.query<{ id: string }>(
      `select id from form_submission
        where site_id = $1 and received_at > $2::timestamptz - make_interval(hours => $3)
          and (($4::text is not null and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = regexp_replace($4::text, '\\D', '', 'g')) or ($5::text is not null and email = $5))
        order by received_at desc`,
      [site.rows[0].id, now, formRepeatWindowHours, parsed.phone, parsed.email],
    );
    const held = earlier.rows.length + 1 >= formHoldFromSubmission;
    const id = randomUUID();
    await client.query(
      `insert into form_submission (id, organization_id, workspace_id, site_id, site_link_id, submission_id, received_at, page, name, phone, email, fields, repeat_of_id, held, forward_status, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $7, $7)`,
      [id, site.rows[0].organization_id, link.rows[0].workspace_id, site.rows[0].id, link.rows[0].id, parsed.submissionId, now, parsed.page, parsed.name, parsed.phone, parsed.email,
        JSON.stringify(parsed.fields), earlier.rows[0]?.id ?? null, held, held ? "Held" : "Failed"],
    );
    return { submission: (await selectSubmission(client, id))!, created: true };
  });
  if (!stored.created || stored.submission.held) return stored;
  return { submission: await forward(pool, email, stored.submission, now), created: true };
}

export function createFormSubmissions(pool: Pool, actor: Actor, email: TransactionalEmail, options: { now?: () => Date } = {}): FormSubmissions {
  const workspaces = createReadableWorkspaces(pool, actor);
  const now = options.now ?? (() => new Date());
  const operator = canManageWorkspaces(actor);

  function requireOperator(): void {
    if (!operator) throw new AuthorizationError(403);
  }

  async function requireWorkspace(workspaceId: string): Promise<{ id: string; name: string }> {
    const workspace = await workspaces.find(workspaceId);
    if (!workspace) throw new FormSubmissionsError("not_found");
    return { id: workspace.id, name: workspace.name };
  }

  async function requireSubmission(workspaceId: string, submissionId: string): Promise<FormSubmissionRecord> {
    const workspace = await requireWorkspace(workspaceId);
    const result = await pool.query<SubmissionRow>(`select ${submissionColumns} from ${submissionFrom} where fs.id = $1 and fs.workspace_id = $2 and fs.organization_id = $3`, [submissionId, workspace.id, actor.organizationId]);
    if (!result.rows[0]) throw new FormSubmissionsError("not_found");
    return toRecord(result.rows[0]);
  }

  async function linkedSite(workspaceId: string): Promise<{ id: string; primaryHostname: string } | null> {
    const result = await pool.query<{ id: string; primary_hostname: string }>(
      "select s.id, s.primary_hostname from site_link l join site s on s.id = l.site_id where l.workspace_id = $1 and l.organization_id = $2 and l.ended_at is null",
      [workspaceId, actor.organizationId],
    );
    const row = result.rows[0];
    return row ? { id: row.id, primaryHostname: row.primary_hostname } : null;
  }

  return {
    async list(workspaceId) {
      const workspace = await workspaces.find(workspaceId);
      if (!workspace) return null;
      const [rows, site, forwarding] = await Promise.all([
        pool.query<SubmissionRow>(`select ${submissionColumns} from ${submissionFrom} where fs.workspace_id = $1 and fs.organization_id = $2 order by fs.received_at desc, fs.id desc limit 500`, [workspace.id, actor.organizationId]),
        linkedSite(workspace.id),
        operator ? pool.query<{ form_forward_to: string[] }>("select form_forward_to from workspace where id = $1", [workspace.id]) : null,
      ]);
      const submissions = rows.rows.map(toRecord);
      const list: FormSubmissionList = {
        workspace: { id: workspace.id, name: workspace.name },
        site: site ? { id: site.id, primaryHostname: site.primaryHostname } : null,
        submissions,
        heldCount: submissions.filter((submission) => submission.held).length,
      };
      if (operator) list.forwardTo = forwarding?.rows[0]?.form_forward_to ?? [];
      return list;
    },

    async approve(workspaceId, submissionId) {
      requireOperator();
      const submission = await requireSubmission(workspaceId, submissionId);
      if (!submission.held) throw new FormSubmissionsError("not_held");
      const at = now();
      await pool.query("update form_submission set held = false, updated_at = $2 where id = $1", [submission.id, at]);
      return forward(pool, email, { ...submission, held: false }, at);
    },

    async reject(workspaceId, submissionId) {
      requireOperator();
      const submission = await requireSubmission(workspaceId, submissionId);
      if (!submission.held) throw new FormSubmissionsError("not_held");
      const at = now();
      await pool.query(
        `update form_submission set held = false, forward_status = 'Rejected', forward_to = '{}', forward_error = null,
                review_classification = 'Not Good Lead', review_note = 'Rejected', reviewer_user_id = $2, reviewed_at = $3, updated_at = $3
          where id = $1`,
        [submission.id, actor.userId, at],
      );
      return (await selectSubmission(pool, submission.id))!;
    },

    async resend(workspaceId, submissionId) {
      requireOperator();
      const submission = await requireSubmission(workspaceId, submissionId);
      if (submission.held || submission.forward.status === "Rejected") throw new FormSubmissionsError("held");
      return forward(pool, email, submission, now());
    },

    async review(workspaceId, submissionId, input) {
      requireOperator();
      const submission = await requireSubmission(workspaceId, submissionId);
      if (submission.held) throw new FormSubmissionsError("held");
      if (!isLeadClassification(input.classification)) throw new FormSubmissionsError("invalid_input");
      if (input.note !== undefined && input.note !== null && typeof input.note !== "string") throw new FormSubmissionsError("invalid_input");
      const note = typeof input.note === "string" ? input.note.trim() : "";
      if (note.length > leadReviewNoteMaxLength) throw new FormSubmissionsError("invalid_input");
      const at = now();
      await pool.query(
        "update form_submission set review_classification = $2, review_note = $3, reviewer_user_id = $4, reviewed_at = $5, updated_at = $5 where id = $1",
        [submission.id, input.classification, note || null, actor.userId, at],
      );
      return (await selectSubmission(pool, submission.id))!;
    },

    async clearReview(workspaceId, submissionId) {
      requireOperator();
      const submission = await requireSubmission(workspaceId, submissionId);
      await pool.query("update form_submission set review_classification = null, review_note = null, reviewer_user_id = null, reviewed_at = null, updated_at = $2 where id = $1", [submission.id, now()]);
      return (await selectSubmission(pool, submission.id))!;
    },

    async setForwarding(workspaceId, emails) {
      requireOperator();
      const workspace = await requireWorkspace(workspaceId);
      const recipients = parseForwardingRecipients(emails);
      await pool.query("update workspace set form_forward_to = $2, updated_at = $3 where id = $1", [workspace.id, recipients, now()]);
      return recipients;
    },
  };
}
