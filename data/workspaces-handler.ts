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
 *  and purges a Call's Recording media for an Operator. Reads the linked
 *  Site with its traffic summary for any reader of the Workspace, streams
 *  the Site's newest preview from the R2 binding under the same Workspace
 *  authorization, and lets an Operator pick, link, replace, and detach a
 *  Site and force a preview capture with Refresh Preview. Reads the Site's
 *  Service Area, Keywords, and Search read model for any reader of the
 *  Workspace, and lets an Operator set the Service Area and add, reweight,
 *  and remove Keywords. Lets an Operator record the Site's Domain renewal
 *  and create, edit, and end the Workspace's Deal, and read and save the
 *  Workspace's Business with a city lookup through the Places client;
 *  Client Viewers get 403 on every Deal, Business, Places, and Domain
 *  route. Form Submission routes list a Workspace's
 *  submissions for any reader and reserve approve, reject, resend, review,
 *  and the forwarding recipients for Operators.
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
import { BusinessError, createBusinesses } from "@/data/business";
import { createCallDetails } from "@/data/call-details";
import { createDeals, DealsError } from "@/data/deals";
import { createFormSubmissions, FormSubmissionsError } from "@/data/form-submissions";
import type { CloudflareClient } from "@/data/cloudflare-client";
import type { Integrations } from "@/data/integrations";
import { IntegrationsError } from "@/data/integrations-error";
import { parseLeadReviewInput } from "@/data/lead-classification";
import { PlacesClientError, type PlacesClient } from "@/data/places-client";
import { saveLeadReview } from "@/data/lead-reviews";
import { purgeCallMedia } from "@/data/media-purge";
import type { RecordingProcessing } from "@/data/recording";
import { recordingAudioResponse } from "@/data/recording-audio";
import { findAvailableRecordingMedia, recordingMp3Response, recordingPeaksResponse, type RecordingMediaBucket } from "@/data/recording-media";
import { analyticsRangeFromSearchParams } from "@/data/analytics-range";
import { captureSitePreview, sitePreviewResponse, type SitePreviewBucket } from "@/data/site-preview";
import { createDataForSeoConnection } from "@/data/dataforseo-connection";
import type { DataForSeoClient } from "@/data/dataforseo-client";
import { createSearchLocations } from "@/data/search-locations";
import { createKeywordDiscovery, KeywordDiscoveryError } from "@/data/keyword-discovery";
import { OpenAIError, type StructuredResponder } from "@/data/openai-client";
import { createSiteKeywords, SiteKeywordsError } from "@/data/site-keywords";
import { siteSearch } from "@/data/site-search";
import { createSites, siteResponseForActor, SitesError, summaryResponseForActor } from "@/data/sites";
import { createWorkspaceRouting, RoutingError, type RoutingSettingsInput } from "@/data/workspace-routing";
import { createWorkspaces, WorkspacesError, type Workspaces } from "@/data/workspaces";
import type { TwilioClient, TwilioRecordingMedia } from "@/data/twilio-client";
import { schema } from "@/data/schema";
import type { TracerAuth } from "@/data/tracer-auth";
import type { TransactionalEmail } from "@/data/transactional-email";
import { canManageWorkspaces, createReadableWorkspaces } from "@/data/workspace-authorization";
import { workspaceStates, type WorkspaceState } from "@/data/workspace-policy";

/** Service Areas are United States locations until a Site outside it exists. */
const serviceAreaCountryIso = "us";

export interface WorkspacesHandlerOptions {
  auth: TracerAuth;
  database: NodePgDatabase<typeof schema>;
  pool: Pool;
  /** Forwards Form Submissions; without it every forward records Forward failed with Resend. */
  email?: TransactionalEmail;
  /** Looks up cities for the Business form; without it the lookup answers 503. */
  places?: PlacesClient;
  twilio: TwilioClient;
  integrations: (organizationId: string) => Integrations;
  baseURL: string;
  recordingBucket?: RecordingMediaBucket;
  sitePreviews?: SitePreviewBucket;
  cloudflare?: CloudflareClient;
  /** Serves the Service Area picker's location search; without it the search answers 503. */
  dataforseo?: DataForSeoClient;
  /** Proposes phrases for Suggest Keywords; without it the suggestion answers 503. */
  openai?: StructuredResponder;
  masterKey?: string;
  twilioMedia?: TwilioRecordingMedia;
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
  if (error instanceof PlacesClientError) return response({ error: "provider_unavailable" }, 502);
  if (error instanceof OpenAIError) return response({ error: "provider_unavailable", detail: error.message }, 502);
  if (error instanceof KeywordDiscoveryError) {
    return response({ error: error.code }, error.code === "not_found" ? 404 : error.code === "invalid_output" ? 502 : 409);
  }
  if (error instanceof IntegrationsError) {
    const status = error.code === "master_key_missing" ? 503 : error.code === "not_connected" ? 404 : 502;
    return response(error.detail ? { error: error.code, detail: error.detail } : { error: error.code }, status);
  }
  if (error instanceof WorkspacesError || error instanceof SitesError || error instanceof SiteKeywordsError || error instanceof DealsError || error instanceof BusinessError || error instanceof FormSubmissionsError) {
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
      const previewMatch = route.match(/^([^/]+)\/site\/preview$/);
      if (request.method === "GET" && previewMatch) {
        const workspace = await createReadableWorkspaces(options.pool, actor).find(previewMatch[1]);
        if (!workspace) throw new WorkspacesError("not_found");
        const site = await createSites(options.pool, actor).findLinked(workspace.id);
        const served = site?.latestPreview && options.sitePreviews ? await sitePreviewResponse(options.sitePreviews, site.latestPreview.objectKey) : null;
        if (!served) throw new WorkspacesError("not_found");
        return served;
      }
      const siteReadMatch = route.match(/^([^/]+)\/site\/(keywords|search)$/);
      if (request.method === "GET" && siteReadMatch) {
        const workspace = await createReadableWorkspaces(options.pool, actor).find(siteReadMatch[1]);
        if (!workspace) throw new WorkspacesError("not_found");
        const site = await createSites(options.pool, actor).findLinked(workspace.id);
        if (!site) throw new WorkspacesError("not_found");
        if (siteReadMatch[2] === "keywords") return response(await createSiteKeywords(options.pool, actor).list(site.id));
        const search = await siteSearch(options.pool, site.id, workspace.reportingTimezone);
        if (!search) throw new WorkspacesError("not_found");
        return response(search);
      }
      const siteMatch = route.match(/^([^/]+)\/site$/);
      if (request.method === "GET" && siteMatch) {
        const workspace = await createReadableWorkspaces(options.pool, actor).find(siteMatch[1]);
        if (!workspace) throw new WorkspacesError("not_found");
        const sites = createSites(options.pool, actor);
        const site = await sites.findLinked(workspace.id);
        if (!site) return response({ site: null, summary: null });
        const summary = await sites.summary(site.id, analyticsRangeFromSearchParams(new URL(request.url).searchParams), workspace.reportingTimezone);
        return response({ site: siteResponseForActor(actor, site), summary: summaryResponseForActor(actor, summary) });
      }
      if (request.method === "GET" && (route === "" || (route !== "numbers" && route !== "sites" && route !== "places" && /^[^/]+$/.test(route)))) {
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
      const formsListMatch = route.match(/^([^/]+)\/forms$/);
      if (request.method === "GET" && formsListMatch) {
        const list = await createFormSubmissions(options.pool, actor, options.email ?? { async send() { throw new Error("Email Service is not configured"); } }).list(formsListMatch[1]);
        if (!list) throw new WorkspacesError("not_found");
        return response(list);
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
        const purged = await purgeCallMedia({ pool: options.pool, objects: options.recordingBucket, twilio: options.twilioMedia, masterKey: options.masterKey }, actor, purgeMatch[1], purgeMatch[2], new Date());
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
      if (request.method === "GET" && route === "places") {
        if (!options.places) return response({ error: "places_unavailable" }, 503);
        return response({ places: await options.places.searchCities(new URL(request.url).searchParams.get("q") ?? "") });
      }
      if (request.method === "GET" && route === "sites") {
        const url = new URL(request.url);
        return response(await createSites(options.pool, actor).listForPicker({
          search: url.searchParams.get("search") ?? undefined,
          page: parsePositiveInteger(url.searchParams.get("page")),
          pageSize: parsePositiveInteger(url.searchParams.get("pageSize")),
        }));
      }
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
      if (request.method === "POST" && (subroute === "site/link" || subroute === "site/replace")) {
        const body = await readBody(request);
        if (typeof body.siteId !== "string") throw new SitesError("invalid_input");
        const sites = createSites(options.pool, actor);
        const site = subroute === "site/link" ? await sites.link(id, body.siteId, actor.userId) : await sites.replace(id, body.siteId, actor.userId);
        return response({ site: siteResponseForActor(actor, site) });
      }
      if (request.method === "POST" && subroute === "site/detach") {
        await createSites(options.pool, actor).detach(id);
        return response({ detached: true });
      }
      if (request.method === "GET" && subroute === "site/locations") {
        if (!canManageWorkspaces(actor)) throw new AuthorizationError(403);
        const linked = await createSites(options.pool, actor).findLinked(id);
        if (!linked) throw new WorkspacesError("not_found");
        if (!options.dataforseo) return response({ error: "provider_unavailable" }, 503);
        const query = new URL(request.url).searchParams.get("q") ?? "";
        const locations = createSearchLocations(options.pool);
        const dataforseo = options.dataforseo;
        await createDataForSeoConnection({ pool: options.pool, organizationId: actor.organizationId, dataforseo, masterKey: options.masterKey })
          .withDataForSeoCredential((credential) => locations.ensure(serviceAreaCountryIso, dataforseo, credential, new Date()));
        return response({ locations: await locations.search(serviceAreaCountryIso, query) });
      }
      if (subroute === "site/keywords" || subroute === "site/service-area" || subroute.startsWith("site/keywords/")) {
        const linked = await createSites(options.pool, actor).findLinked(id);
        if (!linked) throw new WorkspacesError("not_found");
        const keywords = createSiteKeywords(options.pool, actor);
        if (request.method === "POST" && subroute === "site/keywords/suggest") {
          if (!canManageWorkspaces(actor)) throw new AuthorizationError(403);
          if (!options.openai || !options.dataforseo) return response({ error: "provider_unavailable" }, 503);
          const body = request.headers.get("content-type")?.includes("json") && request.headers.get("content-length") !== "0" ? await request.json().catch(() => ({})) as Record<string, unknown> : {};
          const discovery = createKeywordDiscovery({ pool: options.pool, actor, responder: options.openai, dataforseo: options.dataforseo, masterKey: options.masterKey });
          return response({ suggestions: await discovery.suggest(linked.id, { refresh: body.refresh === true }) });
        }
        if (request.method === "POST" && subroute === "site/keywords") {
          const body = await readBody(request);
          return response({ keyword: await keywords.add(linked.id, { phrase: body.phrase, weight: body.weight }) }, 201);
        }
        if (request.method === "PUT" && subroute === "site/service-area") {
          const body = await readBody(request);
          return response({ serviceArea: await keywords.setServiceArea(linked.id, { locationCode: body.locationCode, locationName: body.locationName }) });
        }
        const keywordMatch = subroute.match(/^site\/keywords\/([^/]+)$/);
        if (request.method === "PATCH" && keywordMatch) {
          const body = await readBody(request);
          return response({ keyword: await keywords.update(linked.id, keywordMatch[1], { weight: body.weight }) });
        }
        if (request.method === "DELETE" && keywordMatch) {
          await keywords.remove(linked.id, keywordMatch[1]);
          return new Response(null, { status: 204 });
        }
      }
      if (request.method === "PUT" && subroute === "site/domain") {
        const body = await readBody(request);
        return response({ domain: await createSites(options.pool, actor).setDomainRenewal(id, { registrar: body.registrar, renewalCents: body.renewalCents, renewsOn: body.renewsOn }) });
      }
      if (subroute === "forms" || subroute.startsWith("forms/")) {
        const forms = createFormSubmissions(options.pool, actor, options.email ?? { async send() { throw new Error("Email Service is not configured"); } });
        if (request.method === "PUT" && subroute === "forms/forwarding") {
          const body = await readBody(request);
          return response({ forwardTo: await forms.setForwarding(id, body.emails) });
        }
        const actionMatch = subroute.match(/^forms\/([^/]+)\/(approve|reject|resend|review)$/);
        if (actionMatch) {
          const [, submissionId, action] = actionMatch;
          if (request.method === "POST" && action === "approve") return response({ submission: await forms.approve(id, submissionId) });
          if (request.method === "POST" && action === "reject") return response({ submission: await forms.reject(id, submissionId) });
          if (request.method === "POST" && action === "resend") return response({ submission: await forms.resend(id, submissionId) });
          if (request.method === "PUT" && action === "review") {
            const body = await readBody(request);
            return response({ submission: await forms.review(id, submissionId, { classification: body.classification, note: body.note }) });
          }
          if (request.method === "DELETE" && action === "review") return response({ submission: await forms.clearReview(id, submissionId) });
        }
      }
      if (subroute === "business") {
        const businesses = createBusinesses(options.pool, actor);
        if (request.method === "GET") return response({ business: await businesses.find(id) });
        if (request.method === "PUT") {
          const body = await readBody(request);
          return response({ business: await businesses.save(id, body) });
        }
      }
      if (subroute === "deal" || subroute.startsWith("deal/")) {
        const deals = createDeals(options.pool, actor);
        if (request.method === "GET" && subroute === "deal") {
          const [deal, history] = await Promise.all([deals.current(id), deals.history(id)]);
          return response({ deal, history });
        }
        if (request.method === "POST" && subroute === "deal") {
          const body = await readBody(request);
          return response({ deal: await deals.create({ workspaceId: id, kind: body.kind, amountCents: body.amountCents, startedOn: body.startedOn }) }, 201);
        }
        const dealMatch = subroute.match(/^deal\/([^/]+)(\/end)?$/);
        if (request.method === "PATCH" && dealMatch && !dealMatch[2]) {
          const body = await readBody(request);
          return response({ deal: await deals.update(dealMatch[1], { workspaceId: id, kind: body.kind, amountCents: body.amountCents, startedOn: body.startedOn }) });
        }
        if (request.method === "POST" && dealMatch?.[2]) {
          const body = await readBody(request);
          return response({ deal: await deals.end(dealMatch[1], { workspaceId: id, endedOn: body.endedOn }) });
        }
      }
      if (request.method === "POST" && subroute === "site/preview/refresh") {
        const sites = createSites(options.pool, actor);
        const linked = await sites.findLinked(id);
        if (!linked) throw new WorkspacesError("not_found");
        if (!options.cloudflare || !options.sitePreviews) return response({ error: "preview_unavailable" }, 503);
        await captureSitePreview({ pool: options.pool, cloudflare: options.cloudflare, objects: options.sitePreviews, masterKey: options.masterKey, siteId: linked.id, now: new Date(), force: true });
        const refreshed = await sites.findLinked(id);
        if (!refreshed) throw new WorkspacesError("not_found");
        return response({ site: siteResponseForActor(actor, refreshed) });
      }
      if (request.method === "POST" && subroute === "archive") return response({ workspace: await routing.archive(id) });
      if (request.method === "POST" && subroute === "restore") return response({ workspace: await workspaces.restore(id) });
      return response({ error: "not_found" }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
