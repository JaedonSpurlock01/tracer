/**
 * -------------------------------------------------------------------------
 * @file   authorization.ts
 * @brief  Resolves authenticated Tracer actors and Operator access.
 *
 * @description
 *  Combines Better Auth sessions with Organization membership and the
 *  canonical User State policy used by protected server boundaries.
 *
 * @remarks
 *  Authorization remains independent of route or UI presentation.
 *
 * @see
 *  data/auth-policy.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  toCanonicalRole,
  type CanonicalRole,
  type MembershipRole,
  type UserState,
} from "@/data/auth-policy";
import { members, schema, users } from "@/data/schema";
import type { TracerAuth } from "@/data/tracer-auth";

export interface Actor {
  userId: string;
  organizationId: string;
  name: string;
  email: string;
  state: UserState;
  role: CanonicalRole;
}

export class AuthorizationError extends Error {
  constructor(public readonly status: 401 | 403) {
    super(status === 401 ? "Authentication required" : "Active Operator access required");
    this.name = "AuthorizationError";
  }
}

export async function resolveActor(
  auth: TracerAuth,
  database: NodePgDatabase<typeof schema>,
  headers: Headers,
): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) {
    return null;
  }

  const [membership] = await database
    .select({ organizationId: members.organizationId, role: members.role })
    .from(members)
    .where(eq(members.userId, session.user.id))
    .limit(1);
  if (!membership) {
    return null;
  }

  const sessionState = (session.user as { state?: UserState }).state;
  const state = sessionState ?? (await database
    .select({ state: users.state })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1))[0]?.state;
  if (!state) {
    return null;
  }

  return {
    userId: session.user.id,
    organizationId: membership.organizationId,
    name: session.user.name,
    email: session.user.email,
    state: state as UserState,
    role: toCanonicalRole(membership.role as MembershipRole),
  };
}

export function isActiveOperatorActor(actor: Actor | null): actor is Actor {
  return actor?.state === "Active" && actor.role === "Operator";
}

export async function requireActiveOperator(
  auth: TracerAuth,
  database: NodePgDatabase<typeof schema>,
  headers: Headers,
): Promise<Actor> {
  const actor = await resolveActor(auth, database, headers);
  if (!actor) {
    throw new AuthorizationError(401);
  }
  if (!isActiveOperatorActor(actor)) {
    throw new AuthorizationError(403);
  }
  return actor;
}
