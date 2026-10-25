/**
 * -------------------------------------------------------------------------
 * @file   layout.tsx
 * @brief  Denies the Operator-only global pages before anything streams.
 *
 * @description
 *  Users, Integrations, and Pricing live in this route group. The layout
 *  resolves the actor and answers Not Found for anyone who is not an Active
 *  Operator, so the response carries a real 404 status: the group's loading
 *  boundary sits below this check, and a notFound thrown after streaming
 *  starts could only produce a 200 with a noindex tag.
 *
 * @remarks
 *  Each page keeps its own check as well; this layout exists for the status
 *  code, not as the only guard.
 *
 * @see
 *  app/(app)/workspaces/[id]/(operator)/layout.tsx
 *  components/tracer/page-loading.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { resolveRequestActor } from "@/app/(app)/actor";
import { isActiveOperatorActor } from "@/data/authorization";

export default async function OperatorLayout({ children }: { children: ReactNode }) {
  if (!isActiveOperatorActor(await resolveRequestActor())) notFound();
  return children;
}
