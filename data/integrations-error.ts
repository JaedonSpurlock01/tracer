/**
 * -------------------------------------------------------------------------
 * @file   integrations-error.ts
 * @brief  Defines the Organization integration error.
 *
 * @description
 *  Shared by the Twilio and Cloudflare connection services and mapped to
 *  HTTP status codes by the Integrations handler.
 *
 * @remarks
 *  Lives apart from the services so the Cloudflare connection module and
 *  the Twilio-centred integrations module can both throw it without a
 *  circular import.
 *
 * @see
 *  data/integrations.ts
 *  data/cloudflare-connection.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export type IntegrationsErrorCode =
  | "invalid_input"
  | "master_key_missing"
  | "not_connected"
  | "already_connected"
  | "authentication_failed"
  | "provider_unavailable"
  | "active_workspaces"
  | "active_site_links";

export class IntegrationsError extends Error {
  constructor(
    public readonly code: IntegrationsErrorCode,
    public readonly detail?: string,
    public readonly activeWorkspaceCount?: number,
    public readonly activeSiteLinkCount?: number,
  ) {
    super(code);
    this.name = "IntegrationsError";
  }
}
