/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Sends the Workspace Settings route to its first section.
 *
 * @description
 *  Restricts Workspace settings to Active Operators and redirects to the
 *  General section page.
 *
 * @remarks
 *  The Operator check runs before the redirect so non-Operators receive Not
 *  Found here rather than after a redirect.
 *
 * @see
 *  app/(app)/workspaces/[id]/settings/[section]/page.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound, redirect } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import { isActiveOperatorActor } from "@/data/authorization";

export default async function WorkspaceSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveRequestActor();
  if (!isActiveOperatorActor(actor)) notFound();
  const { id } = await params;
  redirect(`/workspaces/${id}/settings/general`);
}
