/**
 * -------------------------------------------------------------------------
 * @file   call-source.ts
 * @brief  Carries the list a Call was opened from into Call Detail and back.
 *
 * @description
 *  A Call opened from global Calls, Workspace Calls, or Activity links to Call Detail
 *  with that list's URL in one `back` param. Call Detail reads it back as
 *  the source scope and the Calls query, which gives its back link and the
 *  ordered list its previous and next Call walk. The back link is rebuilt
 *  from the parsed query, so it keeps the page, sort, search, flat filters,
 *  and `adv` tree and nothing else. Without a valid source, Call Detail
 *  links back to Workspace Calls and walks that Workspace's Calls in the
 *  default Started descending order. Previous and next Call links go to
 *  each neighbor's own Workspace route and carry the same source.
 *
 * @remarks
 *  The `back` value is user input. It is accepted only as a same-origin
 *  path that is exactly `/calls` or `/workspaces/{workspaceId}/calls` for
 *  the Call's own Workspace, or exactly `/activity`, after URL normalization, so an external URL,
 *  a protocol-relative or backslash path, another Workspace, dot segments,
 *  or encoded separators fall back to the default back link and never
 *  become an open redirect. An Activity source keeps only Activity's search
 *  and filters, and walks every readable Call Started descending with the
 *  caller-only search Activity uses, so previous and next Call continue
 *  past the loaded Activity window. This module has no server imports so the Calls
 *  view can share it.
 *
 * @see
 *  data/call-list-query.ts
 *  app/(app)/workspaces/[id]/calls/[callId]/page.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { activityFiltersFromSearchParams, activitySearchParams } from "@/data/activity-query";
import { callListQueryFromSearchParams, callListSearchParams, defaultCallSort, emptyCallFilters, type CallListQuery } from "@/data/call-list-query";

export interface CallSource {
  scope: "global" | "workspace" | "activity";
  query: CallListQuery;
  href: string;
}

const origin = "http://tracer.invalid";

function listPath(scope: CallSource["scope"], workspaceId: string): string {
  if (scope === "activity") return "/activity";
  return scope === "global" ? "/calls" : `/workspaces/${workspaceId}/calls`;
}

export function callSourceFromBack(back: string | string[] | undefined, workspaceId: string): CallSource | null {
  if (typeof back !== "string" || !back.startsWith("/") || back.startsWith("//") || back.startsWith("/\\")) return null;
  let url: URL;
  try {
    url = new URL(back, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const scope = (["global", "workspace", "activity"] as const).find((candidate) => url.pathname === listPath(candidate, workspaceId));
  if (!scope) return null;
  const query = scope === "activity" ? { page: 1, sort: defaultCallSort, filters: activityFiltersFromSearchParams(url.searchParams) } : callListQueryFromSearchParams(url.searchParams);
  const search = (scope === "activity" ? activitySearchParams(query.filters) : callListSearchParams(query)).toString();
  return { scope, query, href: `${url.pathname}${search ? `?${search}` : ""}` };
}

export function callDetailHref(call: { id: string; workspaceId: string }, back: string | null, options: { play?: boolean } = {}): string {
  const params = new URLSearchParams();
  if (back) params.set("back", back);
  if (options.play) params.set("play", "1");
  const search = params.toString();
  return `/workspaces/${call.workspaceId}/calls/${call.id}${search ? `?${search}` : ""}`;
}

export function callSourceListQuery(source: CallSource | null, workspaceId: string): CallListQuery & { workspaceId?: string; callerSearchOnly?: boolean } {
  if (!source) return { page: 1, sort: defaultCallSort, filters: emptyCallFilters, workspaceId };
  if (source.scope === "activity") return { ...source.query, workspaceId: undefined, callerSearchOnly: true };
  return { ...source.query, workspaceId: source.scope === "workspace" ? workspaceId : undefined };
}

type Neighbor = { id: string; workspaceId: string } | null;

export function callDetailNavigation(source: CallSource | null, workspaceId: string, neighbors: { previous: Neighbor; next: Neighbor } | null) {
  const back = source?.href ?? null;
  const step = (call: Neighbor | undefined) => (call ? callDetailHref(call, back) : null);
  return { back: back ?? listPath("workspace", workspaceId), previous: step(neighbors?.previous), next: step(neighbors?.next) };
}
