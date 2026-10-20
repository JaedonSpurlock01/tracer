/**
 * -------------------------------------------------------------------------
 * @file   workspaces-handler.ts
 * @brief  Exposes authenticated Workspace HTTP routes.
 *
 * @description
 *  Resolves Active Operators and maps Workspace and routing requests to their
 *  Organization-scoped services. Streams available Recording audio, serves
 *  its waveform peaks and MP3 download, and reads Call Detail and Recent
 *  Calls, for any actor who can currently read its Workspace. The Workspace list carries each
 *  listed Workspace's analytics list stats. Saves an Operator's Lead Review,
 *  accepts an Operator's Retry of a failed Transcript or Lead Assessment,
 *  and purges a Call's Recording media for an Operator.
 *
 * @remarks
 *  Routing mutations remain in workspace-routing.ts rather than the Workspace
 *  lifecycle repository.
 *
 * @see
 *  data/workspace-routing.ts
 *  data/analytics.ts
 *  data/recording-audio.ts
 *  data/recording-media.ts
 *  data/media-purge.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import { createAnalytics, withWorkspaceListStats } from "@/data/analytics";
import { AnalysisRetryError, retryCallAnalysis } from "@/data/analysis-retry";
import { AuthorizationError, requireActiveActor } from "@/data/authorization";
import { createCallDetails } from "@/data/call-details";
import type { Integrations } from "@/data/integrations";
import { parseLeadReviewInput } from "@/data/lead-classification";
import { saveLeadReview } from "@/data/lead-reviews";
import { purgeCallMedia } from "@/data/media-purge";
import type { RecordingProcessing } from "@/data/recording";
import { recordingAudioResponse } from "@/data/recording-audio";
import { findAvailableRecordingMedia, recordingMp3Response, recordingPeaksResponse, type RecordingMediaBucket } from "@/data/recording-media";
import { createWorkspaceRouting, RoutingError, type RoutingSettingsInput } from "@/data/workspace-routing";
import { createWorkspaces, WorkspacesError, type Workspaces } from "@/data/workspaces";
import type { TwilioClient } from "@/data/twilio-client";
import { schema } from "@/data/schema";
import type { TracerAuth } from "@/data/tracer-auth";
import { canManageWorkspaces, createReadableWorkspaces } from "@/data/workspace-authorization";
import { workspaceStates, type WorkspaceState } from "@/data/workspace-policy";

export interface WorkspacesHandlerOptions {
  auth: TracerAuth;
  database: NodePgDatabase<typeof schema>;
  pool: Pool;
  twilio: TwilioClient;
  integrations: (organizationId: string) => Integrations;
  baseURL: string;
  recordingBucket?: RecordingMediaBucket;
  recordingTranscription?: RecordingProcessing;
  recordingLeadAssessment?: RecordingProcessing;
}

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function errorResponse(error: unknown): Response {
  if (error instanceof AuthorizationError) {
    return response({ error: error.status === 401 ? "unauthenticated" : "forbidden" }, error.status);
  }
  if (error instanceof AnalysisRetryError) return response({ error: "provider_unavailable" }, 502);
  if (error instanceof WorkspacesError) {
    const status = error.code === "invalid_input" ? 400 : error.code === "not_found" ? 404 : 409;
    return response({ error: error.code }, status);
  }
  if (error instanceof RoutingError) {
    const status =
      error.code === "invalid_input"
        ? 400
        : error.code === "not_found"
          ? 404
          : error.code === "draft_invalid"
            ? 422
            : error.code === "provider_unavailable"
              ? 502
              : 409;
    const body: Record<string, unknown> = { error: error.code };
    if (error.issues) body.issues = error.issues;
    if (error.detail) body.detail = error.detail;
    return response(body, status);
  }
  return response({ error: "invalid_input" }, 400);
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkspacesError("invalid_input");
  return body as Record<string, unknown>;
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function routingInput(body: Record<string, unknown>): RoutingSettingsInput {
  if (
    typeof body.destinationNumber !== "string" ||
    typeof body.recordingEnabled !== "boolean" ||
    typeof body.analysisEnabled !== "boolean" ||
    typeof body.spamGateEnabled !== "boolean" ||
    typeof body.whisperEnabled !== "boolean" ||
    (body.whisperMessage !== null && typeof body.whisperMessage !== "string") ||
    (body.disclosureVoice !== undefined && typeof body.disclosureVoice !== "string")
  ) {
    throw new RoutingError("invalid_input");
  }
  return {
    destinationNumber: body.destinationNumber,
    recordingEnabled: body.recordingEnabled,
    analysisEnabled: body.analysisEnabled,
    spamGateEnabled: body.spamGateEnabled,
    whisperEnabled: body.whisperEnabled,
    whisperMessage: body.whisperMessage,
    disclosureVoice: body.disclosureVoice as RoutingSettingsInput["disclosureVoice"],
  };
}

export function createWorkspacesHandler(options: WorkspacesHandlerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const actor = await requireActiveActor(options.auth, options.database, request.headers);
      const route = new URL(request.url).pathname.replace(/^\/api\/workspaces\/?/, "");
      const mediaMatch = route.match(/^([^/]+)\/recordings\/([^/]+)\/(audio|peaks|mp3)$/);
      if (request.method === "GET" && mediaMatch) {
        const workspace = await createReadableWorkspaces(options.pool, actor).find(mediaMatch[1]);
        if (!workspace) throw new WorkspacesError("not_found");
        const media = await findAvailableRecordingMedia(options.pool, { organizationId: actor.organizationId, workspaceId: workspace.id, recordingId: mediaMatch[2] });
        const bucket = options.recordingBucket;
        const served =
          !media || !bucket
            ? null
            : mediaMatch[3] === "audio"
              ? await recordingAudioResponse(bucket, media.audio, request.headers.get("range"))
              : mediaMatch[3] === "peaks"
                ? media.peaksKey
                  ? await recordingPeaksResponse(bucket, media.peaksKey)
                  : null
                : media.mp3
                  ? await recordingMp3Response(bucket, media.mp3)
                  : null;
        if (!served) throw new WorkspacesError("not_found");
        return served;
      }
      const recentCallsMatch = route.match(/^([^/]+)\/calls$/);
      if (request.method === "GET" && recentCallsMatch) {
        const calls = await createCallDetails(options.pool, actor).listRecent(recentCallsMatch[1]);
        if (!calls) throw new WorkspacesError("not_found");
        return Response.json({ calls }, { headers: { "cache-control": "private, no-store" } });
      }
      const callMatch = route.match(/^([^/]+)\/calls\/([^/]+)$/);
      if (request.method === "GET" && callMatch) {
        const call = await createCallDetails(options.pool, actor).find(callMatch[1], callMatch[2]);
        if (!call) throw new WorkspacesError("not_found");
        return Response.json({ call }, { headers: { "cache-control": "private, no-store" } });
      }
      if (request.method === "GET" && (route === "" || (route !== "numbers" && /^[^/]+$/.test(route)))) {
        const readable = createReadableWorkspaces(options.pool, actor);
        if (route !== "") {
          const workspace = await readable.find(route);
          if (!workspace) throw new WorkspacesError("not_found");
          return response({ workspace });
        }
        const url = new URL(request.url);
        const state = url.searchParams.get("state") ?? "All";
        if (state !== "All" && !workspaceStates.includes(state as WorkspaceState)) throw new WorkspacesError("invalid_input");
        const listed = await readable.list({
          search: url.searchParams.get("search") ?? undefined,
          state: state as WorkspaceState | "All",
          page: parsePositiveInteger(url.searchParams.get("page")),
          pageSize: parsePositiveInteger(url.searchParams.get("pageSize")),
        });
        return response(await withWorkspaceListStats(createAnalytics(options.pool, actor), listed));
      }
      if (!canManageWorkspaces(actor)) throw new AuthorizationError(403);
      const leadReviewMatch = route.match(/^([^/]+)\/calls\/([^/]+)\/lead-review$/);
      if (request.method === "PUT" && leadReviewMatch) {
        const input = parseLeadReviewInput(await readBody(request));
        if (!input) throw new WorkspacesError("invalid_input");
        return response({ leadReview: await saveLeadReview(options.pool, actor, leadReviewMatch[1], leadReviewMatch[2], input) });
      }
      const retryMatch = route.match(/^([^/]+)\/calls\/([^/]+)\/analysis\/retry$/);
      if (request.method === "POST" && retryMatch) {
        const retried = await retryCallAnalysis(options.pool, actor, retryMatch[1], retryMatch[2], {
          transcription: options.recordingTranscription,
          leadAssessment: options.recordingLeadAssessment,
        });
        if (retried === "not_found") throw new WorkspacesError("not_found");
        if (retried === "nothing_to_retry") return response({ error: "nothing_to_retry" }, 409);
        return response({ retry: retried }, 202);
      }
      const purgeMatch = route.match(/^([^/]+)\/calls\/([^/]+)\/media\/purge$/);
      if (request.method === "POST" && purgeMatch) {
        const purged = await purgeCallMedia({ pool: options.pool, objects: options.recordingBucket }, actor, purgeMatch[1], purgeMatch[2], new Date());
        if (purged === "not_found") throw new WorkspacesError("not_found");
        if (typeof purged === "string") return response({ error: purged }, 409);
        return response({ purge: purged });
      }
      const workspaces: Workspaces = createWorkspaces(options.pool, actor.organizationId);
      const routing = createWorkspaceRouting({
        pool: options.pool,
        organizationId: actor.organizationId,
        twilio: options.twilio,
        integrations: options.integrations(actor.organizationId),
        workspaces,
        baseURL: options.baseURL,
      });
      if (request.method === "POST" && route === "") {
        const body = await readBody(request);
        if (typeof body.name !== "string" || typeof body.reportingTimezone !== "string") throw new WorkspacesError("invalid_input");
        return response(
          { workspace: await workspaces.create({ name: body.name, reportingTimezone: body.reportingTimezone, actorUserId: actor.userId }) },
          201,
        );
      }
      if (request.method === "GET" && route === "numbers") return response({ numbers: await routing.listAvailableNumbers() });
      const match = route.match(/^([^/]+)(?:\/(.*))?$/);
      if (!match) return response({ error: "not_found" }, 404);
      const id = match[1];
      const subroute = match[2] ?? "";
      if (request.method === "GET" && subroute === "flow") return response(await routing.getFlow(id));
      if (request.method === "PUT" && subroute === "flow") {
        const body = await readBody(request);
        if (!("graph" in body)) throw new RoutingError("invalid_input");
        return response(await routing.saveDraft(id, body.graph, actor.userId));
      }
      if (request.method === "DELETE" && subroute === "flow") {
        await routing.discardDraft(id);
        return new Response(null, { status: 204 });
      }
      if (request.method === "PATCH" && subroute === "routing") {
        return response({ workspace: await routing.updateRoutingSettings(id, routingInput(await readBody(request)), actor.userId) });
      }
      if (request.method === "POST" && subroute === "flow/publish") return response({ workspace: await routing.publish(id, actor.userId) });
      const versionMatch = subroute.match(/^flow\/versions\/(\d+)$/);
      if (request.method === "GET" && versionMatch) return response(await routing.getVersion(id, Number(versionMatch[1])));
      if (request.method === "POST" && subroute === "activate") {
        const body = await readBody(request);
        if (typeof body.twilioNumberId !== "string") throw new RoutingError("invalid_input");
        return response({ workspace: await routing.activate(id, { twilioNumberId: body.twilioNumberId, actorUserId: actor.userId }) });
      }
      if (request.method === "PATCH" && subroute === "") {
        const body = await readBody(request);
        const input: { name?: string; reportingTimezone?: string } = {};
        if (body.name !== undefined) {
          if (typeof body.name !== "string") throw new WorkspacesError("invalid_input");
          input.name = body.name;
        }
        if (body.reportingTimezone !== undefined) {
          if (typeof body.reportingTimezone !== "string") throw new WorkspacesError("invalid_input");
          input.reportingTimezone = body.reportingTimezone;
        }
        return response({ workspace: await workspaces.update(id, input) });
      }
      if (request.method === "POST" && subroute === "replace-number") {
        const body = await readBody(request);
        if (typeof body.twilioNumberId !== "string") throw new RoutingError("invalid_input");
        return response({ workspace: await routing.replaceNumber(id, { twilioNumberId: body.twilioNumberId }) });
      }
      if (request.method === "POST" && subroute === "detach-number") return response({ workspace: await routing.detachNumber(id) });
      if (request.method === "POST" && subroute === "archive") return response({ workspace: await routing.archive(id) });
      if (request.method === "POST" && subroute === "restore") return response({ workspace: await workspaces.restore(id) });
      return response({ error: "not_found" }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
