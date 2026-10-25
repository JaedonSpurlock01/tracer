/**
 * -------------------------------------------------------------------------
 * @file   integrations-handler.ts
 * @brief  Exposes authenticated Organization integration endpoints.
 *
 * @description
 *  Maps Integrations API requests to Twilio, Cloudflare, DataForSEO,
 *  Hyperdrive, and Email Service operations after resolving an Active
 *  Operator.
 *
 * @remarks
 *  Error responses contain provider-safe details and never return credentials.
 *  The Cloudflare sync route discovers Sites only; the hourly `site-sync`
 *  task records traffic, deployments, checks, and previews. A local full
 *  sync runner is passed in only by the non-production E2E fake so the
 *  Site page can be exercised without Trigger.dev, and likewise a local
 *  rank check runner so the Search panel can be exercised against the
 *  DataForSEO fake.
 *
 * @see
 *  data/integrations.ts
 *  data/site-sync.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */

import type { Database } from "@/data/database";
import { AuthorizationError, requireActiveOperator } from "@/data/authorization";
import type { CloudflareClient } from "@/data/cloudflare-client";
import type { DataForSeoClient } from "@/data/dataforseo-client";
import type { CloudflareConnectionRecord, CloudflareSiteListEntry } from "@/data/cloudflare-connection";
import type { DataForSeoConnectionRecord } from "@/data/dataforseo-connection";
import { createIntegrations, IntegrationsError, type Integrations, type TwilioConnectionRecord, type TwilioNumberRecord } from "@/data/integrations";
import { createFormsKey, type FormsKey } from "@/data/form-submissions";
import { describeProviderHealth, type ProviderConfiguration, type ProviderHealth } from "@/data/provider-health";
import type { RankCheckResult } from "@/data/rank-check";
import type { SiteSyncResult } from "@/data/site-sync";
import { isAllowedRecipient, type TransactionalEmail } from "@/data/transactional-email";
import type { TracerAuth } from "@/data/tracer-auth";
import type { TwilioClient } from "@/data/twilio-client";

export interface IntegrationsHandlerOptions {
  auth: TracerAuth;
  database: Database;
  twilio: TwilioClient;
  cloudflare: CloudflareClient;
  dataforseo?: DataForSeoClient;
  masterKey: string | undefined;
  configuration: ProviderConfiguration;
  email: TransactionalEmail;
  emailFrom: string;
  allowedRecipients: ReadonlySet<string>;
  syncSitesLocally?: (organizationId: string) => Promise<SiteSyncResult>;
  checkRankingsLocally?: (organizationId: string) => Promise<RankCheckResult>;
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
        : error.code === "already_connected" || error.code === "active_workspaces" || error.code === "active_site_links" || error.code === "credential_unreadable"
          ? 409
          : error.code === "authentication_failed"
            ? 422
            : error.code === "master_key_missing"
              ? 503
              : 502;
    const body: Record<string, unknown> = { error: error.code };
    if (error.detail) body.detail = error.detail;
    if (error.activeWorkspaceCount !== undefined) body.activeWorkspaceCount = error.activeWorkspaceCount;
    if (error.activeSiteLinkCount !== undefined) body.activeSiteLinkCount = error.activeSiteLinkCount;
    return response(body, status);
  }
  return response({ error: "invalid_input" }, 400);
}

/** Reads a JSON body when one was sent; a bodiless POST reads as an empty object. */
async function optionalBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) return {};
  return readBody(request);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new IntegrationsError("invalid_input");
  }
  return body as Record<string, unknown>;
}

/**
 * Loads everything the Integrations page shows in one parallel pass: the
 * three connections, provider health, the Twilio numbers and Cloudflare
 * Sites when their connection exists, and the Forms key status.
 */
export interface IntegrationsOverview {
  providers: ProviderHealth[];
  twilio: TwilioConnectionRecord | null;
  numbers: TwilioNumberRecord[];
  cloudflare: CloudflareConnectionRecord | null;
  sites: CloudflareSiteListEntry[];
  dataforseo: DataForSeoConnectionRecord | null;
  formsKey: Awaited<ReturnType<FormsKey["status"]>>;
}

export async function loadIntegrationsOverview(integrations: Integrations, configuration: ProviderConfiguration, formsKey: Pick<FormsKey, "status">): Promise<IntegrationsOverview> {
  const [twilio, cloudflare, dataforseo, transfer, analysis, media, formsKeyStatus] = await Promise.all([
    integrations.getTwilioConnection(),
    integrations.getCloudflareConnection(),
    integrations.getDataForSeoConnection(),
    integrations.getRecordingTransferHealth(),
    integrations.getAnalysisProcessingHealth(),
    integrations.getMediaLifecycleHealth(),
    formsKey.status(),
  ]);
  const [numbers, sites] = await Promise.all([
    twilio ? integrations.listTwilioNumbers() : Promise.resolve([]),
    cloudflare ? integrations.listCloudflareSites() : Promise.resolve([]),
  ]);
  return {
    providers: describeProviderHealth(configuration, twilio, transfer, analysis, media, cloudflare, dataforseo),
    twilio,
    numbers,
    cloudflare,
    sites,
    dataforseo,
    formsKey: formsKeyStatus,
  };
}

export function createIntegrationsHandler(options: IntegrationsHandlerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const actor = await requireActiveOperator(options.auth, options.database, request.headers);
      const integrations: Integrations = createIntegrations({
        database: options.database,
        organizationId: actor.organizationId,
        twilio: options.twilio,
        cloudflare: options.cloudflare,
        dataforseo: options.dataforseo,
        masterKey: options.masterKey,
      });
      const route = new URL(request.url).pathname.replace(/^\/api\/integrations\/?/, "");
      if (request.method === "GET" && route === "") {
        return response(await loadIntegrationsOverview(integrations, options.configuration, createFormsKey(options.database, actor)));
      }
      if (request.method === "POST" && route === "forms-key") return response(await createFormsKey(options.database, actor).generate(), 201);
      if (request.method === "DELETE" && route === "forms-key") {
        await createFormsKey(options.database, actor).revoke();
        return new Response(null, { status: 204 });
      }
      if (request.method === "POST" && route === "dataforseo/connect") {
        const body = await readBody(request);
        if (typeof body.login !== "string" || typeof body.password !== "string") throw new IntegrationsError("invalid_input");
        return response({ connection: await integrations.connectDataForSeo({ login: body.login, password: body.password, actorUserId: actor.userId }) }, 201);
      }
      if (request.method === "POST" && route === "dataforseo/test") {
        return response({ connection: await integrations.testDataForSeo() });
      }
      if (request.method === "POST" && route === "dataforseo/rotate") {
        const body = await readBody(request);
        if (typeof body.password !== "string") throw new IntegrationsError("invalid_input");
        return response({ connection: await integrations.rotateDataForSeoPassword({ password: body.password }) });
      }
      if (request.method === "POST" && route === "dataforseo/disconnect") {
        await integrations.disconnectDataForSeo();
        return response({ disconnected: true });
      }
      if (request.method === "POST" && route === "dataforseo/check" && options.checkRankingsLocally) {
        return response(await options.checkRankingsLocally(actor.organizationId));
      }
      if (request.method === "GET" && route === "cloudflare/sites") {
        return response({ sites: await integrations.listCloudflareSites() });
      }
      if (request.method === "POST" && route === "cloudflare/connect") {
        const body = await readBody(request);
        if (typeof body.accountId !== "string" || typeof body.apiToken !== "string") throw new IntegrationsError("invalid_input");
        return response({ connection: await integrations.connectCloudflare({ accountId: body.accountId, apiToken: body.apiToken, actorUserId: actor.userId }) }, 201);
      }
      if (request.method === "POST" && route === "cloudflare/test") {
        return response({ connection: await integrations.testCloudflare() });
      }
      if (request.method === "POST" && route === "cloudflare/rotate") {
        const body = await readBody(request);
        if (typeof body.apiToken !== "string") throw new IntegrationsError("invalid_input");
        return response({ connection: await integrations.rotateCloudflareToken({ apiToken: body.apiToken }) });
      }
      if (request.method === "POST" && route === "cloudflare/disconnect") {
        await integrations.disconnectCloudflare();
        return response({ disconnected: true });
      }
      if (request.method === "POST" && route === "cloudflare/sync") {
        const discovery = await integrations.syncSites();
        if (!options.syncSitesLocally) return response(discovery);
        return response({ ...discovery, sync: await options.syncSitesLocally(actor.organizationId) });
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
        const force = (await optionalBody(request)).force === true;
        const result = await integrations.disconnectTwilio({ force });
        return response(force ? { disconnected: true, endedAssignments: result.endedAssignments } : { disconnected: true });
      }
      if (request.method === "POST" && route === "twilio/sync-numbers") {
        return response(await integrations.syncTwilioNumbers());
      }
      if (request.method === "POST" && route === "hyperdrive/test") {
        try {
          await options.database.query("select 1");
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
