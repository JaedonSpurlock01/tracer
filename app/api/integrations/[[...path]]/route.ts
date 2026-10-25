/**
 * -------------------------------------------------------------------------
 * @file   route.ts
 * @brief  Mounts the authenticated Organization integration endpoints.
 *
 * @description
 *  Creates the request-scoped integrations handler for provider health and
 *  the Twilio, Cloudflare, and DataForSEO connection operations.
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
import { createRuntimeCloudflareClient, isE2eCloudflareFake } from "@/data/cloudflare-runtime";
import { createRuntimeDataForSeoClient, isE2eDataForSeoFake } from "@/data/dataforseo-runtime";
import { createE2eSiteCheckFetch } from "@/data/e2e-cloudflare-fake";
import { createIntegrationsHandler } from "@/data/integrations-handler";
import { checkRankings } from "@/data/rank-check";
import { sitePreviewObjectsFromBinding } from "@/data/site-preview";
import { syncSites } from "@/data/site-sync";
import { withTracerRuntime } from "@/data/tracer-runtime";
import { createRuntimeTwilioClient } from "@/data/twilio-runtime";

async function handle(request: Request): Promise<Response> {
  return withTracerRuntime((runtime) => {
    const cloudflare = createRuntimeCloudflareClient();
    const dataforseo = createRuntimeDataForSeoClient();
    const masterKey = runtime.masterKey;
    return createIntegrationsHandler({
      ...runtime,
      configuration: runtime.providerConfiguration,
      twilio: createRuntimeTwilioClient(),
      cloudflare,
      dataforseo,
      syncSitesLocally: isE2eCloudflareFake() && masterKey
        ? (organizationId) => syncSites({
            database: runtime.database,
            cloudflare,
            objects: runtime.recordingBucket ? sitePreviewObjectsFromBinding(runtime.recordingBucket) : undefined,
            masterKey,
            fetch: createE2eSiteCheckFetch(),
            now: new Date(),
            organizationId,
          })
        : undefined,
      checkRankingsLocally: isE2eDataForSeoFake() && masterKey
        ? (organizationId) => checkRankings({ database: runtime.database, dataforseo, masterKey, now: new Date(), organizationId })
        : undefined,
    })(request);
  });
}

export const GET = handle;
export const POST = handle;
