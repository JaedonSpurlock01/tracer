/**
 * -------------------------------------------------------------------------
 * @file   transactional-email.ts
 * @brief  Adapts Cloudflare Email Service to Tracer email operations.
 *
 * @description
 *  Defines the transactional email boundary and maps sign-in codes to the
 *  structured Email Service send request.
 *
 * @remarks
 *  Email content is passed only to the provider boundary and is never logged.
 *
 * @see
 *  docs/DATA_PLATFORM.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { normalizeIdentityEmail } from "@/data/auth-policy";

export interface TransactionalEmailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
}

export interface TransactionalEmail {
  send(message: TransactionalEmailMessage): Promise<{ messageId: string }>;
}

export interface SendEmail {
  send(message: TransactionalEmailMessage): Promise<{ messageId?: string } | string | void>;
}

export function createCloudflareTransactionalEmail(binding: SendEmail): TransactionalEmail {
  return {
    async send(message) {
      const result = await binding.send(message);
      if (typeof result === "string") {
        return { messageId: result };
      }
      return { messageId: result?.messageId ?? "accepted" };
    },
  };
}

export async function sendSignInCode(
  email: TransactionalEmail,
  input: { to: string; from: string; code: string },
): Promise<void> {
  await email.send({
    to: normalizeIdentityEmail(input.to),
    from: input.from,
    subject: "Your Tracer sign-in code",
    text: `Your Tracer sign-in code is ${input.code}. It expires in 5 minutes.`,
    html: `<p>Your Tracer sign-in code is <strong>${input.code}</strong>.</p><p>It expires in 5 minutes.</p>`,
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendAccessCreatedNotice(
  email: TransactionalEmail,
  input: { to: string; from: string; signInUrl: string; workspaceNames?: readonly string[] },
): Promise<void> {
  const workspaceNames = input.workspaceNames ?? [];
  const summary = workspaceNames.length > 0 ? ` You can view: ${workspaceNames.join(", ")}.` : "";
  const htmlSummary = workspaceNames.length > 0
    ? `<p>You can view: ${workspaceNames.map(escapeHtml).join(", ")}.</p>`
    : "";
  await email.send({
    to: normalizeIdentityEmail(input.to),
    from: input.from,
    subject: "Your Tracer access is ready",
    text: `An Operator created Tracer access for this address.${summary} Sign in at ${input.signInUrl} with an email code.`,
    html: `<p>An Operator created Tracer access for this address.</p>${htmlSummary}<p><a href="${input.signInUrl}">Sign in to Tracer</a> with an email code.</p>`,
  });
}

export function isAllowedRecipient(
  recipients: ReadonlySet<string>,
  email: string,
): boolean {
  return recipients.has(normalizeIdentityEmail(email));
}
