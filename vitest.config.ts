/**
 * -------------------------------------------------------------------------
 * @file   vitest.config.ts
 * @brief  Defines Tracer's fast Vitest projects.
 *
 * @description
 *  Separates domain, contract, task, component, harness, and smoke tests.
 *
 * @remarks
 *  Empty projects pass only until their first roadmap behavior is introduced.
 *
 * @see
 *  README.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

const emptyProject = {
  passWithNoTests: true,
};

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          ...emptyProject,
          name: "domain",
          include: ["tests/domain/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          ...emptyProject,
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          ...emptyProject,
          name: "contracts",
          include: ["tests/contracts/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          ...emptyProject,
          name: "tasks",
          include: ["tests/tasks/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          ...emptyProject,
          name: "components",
          include: ["tests/components/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./tests/components/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "harness",
          include: ["tests/harness/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          ...emptyProject,
          name: "smoke",
          include: ["tests/smoke/**/*.test.ts"],
        },
      },
    ],
  },
});
