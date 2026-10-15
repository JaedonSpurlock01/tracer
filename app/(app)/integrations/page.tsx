/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Integrations provider health surface.
 *
 * @description
 *  Restricts Organization provider connection management to Active Operators.
 *
 * @remarks
 *  Server authorization complements the role-aware Sidebar navigation.
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

export default async function IntegrationsPage() {
  const actor = await resolveRequestActor();
  if (!isActiveOperatorActor(actor)) {
    notFound();
  }
  return <IntegrationsView />;
}
