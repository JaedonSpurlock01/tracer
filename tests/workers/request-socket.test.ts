/**
 * -------------------------------------------------------------------------
 * @file   request-socket.test.ts
 * @brief  Proves the Worker can load the Cloudflare sockets module.
 *
 * @description
 *  Runs inside workerd and asks the request socket's loader for the
 *  Cloudflare connect function. The module name is built at run time so
 *  the bundlers leave it alone; this test is the check that the name
 *  still resolves where it matters.
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { expect, it } from "vitest";

import { isCloudflareWorker, loadCloudflareSockets } from "../../data/request-socket";

it("loads the Cloudflare sockets module inside a Worker", async () => {
  expect(isCloudflareWorker()).toBe(true);
  const connect = await loadCloudflareSockets();
  expect(connect).toBeTypeOf("function");
});
