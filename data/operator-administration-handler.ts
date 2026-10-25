/**
 * -------------------------------------------------------------------------
 * @file   operator-administration-handler.ts
 * @brief  Exposes authenticated HTTP routes for Operator administration.
 *
 * @description
 *  Maps requests under /api/users to Organization-scoped administration
 *  operations and access-created email delivery.
 *
 * @remarks
 *  Every route resolves an Active Operator before touching administration data.
 *
 * @see
 *  data/authorization.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Pool } from "pg";

import { AuthorizationError, requireActiveOperator } from "@/data/authorization";
import {
  createOperatorAdministration,
  OperatorAdministrationError,
  type OperatorAdministration,
  type OperatorRecord,
} from "@/data/operator-administration";
import { isAllowedRecipient, sendAccessCreatedNotice, type TransactionalEmail } from "@/data/transactional-email";
import type { TracerAuth } from "@/data/tracer-auth";

export interface OperatorAdministrationHandlerOptions {
  auth: TracerAuth;
  pool: Pool;
  email: TransactionalEmail;
  emailFrom: string;
  allowedRecipients: ReadonlySet<string>;
  signInUrl: string;
}

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function errorResponse(error: unknown): Response {
  if (error instanceof AuthorizationError) {
    return response({ error: error.status === 401 ? "unauthenticated" : "forbidden" }, error.status);
  }
  if (error instanceof OperatorAdministrationError) {
    const status = error.code === "invalid_input" || error.code === "role_unavailable" || error.code === "access_grant_required"
      ? 400
      : error.code === "not_found"
        ? 404
        : 409;
    return response({ error: error.code }, status);
  }
  return response({ error: "invalid_input" }, 400);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new OperatorAdministrationError("invalid_input");
  }
  return body as Record<string, unknown>;
}

function isWorkspaceIdList(value: unknown): value is string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every((id) => typeof id === "string"));
}

async function deliver(
  options: OperatorAdministrationHandlerOptions,
  user: OperatorRecord,
  sendEmail: boolean,
): Promise<"sent" | "failed" | "skipped"> {
  if (!sendEmail || !isAllowedRecipient(options.allowedRecipients, user.email)) {
    return "skipped";
  }
  try {
    await sendAccessCreatedNotice(options.email, {
      to: user.email,
      from: options.emailFrom,
      signInUrl: options.signInUrl,
      workspaceNames: user.role === "Client Viewer" ? user.accessGrants.map((grant) => grant.workspaceName) : [],
    });
    return "sent";
  } catch {
    return "failed";
  }
}

export function createOperatorAdministrationHandler(
  options: OperatorAdministrationHandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let administration: OperatorAdministration | undefined;
    try {
      const actor = await requireActiveOperator(options.auth, options.pool, request.headers);
      administration = createOperatorAdministration(options.pool, actor.organizationId);
      const route = new URL(request.url).pathname.replace(/^\/api\/users\/?/, "");
      if (request.method === "GET" && route === "") {
        return response({ users: await administration.list() });
      }
      if (request.method === "POST" && route === "") {
        const body = await readBody(request);
        if (typeof body.email !== "string" || typeof body.role !== "string" || !isWorkspaceIdList(body.workspaceIds)) {
          throw new OperatorAdministrationError("invalid_input");
        }
        const user = await administration.provision({
          email: body.email,
          name: typeof body.name === "string" ? body.name : undefined,
          role: body.role,
          workspaceIds: body.workspaceIds,
          actorUserId: actor.userId,
        });
        const delivery = await deliver(options, user, body.sendEmail !== false);
        return response({ user, delivery }, 201);
      }

      const stateMatch = route.match(/^([^/]+)\/state$/);
      if (request.method === "POST" && stateMatch) {
        const body = await readBody(request);
        if (body.state !== "Active" && body.state !== "Disabled") {
          throw new OperatorAdministrationError("invalid_input");
        }
        return response({ user: await administration.setState(stateMatch[1], body.state) });
      }

      const roleMatch = route.match(/^([^/]+)\/role$/);
      if (request.method === "POST" && roleMatch) {
        const body = await readBody(request);
        if (typeof body.role !== "string" || !isWorkspaceIdList(body.workspaceIds)) {
          throw new OperatorAdministrationError("invalid_input");
        }
        return response({
          user: await administration.setRole({
            userId: roleMatch[1],
            role: body.role,
            workspaceIds: body.workspaceIds,
            actorUserId: actor.userId,
          }),
        });
      }

      const grantsMatch = route.match(/^([^/]+)\/access-grants$/);
      if (request.method === "POST" && grantsMatch) {
        const body = await readBody(request);
        if (typeof body.workspaceId !== "string") {
          throw new OperatorAdministrationError("invalid_input");
        }
        return response({
          user: await administration.addAccessGrant({
            userId: grantsMatch[1],
            workspaceId: body.workspaceId,
            actorUserId: actor.userId,
          }),
        });
      }

      const grantMatch = route.match(/^([^/]+)\/access-grants\/([^/]+)$/);
      if (request.method === "DELETE" && grantMatch) {
        return response({
          user: await administration.removeAccessGrant({ userId: grantMatch[1], workspaceId: grantMatch[2] }),
        });
      }

      const resendMatch = route.match(/^([^/]+)\/resend-access$/);
      if (request.method === "POST" && resendMatch) {
        const user = await administration.find(resendMatch[1]);
        if (!user) {
          throw new OperatorAdministrationError("not_found");
        }
        if (user.state !== "Provisioned") {
          throw new OperatorAdministrationError("state_unchanged");
        }
        return response({ delivery: await deliver(options, user, true) });
      }

      return response({ error: "not_found" }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
