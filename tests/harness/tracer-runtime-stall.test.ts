/**
 * -------------------------------------------------------------------------
 * @file   tracer-runtime-stall.test.ts
 * @brief  Tests that an open request runtime reports a stall while it is stuck.
 *
 * @description
 *  Opens the real request runtime with stand-in Cloudflare bindings and
 *  checks that a request still open after 8 seconds writes a
 *  tracer.request.stalled line with its Cloudflare ray, and that closing
 *  the runtime stops further stall lines.
 *
 * @see
 *  data/tracer-runtime.ts
 *  data/request-log.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "cf-ray": "ray-7" }) }));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({
    env: {
      HYPERDRIVE: { connectionString: "postgresql://tracer_app:unused@127.0.0.1:1/tracer" },
      EMAIL: { send: async () => ({ messageId: "unused" }) },
      AUTH_EMAIL_FROM: "tracer@example.com",
      BETTER_AUTH_URL: "https://tracer.example.com",
      BETTER_AUTH_SECRET: "a-secret-that-is-long-enough-for-better-auth",
    },
    ctx: { waitUntil: () => undefined },
  }),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("writes a tracer.request.stalled line with the ray while the request is open and stops once it closes", async () => {
  const { openTracerRuntime } = await import("@/data/tracer-runtime");
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });

  const scope = await openTracerRuntime();
  vi.advanceTimersByTime(8_000);

  const stalled = error.mock.calls.map(([line]) => JSON.parse(String(line))).filter((line) => line.event === "tracer.request.stalled");
  expect(stalled).toEqual([expect.objectContaining({ ray: "ray-7", elapsedMs: 8_000, dbSocketsOpened: 0, dbPending: [] })]);
  scope.close("ray-7");
  vi.advanceTimersByTime(60_000);
  expect(error.mock.calls.filter(([line]) => String(line).includes("tracer.request.stalled"))).toHaveLength(1);
});
