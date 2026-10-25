/**
 * -------------------------------------------------------------------------
 * @file   route.ts
 * @brief  Mounts authenticated Workspace endpoints.
 *
 * @description
 *  Creates a request-scoped Workspace handler with Tracer runtime resources.
 *
 * @remarks
 *  The request-scoped runtime supplies the provider and encrypted credential
 *  boundaries used by Workspace routing operations.
 *
 * @see
 *  data/workspaces-handler.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { createRuntimeCloudflareClient } from "@/data/cloudflare-runtime";
import { createRuntimeDataForSeoClient } from "@/data/dataforseo-runtime";
import { createPlacesClient } from "@/data/places-client";
import { sitePreviewObjectsFromBinding } from "@/data/site-preview";
import { createTwilioRecordingMedia } from "@/data/twilio-client";
import { createRuntimeTwilioClient } from "@/data/twilio-runtime";
import { createWorkspaceRoutingRuntimeParts } from "@/data/workspace-routing-runtime";
import { createWorkspacesHandler } from "@/data/workspaces-handler";
import { withTracerRuntime } from "@/data/tracer-runtime";

async function handle(request: Request): Promise<Response> {
  return withTracerRuntime((runtime) =>
    createWorkspacesHandler({
      ...runtime,
      email: runtime.email,
      places: createPlacesClient(),
      twilio: createRuntimeTwilioClient(),
      twilioMedia: createTwilioRecordingMedia(),
      cloudflare: createRuntimeCloudflareClient(),
      dataforseo: createRuntimeDataForSeoClient(),
      sitePreviews: runtime.recordingBucket ? sitePreviewObjectsFromBinding(runtime.recordingBucket) : undefined,
      integrations: (organizationId) => createWorkspaceRoutingRuntimeParts(runtime, organizationId).integrations,
      baseURL: runtime.baseURL,
    })(request),
  );
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
