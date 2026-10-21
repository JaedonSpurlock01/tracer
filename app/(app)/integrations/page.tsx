/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Integrations provider health surface.
 *
 * @description
 *  Restricts Organization provider connection management to Active Operators
 *  and loads provider health, the Twilio connection and its numbers, the
 *  Cloudflare connection and its Sites, and the DataForSEO connection on the
 *  server so the page renders without a loading Skeleton. The `provider`
 *  search parameter selects which provider's detail is shown, defaulting to
 *  Twilio, so a provider is linkable from the rest of Tracer.
 *
 * @remarks
 *  Server authorization complements the role-aware Sidebar navigation. Secret
 *  material never leaves the server; the connection record carries only a
 *  configured flag for the Auth Token.
 *
 * @see
 *  components/tracer/integrations-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import IntegrationsView from "@/components/tracer/integrations-view";
import { isActiveOperatorActor } from "@/data/authorization";
import { resolveRequestActor } from "@/app/(app)/actor";
import { createRuntimeCloudflareClient } from "@/data/cloudflare-runtime";
import { createFormsKey } from "@/data/form-submissions";
import { createRuntimeDataForSeoClient } from "@/data/dataforseo-runtime";
import { createIntegrations } from "@/data/integrations";
import { describeProviderHealth, isProviderId } from "@/data/provider-health";
import { withTracerRuntime } from "@/data/tracer-runtime";
import { createRuntimeTwilioClient } from "@/data/twilio-runtime";
import { createWorkspaces } from "@/data/workspaces";

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await resolveRequestActor();
  if (!isActiveOperatorActor(actor)) {
    notFound();
  }
  const initial = await withTracerRuntime(async (runtime) => {
    const integrations = createIntegrations({
      pool: runtime.pool,
      organizationId: actor.organizationId,
      twilio: createRuntimeTwilioClient(),
      cloudflare: createRuntimeCloudflareClient(),
      dataforseo: createRuntimeDataForSeoClient(),
      masterKey: runtime.masterKey,
      activeWorkspaceCount: () => createWorkspaces(runtime.pool, actor.organizationId).countActive(),
    });
    const twilio = await integrations.getTwilioConnection();
    const cloudflare = await integrations.getCloudflareConnection();
    const dataforseo = await integrations.getDataForSeoConnection();
    return {
      providers: describeProviderHealth(runtime.providerConfiguration, twilio, await integrations.getRecordingTransferHealth(), await integrations.getAnalysisProcessingHealth(), await integrations.getMediaLifecycleHealth(), cloudflare, dataforseo),
      twilio,
      numbers: twilio ? await integrations.listTwilioNumbers() : [],
      cloudflare,
      sites: cloudflare ? await integrations.listCloudflareSites() : [],
      dataforseo,
      formsKey: await createFormsKey(runtime.pool, actor).status(),
    };
  });
  const requested = (await searchParams).provider;
  return <IntegrationsView initial={initial} provider={isProviderId(requested) ? requested : "twilio"} />;
}
