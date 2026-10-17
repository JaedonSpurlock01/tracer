/**
 * -------------------------------------------------------------------------
 * @file   mutation-fetch.ts
 * @brief  Sends a write request and clears stale prefetched pages on success.
 *
 * @description
 *  Wraps fetch for requests that change data. When the response succeeds it
 *  asks the server to clear the browser's Client Cache, so navigating to any
 *  page shows the change without a reload.
 *
 * @remarks
 *  Pages render their first data on the server and their links prefetch the
 *  full route, which the Client Cache can keep for up to five minutes.
 *  Clearing it after every successful write keeps those pages correct while
 *  keeping prefetching. A failed refresh never turns a successful write into
 *  a reported failure; the page is then corrected on reload as before.
 *
 * @see
 *  data/client-cache.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { refreshClientCache } from "@/data/client-cache";

export async function mutationFetch(input: string, init: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.ok) await refreshClientCache().catch(() => undefined);
  return response;
}
