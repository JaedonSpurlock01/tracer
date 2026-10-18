/**
 * -------------------------------------------------------------------------
 * @file   activity-query.ts
 * @brief  Parses and writes the Activity filters and Load more cursors.
 *
 * @description
 *  Activity reuses the Calls filter query and its URL keys, limited to the
 *  fields Activity offers: the caller search, the Started date range,
 *  Workspaces, Call Outcomes, effective Lead classifications, and the
 *  processing state, which is the Calls analysis status. A cursor names one
 *  Call by its exact start time and id, so Load more asks for the Calls
 *  before the oldest loaded one and a refresh asks for every Call through
 *  it.
 *
 * @remarks
 *  Every other Calls filter, the advanced tree, and the page and sort keys
 *  are dropped, so Activity links stay plain and the server reads exactly
 *  what the Activity toolbar can write. Cursor times keep microseconds
 *  because Postgres stores them, and a millisecond cursor could skip a
 *  Call started within the same millisecond. This module has no server
 *  imports so the Activity view can share it.
 *
 * @see
 *  data/call-list-query.ts
 *  data/activity.ts
 *  components/tracer/activity-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { callListQueryFromSearchParams, callListSearchParams, defaultCallSort, emptyCallFilters, type CallFilters } from "@/data/call-list-query";

export interface ActivityCursor {
  startedAt: string;
  id: string;
}

type SearchParams = URLSearchParams | Readonly<Record<string, string | string[] | undefined>>;

export function activityFilters(filters: CallFilters): CallFilters {
  return {
    ...emptyCallFilters,
    search: filters.search,
    startedFrom: filters.startedFrom,
    startedTo: filters.startedTo,
    workspaceIds: filters.workspaceIds,
    outcomes: filters.outcomes,
    leadClassifications: filters.leadClassifications,
    analysisStatus: filters.analysisStatus,
  };
}

export function activityFiltersFromSearchParams(params: SearchParams): CallFilters {
  return activityFilters(callListQueryFromSearchParams(params).filters);
}

export function activitySearchParams(filters: CallFilters): URLSearchParams {
  return callListSearchParams({ page: 1, sort: defaultCallSort, filters: activityFilters(filters) });
}

export function formatActivityCursor(cursor: ActivityCursor): string {
  return `${cursor.startedAt},${cursor.id}`;
}

export function parseActivityCursor(value: string | null | undefined): ActivityCursor | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z),(.{1,128})$/.exec(value ?? "");
  if (!match || Number.isNaN(new Date(match[1]).getTime())) return null;
  return { startedAt: match[1], id: match[2] };
}
