/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Integrations provider health surface.
 *
 * @description
 *  Restricts Organization provider connection management to Active Operators
 *  and loads provider health, the Twilio connection, and its numbers on the
 *  server so the page renders without a loading Skeleton.
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
import { createIntegrations } from "@/data/integrations";
import { describeProviderHealth } from "@/data/provider-health";
import { withTracerRuntime } from "@/data/tracer-runtime";
import { createRuntimeTwilioClient } from "@/data/twilio-runtime";
import { createWorkspaces } from "@/data/workspaces";

export default async function IntegrationsPage() {
  const actor = await resolveRequestActor();
  if (!isActiveOperatorActor(actor)) {
    notFound();
  }
  const initial = await withTracerRuntime(async (runtime) => {
    const integrations = createIntegrations({
      pool: runtime.pool,
      organizationId: actor.organizationId,
      twilio: createRuntimeTwilioClient(),
      masterKey: runtime.masterKey,
      activeWorkspaceCount: () => createWorkspaces(runtime.pool, actor.organizationId).countActive(),
    });
    const twilio = await integrations.getTwilioConnection();
    return {
      providers: describeProviderHealth(runtime.providerConfiguration, twilio),
      twilio,
      numbers: twilio ? await integrations.listTwilioNumbers() : [],
    };
  });
  return <IntegrationsView initial={initial} />;
}
