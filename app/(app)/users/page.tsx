/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Operator Users surface.
 *
 * @description
 *  Restricts User administration to Active Operators and mounts the client
 *  data grid for Organization user management.
 *
 * @remarks
 *  Server authorization complements the role-aware Sidebar navigation.
 *
 * @see
 *  components/tracer/users-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { notFound } from "next/navigation";

import { resolveRequestActor } from "@/app/(app)/actor";
import UsersView from "@/components/tracer/users-view";
import { isActiveOperatorActor } from "@/data/authorization";

export default async function UsersPage() {
  const actor = await resolveRequestActor();
  if (!isActiveOperatorActor(actor)) {
    notFound();
  }
  return <UsersView currentUserId={actor.userId} />;
}
