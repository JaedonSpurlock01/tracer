/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Pricing guide route.
 *
 * @description
 *  Restricts the Pricing guide to Active Operators and renders the rate
 *  table with the worked two-hour Call. The page needs no data beyond the
 *  maintained rate table.
 *
 * @remarks
 *  The route is listed nowhere in the Sidebar; it is reached from the
 *  Home Money row and the Site Deal and cost panel. Client Viewers get
 *  Not Found like every Operator-only page.
 *
 * @see
 *  components/tracer/pricing-guide.tsx
 *  data/pricing.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import PricingGuide from "@/components/tracer/pricing-guide";
import { isActiveOperatorActor } from "@/data/authorization";

export default async function PricingPage() {
  const actor = await resolveRequestActor();
  if (!isActiveOperatorActor(actor)) notFound();
  return <PricingGuide />;
}
