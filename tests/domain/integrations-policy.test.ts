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

import { decideCloudflareDisconnect, decideTwilioDisconnect, isCloudflareAccountId, isTwilioAccountSid, isTwilioApiKeySid } from "@/data/integrations-policy";

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

describe("Cloudflare integration policy", () => {
  it("allows disconnect without open Site Links and blocks it with the count otherwise", () => {
    expect(decideCloudflareDisconnect({ openSiteLinkCount: 0 })).toEqual({ allowed: true });
    expect(decideCloudflareDisconnect({ openSiteLinkCount: 2 })).toEqual({ allowed: false, reason: "active_site_links", openSiteLinkCount: 2 });
  });

  it("validates the Cloudflare Account ID as 32 hexadecimal characters", () => {
    expect(isCloudflareAccountId("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isCloudflareAccountId("0123456789ABCDEF0123456789ABCDEF")).toBe(true);
    expect(isCloudflareAccountId("0123456789abcdef0123456789abcde")).toBe(false);
    expect(isCloudflareAccountId("g123456789abcdef0123456789abcdef")).toBe(false);
  });
});
