/**
 * -------------------------------------------------------------------------
 * @file   auth-policy.ts
 * @brief  Defines Tracer identity admission and canonical role policy.
 *
 * @description
 *  Keeps identity normalization, generic OTP decisions, role mapping, and
 *  timezone validation independent of authentication vendors.
 *
 * @remarks
 *  Application states intentionally share one safe public policy.
 *
 * @see
 *  CONTEXT.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export type UserState = "Provisioned" | "Active" | "Disabled";
export type MembershipRole = "owner" | "member";

export function normalizeIdentityEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function toCanonicalRole(role: MembershipRole): "Operator" | "Client Viewer" {
  return role === "owner" ? "Operator" : "Client Viewer";
}

export interface EmailCodeDecision {
  accepted: true;
  send: boolean;
}

export function decideEmailCodeRequest(state: UserState | null): EmailCodeDecision {
  return { accepted: true, send: state === "Provisioned" || state === "Active" };
}

export function isValidIanaTimezone(timezone: string): boolean {
  const normalized = timezone.trim();
  if (!normalized) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format();
    return true;
  } catch {
    return false;
  }
}
