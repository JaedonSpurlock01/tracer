/**
 * -------------------------------------------------------------------------
 * @file   request-runtime.test.ts
 * @brief  Proves one navigation opens one Tracer runtime and closes it once.
 *
 * @description
 *  The actor, the app layout, a Workspace layout, and the page each ask for
 *  the runtime while one page renders. They must share one pool instead of
 *  each opening a connection, and the pool must close once, after the
 *  response, with one tracer.request line covering the whole navigation.
 *
 * @remarks
 *  React's cache and Next's after are framework seams, so they are replaced
 *  with request-scoped stand-ins here; the Cloudflare runtime opener is
 *  replaced because it needs Worker bindings.
 *
 * @see
 *  app/(app)/runtime.ts
 *  data/tracer-runtime.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { afterEach, expect, it, vi } from "vitest";

const afterCallbacks: Array<() => void | Promise<void>> = [];
const opened: Array<{ runtime: { pool: unknown }; close: ReturnType<typeof vi.fn>; recordFailure: ReturnType<typeof vi.fn> }> = [];

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T extends (...args: never[]) => unknown>(fn: T): T => {
    let memo: { value: unknown } | undefined;
    return ((...args: never[]) => (memo ??= { value: fn(...args) }).value) as T;
  } };
});
vi.mock("next/server", () => ({ after: (callback: () => void | Promise<void>) => afterCallbacks.push(callback) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "cf-ray": "ray-9" }) }));
vi.mock("@/data/tracer-runtime", () => ({
  openTracerRuntime: vi.fn(async () => {
    const scope = { runtime: { pool: { id: opened.length + 1 } }, close: vi.fn(), recordFailure: vi.fn() };
    opened.push(scope);
    return scope;
  }),
}));

afterEach(() => {
  afterCallbacks.length = 0;
  opened.length = 0;
  vi.resetModules();
});

it("shares one runtime across the actor, layouts, and page and closes it once after the response", async () => {
  const { withRequestRuntime } = await import("@/app/(app)/runtime");

  const pools: unknown[] = await Promise.all([
    withRequestRuntime(async ({ pool }) => pool),
    withRequestRuntime(async ({ pool }) => pool),
    withRequestRuntime(async ({ pool }) => pool),
  ]);

  expect(opened).toHaveLength(1);
  expect(pools.every((pool) => pool === opened[0].runtime.pool)).toBe(true);
  expect(opened[0].close).not.toHaveBeenCalled();
  for (const callback of afterCallbacks) await callback();
  expect(opened[0].close).toHaveBeenCalledTimes(1);
  expect(opened[0].close).toHaveBeenCalledWith("ray-9");
});

it("records a failure on the shared runtime without closing it early", async () => {
  const { withRequestRuntime } = await import("@/app/(app)/runtime");
  const failure = new Error("boom");

  await expect(withRequestRuntime(async () => { throw failure; })).rejects.toBe(failure);

  expect(opened[0].recordFailure).toHaveBeenCalledWith(failure);
  expect(opened[0].close).not.toHaveBeenCalled();
});
