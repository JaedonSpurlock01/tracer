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
import type { Pool } from "pg";

import {
  toCanonicalRole,
  type CanonicalRole,
  type MembershipRole,
  type UserState,
} from "@/data/auth-policy";
import type { TracerAuth } from "@/data/tracer-auth";

export interface Actor {
  userId: string;
  organizationId: string;
  name: string;
  email: string;
  timezone: string;
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
  connection: Pick<Pool, "query">,
  headers: Headers,
): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) {
    return null;
  }

  const membership = (await connection.query<{ organization_id: string; role: string }>(`select organization_id, role from member where user_id = $1 limit 1`, [session.user.id])).rows[0];
  if (!membership) {
    return null;
  }

  const sessionUser = session.user as { state?: UserState; timezone?: string };
  let state = sessionUser.state;
  let timezone = sessionUser.timezone;
  if (!state || !timezone) {
    const user = (await connection.query<{ state: string; timezone: string }>(`select state, timezone from "user" where id = $1 limit 1`, [session.user.id])).rows[0];
    state ??= user?.state as UserState | undefined;
    timezone ??= user?.timezone;
  }
  if (!state || !timezone) {
    return null;
  }

  return {
    userId: session.user.id,
    organizationId: membership.organization_id,
    name: session.user.name,
    email: session.user.email,
    timezone,
    state: state as UserState,
    role: toCanonicalRole(membership.role as MembershipRole),
  };
}

export function isActiveOperatorActor(actor: Actor | null): actor is Actor {
  return actor?.state === "Active" && actor.role === "Operator";
}

export async function requireActiveActor(
  auth: TracerAuth,
  connection: Pick<Pool, "query">,
  headers: Headers,
): Promise<Actor> {
  const actor = await resolveActor(auth, connection, headers);
  if (!actor) {
    throw new AuthorizationError(401);
  }
  if (actor.state !== "Active") {
    throw new AuthorizationError(403);
  }
  return actor;
}

export async function requireActiveOperator(
  auth: TracerAuth,
  connection: Pick<Pool, "query">,
  headers: Headers,
): Promise<Actor> {
  const actor = await resolveActor(auth, connection, headers);
  if (!actor) {
    throw new AuthorizationError(401);
  }
  if (!isActiveOperatorActor(actor)) {
    throw new AuthorizationError(403);
  }
  return actor;
}
