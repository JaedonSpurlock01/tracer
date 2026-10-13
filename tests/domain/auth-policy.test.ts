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
  isValidIanaTimezone,
  normalizeIdentityEmail,
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
