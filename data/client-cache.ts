/**
 * -------------------------------------------------------------------------
 * @file   client-cache.ts
 * @brief  Clears the browser's Client Cache after a successful mutation.
 *
 * @description
 *  A Server Action that refreshes the client router so every prefetched or
 *  visited page is fetched again on its next visit instead of showing data
 *  from before the mutation.
 *
 * @remarks
 *  Tracer mutates through Route Handlers, which cannot clear the Client
 *  Cache. Only a revalidation call inside a Server Action clears the whole
 *  cache, and router.refresh clears only the current route, so the client
 *  calls this Action after each successful write. It reads and changes no
 *  data, so it needs no authorization of its own.
 *
 * @see
 *  components/tracer/mutation-fetch.ts
 *  node_modules/next/dist/docs/01-app/03-api-reference/04-functions/refresh.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use server";

import { refresh } from "next/cache";

export async function refreshClientCache(): Promise<void> {
  refresh();
}
