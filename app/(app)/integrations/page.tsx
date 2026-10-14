/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Integrations placeholder.
 *
 * @description
 *  Restricts the Integrations surface to Active Operators until M5 delivers
 *  provider connection management.
 *
 * @remarks
 *  Server authorization complements the role-aware Sidebar navigation.
 *
 * @see
 *  data/authorization.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import { PagePlaceholder } from "@/components/tracer/page-placeholder";
import { isActiveOperatorActor } from "@/data/authorization";
import { resolveRequestActor } from "@/app/(app)/actor";

export default async function IntegrationsPage() {
  const actor = await resolveRequestActor();
  if (!isActiveOperatorActor(actor)) {
    notFound();
  }
  return <PagePlaceholder title="Integrations" description="Provider health and the Organization Twilio connection arrive in M5." />;
}
