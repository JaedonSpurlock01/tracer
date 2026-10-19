/**
 * -------------------------------------------------------------------------
 * @file   report-fixtures.ts
 * @brief  Shared Report history fixtures for the Reports component suites.
 *
 * @description
 *  Builds Report history items shaped like `GET /api/reports` responses,
 *  with JSON dates, and a routed fetch stub that answers by method and
 *  path so a suite can assert which Reports routes a view called.
 *
 * @remarks
 *  Only presentation is tested with these fixtures; the Reports API
 *  integration suite covers the server rules behind each field.
 *
 * @see
 *  tests/integration/reports-api.test.ts
 *  components/tracer/report-jobs.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { vi } from "vitest";

import type { ReportJobItem } from "@/components/tracer/report-jobs";

export function reportJob(overrides: Partial<ReportJobItem> = {}): ReportJobItem {
  return {
    id: "job-1",
    kind: "report",
    status: "Completed",
    failureReason: null,
    requestedAt: "2026-10-18T14:00:00.000Z",
    requestedBy: "Example Operator",
    scope: [{ id: "workspace-1", name: "Acme Plumbing" }],
    timeZone: "America/Chicago",
    parameters: { period: { kind: "previousWeek" }, window: { from: "2026-10-05", to: "2026-10-11" }, files: ["pdf", "csv"] },
    files: [
      { file: "pdf", downloadable: true, href: "/api/reports/job-1/files/pdf" },
      { file: "csv", downloadable: true, href: "/api/reports/job-1/files/csv" },
    ],
    expiresAt: "2026-10-25T14:05:00.000Z",
    canRegenerate: false,
    ...overrides,
  };
}

export function generatingJob(overrides: Partial<ReportJobItem> = {}): ReportJobItem {
  return reportJob({
    id: "job-2",
    status: "Generating",
    files: [{ file: "pdf", downloadable: false, href: null }],
    parameters: { period: { kind: "all" }, window: null, files: ["pdf"] },
    expiresAt: null,
    ...overrides,
  });
}

export function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export type Route = unknown | ((init: RequestInit | undefined) => Response);

export function routedFetch(routes: Record<string, Route>) {
  return vi.fn(async (input: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${input}`;
    const route = Object.keys(routes).find((candidate) => key === candidate || key.startsWith(`${candidate}?`));
    if (!route) return respond({ error: "not_found" }, 404);
    const value = routes[route];
    return typeof value === "function" ? (value as (init: RequestInit | undefined) => Response)(init) : respond(value);
  });
}

export function requestsTo(fetch: { mock: { calls: unknown[][] } }, method: string, path: string): RequestInit[] {
  return fetch.mock.calls
    .filter(([url, init]) => String(url) === path && ((init as RequestInit | undefined)?.method ?? "GET") === method)
    .map(([, init]) => (init ?? {}) as RequestInit);
}

export function stubBrowser() {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(Element.prototype, "getAnimations", { value: () => [], configurable: true });
}
