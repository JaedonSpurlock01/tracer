/**
 * -------------------------------------------------------------------------
 * @file   integrations-policy.ts
 * @brief  Defines Organization integration policy decisions.
 *
 * @description
 *  Protects Twilio and Cloudflare disconnects and validates provider
 *  identifiers.
 *
 * @remarks
 *  Workspace counts are evaluated by the Organization integration service.
 *
 * @see
 *  data/integrations.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export type TwilioDisconnectDecision =
  | { allowed: true }
  | { allowed: false; reason: "active_workspaces"; activeWorkspaceCount: number };

export function decideTwilioDisconnect(input: { activeWorkspaceCount: number }): TwilioDisconnectDecision {
  return input.activeWorkspaceCount === 0
    ? { allowed: true }
    : { allowed: false, reason: "active_workspaces", activeWorkspaceCount: input.activeWorkspaceCount };
}

export function isTwilioAccountSid(value: string): boolean {
  return /^AC[0-9a-f]{32}$/i.test(value);
}

export function isTwilioApiKeySid(value: string): boolean {
  return /^SK[0-9a-f]{32}$/i.test(value);
}

export type CloudflareDisconnectDecision =
  | { allowed: true }
  | { allowed: false; reason: "active_site_links"; openSiteLinkCount: number };

export function decideCloudflareDisconnect(input: { openSiteLinkCount: number }): CloudflareDisconnectDecision {
  return input.openSiteLinkCount === 0
    ? { allowed: true }
    : { allowed: false, reason: "active_site_links", openSiteLinkCount: input.openSiteLinkCount };
}

export function isCloudflareAccountId(value: string): boolean {
  return /^[0-9a-f]{32}$/i.test(value);
}
