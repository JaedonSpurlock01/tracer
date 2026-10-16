/**
 * -------------------------------------------------------------------------
 * @file   integrations-handler.ts
 * @brief  Exposes authenticated Organization integration endpoints.
 *
 * @description
 *  Maps Integrations API requests to Twilio, Hyperdrive, and Email Service
 *  operations after resolving an Active Operator.
 *
 * @remarks
 *  Error responses contain provider-safe details and never return credentials.
 *
 * @see
 *  data/integrations.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import { AuthorizationError, requireActiveOperator } from "@/data/authorization";
import { createIntegrations, IntegrationsError, type Integrations } from "@/data/integrations";
import { describeProviderHealth, type ProviderConfiguration } from "@/data/provider-health";
import { schema } from "@/data/schema";
import { isAllowedRecipient, type TransactionalEmail } from "@/data/transactional-email";
import type { TracerAuth } from "@/data/tracer-auth";
import type { TwilioClient } from "@/data/twilio-client";

export interface IntegrationsHandlerOptions {
  auth: TracerAuth;
  database: NodePgDatabase<typeof schema>;
  pool: Pool;
  twilio: TwilioClient;
  masterKey: string | undefined;
  configuration: ProviderConfiguration;
  email: TransactionalEmail;
  emailFrom: string;
  allowedRecipients: ReadonlySet<string>;
  activeWorkspaceCount: (organizationId: string) => Promise<number>;
}

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function errorResponse(error: unknown): Response {
  if (error instanceof AuthorizationError) {
    return response({ error: error.status === 401 ? "unauthenticated" : "forbidden" }, error.status);
  }
  if (error instanceof IntegrationsError) {
    const status = error.code === "invalid_input"
      ? 400
      : error.code === "not_connected"
        ? 404
        : error.code === "already_connected" || error.code === "active_workspaces"
          ? 409
          : error.code === "authentication_failed"
            ? 422
            : error.code === "master_key_missing"
              ? 503
              : 502;
    const body: Record<string, unknown> = { error: error.code };
    if (error.detail) body.detail = error.detail;
    if (error.activeWorkspaceCount !== undefined) body.activeWorkspaceCount = error.activeWorkspaceCount;
    return response(body, status);
  }
  return response({ error: "invalid_input" }, 400);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new IntegrationsError("invalid_input");
  }
  return body as Record<string, unknown>;
}

export function createIntegrationsHandler(options: IntegrationsHandlerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const actor = await requireActiveOperator(options.auth, options.database, request.headers);
      const integrations: Integrations = createIntegrations({
        pool: options.pool,
        organizationId: actor.organizationId,
        twilio: options.twilio,
        masterKey: options.masterKey,
        activeWorkspaceCount: () => options.activeWorkspaceCount(actor.organizationId),
      });
      const route = new URL(request.url).pathname.replace(/^\/api\/integrations\/?/, "");
      if (request.method === "GET" && route === "") {
        const twilio = await integrations.getTwilioConnection();
        return response({ providers: describeProviderHealth(options.configuration, twilio), twilio });
      }
      if (request.method === "GET" && route === "twilio/numbers") {
        return response({ numbers: await integrations.listTwilioNumbers() });
      }
      if (request.method === "POST" && route === "twilio/connect") {
        const body = await readBody(request);
        if (typeof body.accountSid !== "string" || typeof body.apiKeySid !== "string" || typeof body.apiKeySecret !== "string") {
          throw new IntegrationsError("invalid_input");
        }
        return response({ connection: await integrations.connectTwilio({
          accountSid: body.accountSid,
          apiKeySid: body.apiKeySid,
          apiKeySecret: body.apiKeySecret,
          actorUserId: actor.userId,
        }) }, 201);
      }
      if (request.method === "POST" && route === "twilio/test") {
        return response({ connection: await integrations.testTwilio() });
      }
      if (request.method === "POST" && route === "twilio/rotate") {
        const body = await readBody(request);
        if (typeof body.apiKeySid !== "string" || typeof body.apiKeySecret !== "string") {
          throw new IntegrationsError("invalid_input");
        }
        return response({ connection: await integrations.rotateTwilioKey({ apiKeySid: body.apiKeySid, apiKeySecret: body.apiKeySecret }) });
      }
      if (request.method === "POST" && route === "twilio/auth-token") {
        const body = await readBody(request);
        if (typeof body.authToken !== "string") throw new IntegrationsError("invalid_input");
        return response({ connection: await integrations.setTwilioAuthToken({ authToken: body.authToken }) });
      }
      if (request.method === "POST" && route === "twilio/disconnect") {
        await integrations.disconnectTwilio();
        return response({ disconnected: true });
      }
      if (request.method === "POST" && route === "twilio/sync-numbers") {
        return response(await integrations.syncTwilioNumbers());
      }
      if (request.method === "POST" && route === "hyperdrive/test") {
        try {
          await options.pool.query("select 1");
          return response({ status: "ok", checkedAt: new Date().toISOString() });
        } catch {
          return response({ error: "provider_unavailable" }, 502);
        }
      }
      if (request.method === "POST" && route === "email/test") {
        if (!isAllowedRecipient(options.allowedRecipients, actor.email)) {
          return response({ error: "recipient_not_allowed" }, 409);
        }
        try {
          await options.email.send({
            to: actor.email,
            from: options.emailFrom,
            subject: "Tracer test email",
            text: "This test email confirms Cloudflare Email Service delivery for Tracer.",
            html: "This test email confirms Cloudflare Email Service delivery for Tracer.",
          });
          return response({ status: "sent", to: actor.email });
        } catch {
          return response({ error: "provider_unavailable" }, 502);
        }
      }
      return response({ error: "not_found" }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
