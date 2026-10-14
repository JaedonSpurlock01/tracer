/**
 * -------------------------------------------------------------------------
 * @file   actor.ts
 * @brief  Resolves the authenticated actor for shell server components.
 *
 * @description
 *  Reads request headers and combines them with the request-scoped Tracer
 *  runtime to resolve the current Organization actor.
 *
 * @remarks
 *  Next request headers stay in the app layer so Node-focused data tests do
 *  not load next/headers transitively.
 *
 * @see
 *  data/authorization.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { headers } from "next/headers";

import { resolveActor, type Actor } from "@/data/authorization";
import { withTracerRuntime } from "@/data/tracer-runtime";

export async function resolveRequestActor(): Promise<Actor | null> {
  const requestHeaders = await headers();
  return withTracerRuntime(({ auth, database }) => resolveActor(auth, database, new Headers(requestHeaders)));
}
