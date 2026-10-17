/**
 * -------------------------------------------------------------------------
 * @file   setup.ts
 * @brief  Configures component test matchers and the Client Cache boundary.
 *
 * @description
 *  Adds DOM assertions to Vitest for React component behavior tests and
 *  replaces the Client Cache Server Action, which needs a Next.js request.
 *
 * @remarks
 *  The setup remains browser-independent through jsdom. A test that checks
 *  cache clearing declares its own mock of the same module.
 *
 * @see
 *  vitest.config.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("@/data/client-cache", () => ({ refreshClientCache: vi.fn(async () => undefined) }));
