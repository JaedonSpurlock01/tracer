/**
 * -------------------------------------------------------------------------
 * @file   setup.ts
 * @brief  Configures component test matchers.
 *
 * @description
 *  Adds DOM assertions to Vitest for React component behavior tests.
 *
 * @remarks
 *  The setup remains browser-independent through jsdom.
 *
 * @see
 *  vitest.config.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import "@testing-library/jest-dom/vitest";
