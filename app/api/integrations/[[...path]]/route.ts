/**
 * -------------------------------------------------------------------------
 * @file   route.ts
 * @brief  Mounts the authenticated Organization integration endpoints.
 *
 * @description
 *  Creates the request-scoped integrations handler for provider health and
 *  Twilio connection operations.
 *
 * @remarks
 *  Authorization and database resources are resolved per request.
 *
 * @see
 *  data/integrations-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createIntegrationsHandler } from "@/data/integrations-handler";
import { createWorkspaces } from "@/data/workspaces";
import { withTracerRuntime } from "@/data/tracer-runtime";
import { createTwilioRestClient } from "@/data/twilio-client";

async function handle(request: Request): Promise<Response> {
  return withTracerRuntime((runtime) => createIntegrationsHandler({
    ...runtime,
    configuration: runtime.providerConfiguration,
    twilio: createTwilioRestClient(),
    activeWorkspaceCount: (organizationId) => createWorkspaces(runtime.pool, organizationId).countActive(),
  })(request));
}

export const GET = handle;
export const POST = handle;
