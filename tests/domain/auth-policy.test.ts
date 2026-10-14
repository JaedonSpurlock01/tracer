/**
 * -------------------------------------------------------------------------
 * @file   auth-policy.test.ts
 * @brief  Verifies Tracer identity policy decisions.
 *
 * @description
 *  Covers canonical identity normalization, role mapping, admission, OTP
 *  response privacy, and IANA timezone validation through public functions.
 *
 * @remarks
 *  These tests do not depend on Better Auth or PostgreSQL.
 *
 * @see
 *  data/auth-policy.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import {
  decideEmailCodeRequest,
  decideOperatorStateChange,
  isActiveOperator,
  isProvisionableRole,
  isValidIanaTimezone,
  normalizeIdentityEmail,
  reenabledState,
  toCanonicalRole,
} from "@/data/auth-policy";

describe("identity policy", () => {
  it("normalizes identity email by trimming and lowercasing", () => {
    expect(normalizeIdentityEmail("  Operator@Example.COM ")).toBe("operator@example.com");
  });

  it("maps Better Auth membership roles to canonical roles", () => {
    expect(toCanonicalRole("owner")).toBe("Operator");
    expect(toCanonicalRole("member")).toBe("Client Viewer");
  });

  it("recognizes only Active owners as Active Operators", () => {
    expect(isActiveOperator({ state: "Active", role: "owner" })).toBe(true);
    expect(isActiveOperator({ state: "Provisioned", role: "owner" })).toBe(false);
    expect(isActiveOperator({ state: "Active", role: "member" })).toBe(false);
    expect(isActiveOperator(null)).toBe(false);
  });

  it("keeps Client Viewer unavailable for provisioning in M4", () => {
    expect(isProvisionableRole("Operator")).toBe(true);
    expect(isProvisionableRole("Client Viewer")).toBe(false);
  });

  it("protects the last Active Operator from disablement", () => {
    const target = { state: "Active" as const, role: "owner" as const };
    expect(decideOperatorStateChange({ target, nextState: "Disabled", activeOperatorCount: 1 })).toEqual({
      allowed: false,
      reason: "last_active_operator",
    });
    expect(decideOperatorStateChange({ target, nextState: "Disabled", activeOperatorCount: 2 })).toEqual({ allowed: true });
    expect(decideOperatorStateChange({ target, nextState: "Active", activeOperatorCount: 1 })).toEqual({ allowed: true });
  });

  it("returns Active after verified sign-in and Provisioned otherwise", () => {
    expect(reenabledState(true)).toBe("Active");
    expect(reenabledState(false)).toBe("Provisioned");
  });

  it("returns the same generic email-code decision for every identity state", () => {
    expect(decideEmailCodeRequest("Provisioned")).toEqual({ accepted: true, send: true });
    expect(decideEmailCodeRequest("Active")).toEqual({ accepted: true, send: true });
    expect(decideEmailCodeRequest("Disabled")).toEqual({ accepted: true, send: false });
    expect(decideEmailCodeRequest(null)).toEqual({ accepted: true, send: false });
  });

  it("validates IANA timezone names", () => {
    expect(isValidIanaTimezone("America/Chicago")).toBe(true);
    expect(isValidIanaTimezone("not-a-timezone")).toBe(false);
    expect(isValidIanaTimezone(" ")).toBe(false);
  });
});
