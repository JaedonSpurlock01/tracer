/**
 * -------------------------------------------------------------------------
 * @file   page.tsx
 * @brief  Renders the guarded Operator Users surface.
 *
 * @description
 *  Restricts User administration to Active Operators, loads the Organization's
 *  users on the server, and mounts the client data grid with them so it renders
 *  without a loading Skeleton.
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
import { createOperatorAdministration } from "@/data/operator-administration";
import { withTracerRuntime } from "@/data/tracer-runtime";

export default async function UsersPage() {
  const actor = await resolveRequestActor();
  if (!isActiveOperatorActor(actor)) {
    notFound();
  }
  const users = await withTracerRuntime(({ pool }) => createOperatorAdministration(pool, actor.organizationId).list());
  return <UsersView currentUserId={actor.userId} initialUsers={users} />;
}
