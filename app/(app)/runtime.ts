/**
 * -------------------------------------------------------------------------
 * @file   runtime.ts
 * @brief  Shares one Tracer runtime across everything one navigation renders.
 *
 * @description
 *  The actor, the app layout, a Workspace layout, and the page all need the
 *  runtime while one page renders. The first caller opens it, every later
 *  caller in the same request gets the same pool, and the pool closes once
 *  after the response with one tracer.request line for the navigation.
 *
 * @remarks
 *  React's cache scopes the open runtime to the request; Next's after runs
 *  the close once the response is sent. The Cloudflare ray is read before
 *  after is scheduled because request APIs are not available inside it.
 *  A redirect or notFound thrown by a page is Next control flow, not a
 *  failure, so it is not recorded on the log line. Route handlers keep
 *  withTracerRuntime, which opens and closes per call.
 *
 * @see
 *  data/tracer-runtime.ts
 *  app/(app)/actor.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { headers } from "next/headers";
import { after } from "next/server";
import { cache } from "react";

import { openTracerRuntime, type TracerRuntime } from "@/data/tracer-runtime";

const openRequestRuntime = cache(async () => {
  const ray = (await headers()).get("cf-ray");
  const scope = await openTracerRuntime();
  after(() => scope.close(ray));
  return scope;
});

function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}

export async function withRequestRuntime<T>(run: (runtime: TracerRuntime) => Promise<T>): Promise<T> {
  const scope = await openRequestRuntime();
  try {
    return await run(scope.runtime);
  } catch (error) {
    if (!isNextControlFlow(error)) scope.recordFailure(error);
    throw error;
  }
}
