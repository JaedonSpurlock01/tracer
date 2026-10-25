/**
 * -------------------------------------------------------------------------
 * @file   layout.tsx
 * @brief  Denies the Operator-only Workspace pages before anything streams.
 *
 * @description
 *  Call Flow and Workspace Settings live in this route group. The layout
 *  answers Not Found for anyone who is not an Active Operator, so a Client
 *  Viewer typing a Settings or Flow URL gets a real 404 status before the
 *  group's loading boundary can start streaming a 200.
 *
 * @remarks
 *  The Workspace layout above has already refused a Workspace the actor
 *  cannot read; this layout adds the role check for its group.
 *
 * @see
 *  app/(app)/workspaces/[id]/layout.tsx
 *  app/(app)/(operator)/layout.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { resolveRequestActor } from "@/app/(app)/actor";
import { isActiveOperatorActor } from "@/data/authorization";

export default async function WorkspaceOperatorLayout({ children }: { children: ReactNode }) {
  if (!isActiveOperatorActor(await resolveRequestActor())) notFound();
  return children;
}
