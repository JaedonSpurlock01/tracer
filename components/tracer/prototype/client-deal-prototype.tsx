/**
 * PROTOTYPE - throwaway. Replaces the Deal section on
 * /workspaces/[id]/settings/site with one of three Client and Deal
 * variants when ?variant= is set outside production; otherwise renders
 * the real DealSettings passed as children. Client fields seed from the
 * Workspace name and the Site's Service Area and never persist.
 */
"use client";

import type { ReactNode } from "react";

import { VariantA, VariantB, VariantC, type ClientInfo, type VariantProps } from "@/components/tracer/prototype/client-deal-variants";
import PrototypeSwitcher, { usePrototypeVariant } from "@/components/tracer/prototype/prototype-switcher";

export function seedClient(workspaceName: string, serviceArea: { city: string | null; region: string | null } | null | undefined): ClientInfo {
  return {
    businessName: workspaceName,
    firstName: "",
    lastName: "",
    email: "",
    niche: "",
    city: serviceArea?.city ? [serviceArea.city, serviceArea.region].filter(Boolean).join(", ") : "",
  };
}

export default function ClientDealPrototype({ children, ...props }: VariantProps & { children: ReactNode }) {
  const variant = usePrototypeVariant();
  if (!variant) return <>{children}</>;
  const Variant = variant === "A" ? VariantA : variant === "B" ? VariantB : VariantC;
  return (
    <>
      <Variant key={variant} {...props} />
      <PrototypeSwitcher current={variant} />
    </>
  );
}
