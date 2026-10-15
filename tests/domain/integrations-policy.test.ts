/**
 * -------------------------------------------------------------------------
 * @file   integrations-policy.test.ts
 * @brief  Verifies Twilio integration policy decisions and SID validation.
 *
 * @description
 *  Covers disconnect protection and provider identifier formats.
 *
 * @remarks
 *  Workspace dependency counts are supplied by the organization service.
 *
 * @see
 *  data/integrations-policy.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { decideTwilioDisconnect, isTwilioAccountSid, isTwilioApiKeySid } from "@/data/integrations-policy";

describe("Twilio integration policy", () => {
  it("allows disconnect without active workspaces", () => {
    expect(decideTwilioDisconnect({ activeWorkspaceCount: 0 })).toEqual({ allowed: true });
  });

  it("blocks disconnect and echoes active workspace counts", () => {
    expect(decideTwilioDisconnect({ activeWorkspaceCount: 1 })).toEqual({ allowed: false, reason: "active_workspaces", activeWorkspaceCount: 1 });
    expect(decideTwilioDisconnect({ activeWorkspaceCount: 3 })).toEqual({ allowed: false, reason: "active_workspaces", activeWorkspaceCount: 3 });
  });

  it("validates Twilio Account and API key SIDs", () => {
    expect(isTwilioAccountSid(`AC${"a".repeat(32)}`)).toBe(true);
    expect(isTwilioApiKeySid(`SK${"1".repeat(32)}`)).toBe(true);
    expect(isTwilioAccountSid(`SK${"a".repeat(32)}`)).toBe(false);
    expect(isTwilioApiKeySid(`AC${"a".repeat(32)}`)).toBe(false);
    expect(isTwilioAccountSid(`AC${"a".repeat(31)}`)).toBe(false);
    expect(isTwilioApiKeySid(`SK${"a".repeat(33)}`)).toBe(false);
  });
});
