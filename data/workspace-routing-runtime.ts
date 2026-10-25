/**
 * -------------------------------------------------------------------------
 * @file   workspace-routing-runtime.ts
 * @brief  Builds the Workspace routing service from request runtime resources.
 *
 * @description
 *  Keeps Twilio, Integrations, Workspace, and routing construction consistent
 *  across API routes and server-rendered Workspace pages.
 *
 * @remarks
 *  The helper owns no request state and only composes Organization-scoped
 *  services from the supplied runtime.
 *
 * @see
 *  data/workspace-routing.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { TracerRuntime } from "@/data/tracer-runtime";
import { createIntegrations } from "@/data/integrations";
import { createRuntimeTwilioClient } from "@/data/twilio-runtime";
import { createWorkspaceRouting } from "@/data/workspace-routing";
import { createWorkspaces } from "@/data/workspaces";
import type { WorkspaceRouting } from "@/data/workspace-routing";

export interface WorkspaceRoutingRuntimeParts {
  twilio: ReturnType<typeof createRuntimeTwilioClient>;
  integrations: ReturnType<typeof createIntegrations>;
  workspaces: ReturnType<typeof createWorkspaces>;
}

export function createWorkspaceRoutingRuntimeParts(
  runtime: Pick<TracerRuntime, "database" | "masterKey">,
  organizationId: string,
): WorkspaceRoutingRuntimeParts {
  const twilio = createRuntimeTwilioClient();
  const workspaces = createWorkspaces(runtime.database, organizationId);
  const integrations = createIntegrations({
    database: runtime.database,
    organizationId,
    twilio,
    masterKey: runtime.masterKey,
  });
  return { twilio, integrations, workspaces };
}

export function createWorkspaceRoutingFromRuntime(
  runtime: Pick<TracerRuntime, "database" | "masterKey" | "baseURL">,
  organizationId: string,
): WorkspaceRouting {
  const parts = createWorkspaceRoutingRuntimeParts(runtime, organizationId);
  return createWorkspaceRouting({
    database: runtime.database,
    organizationId,
    ...parts,
    baseURL: runtime.baseURL,
  });
}
