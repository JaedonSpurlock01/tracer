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
export type CanonicalRole = "Operator" | "Client Viewer";

export function normalizeIdentityEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function toCanonicalRole(role: MembershipRole): CanonicalRole {
  return role === "owner" ? "Operator" : "Client Viewer";
}

export function isActiveOperator(
  identity: { state: UserState; role: MembershipRole } | null | undefined,
): boolean {
  return identity?.state === "Active" && identity.role === "owner";
}

export function isProvisionableRole(role: string): role is CanonicalRole {
  return role === "Operator" || role === "Client Viewer";
}

export type OperatorStateDecision = { allowed: true } | { allowed: false; reason: "last_active_operator" };

export function decideOperatorStateChange(input: {
  target: { state: UserState; role: MembershipRole };
  nextState: "Active" | "Disabled";
  activeOperatorCount: number;
}): OperatorStateDecision {
  if (
    input.nextState === "Disabled" &&
    input.target.role === "owner" &&
    input.target.state === "Active" &&
    input.activeOperatorCount <= 1
  ) {
    return { allowed: false, reason: "last_active_operator" };
  }
  return { allowed: true };
}

export type RoleChangeDecision =
  | { allowed: true }
  | { allowed: false; reason: "last_active_operator" | "access_grant_required" | "state_unchanged" };

export function decideRoleChange(input: {
  target: { state: UserState; role: MembershipRole };
  nextRole: CanonicalRole;
  activeOperatorCount: number;
  accessGrantCount: number;
}): RoleChangeDecision {
  if (toCanonicalRole(input.target.role) === input.nextRole) {
    return { allowed: false, reason: "state_unchanged" };
  }
  if (input.nextRole === "Operator") {
    return { allowed: true };
  }
  if (isActiveOperator(input.target) && input.activeOperatorCount <= 1) {
    return { allowed: false, reason: "last_active_operator" };
  }
  if (input.accessGrantCount < 1) {
    return { allowed: false, reason: "access_grant_required" };
  }
  return { allowed: true };
}

export function reenabledState(emailVerified: boolean): UserState {
  return emailVerified ? "Active" : "Provisioned";
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
