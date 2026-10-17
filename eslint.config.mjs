/**
 * -------------------------------------------------------------------------
 * @file   eslint.config.mjs
 * @brief  Defines lint rules for the Tracer application.
 *
 * @description
 *  Applies the Next.js core, accessibility, and TypeScript rule sets.
 *
 * @remarks
 *  Generated build and test artifacts are excluded from linting.
 *
 * @see
 *  package.json
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    ".open-next/**",
    ".trigger/**",
    "cloudflare-env.d.ts",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
