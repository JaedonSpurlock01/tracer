/**
 * -------------------------------------------------------------------------
 * @file   eslint.config.mjs
 * @brief  Defines lint rules for the Tracer application.
 *
 * @description
 *  Applies the Next.js core, accessibility, and TypeScript rule sets.
 *
 * @remarks
 *  Generated build and test artifacts are excluded from linting. The ReUI
 *  Filters and Cascader sources are kept exactly as the registry ships
 *  them, so the two React Compiler rules they intentionally break are
 *  turned off for those directories only.
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
  {
    files: ["components/reui/filters/**", "components/reui/cascader/**"],
    rules: { "react-hooks/set-state-in-effect": "off", "react-hooks/refs": "off" },
  },
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
