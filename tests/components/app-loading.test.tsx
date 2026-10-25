/**
 * -------------------------------------------------------------------------
 * @file   app-loading.test.tsx
 * @brief  Verifies the shell and Workspace loading boundaries announce themselves.
 *
 * @description
 *  A navigation paints these boundaries at once while the page streams in,
 *  so each must name what is loading for assistive technology and mark the
 *  region busy without rendering any data.
 *
 * @see
 *  components/tracer/page-loading.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import AppLoading from "@/app/(app)/(everyone)/loading";
import OperatorLoading from "@/app/(app)/(operator)/loading";
import WorkspaceLoading from "@/app/(app)/workspaces/[id]/(viewer)/loading";
import WorkspaceOperatorLoading from "@/app/(app)/workspaces/[id]/(operator)/loading";

afterEach(cleanup);

it("announces the page loading state and marks the region busy", () => {
  const { container } = render(<AppLoading />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading page");
  expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
});

it("announces the Workspace loading state and marks the region busy", () => {
  const { container } = render(<WorkspaceLoading />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading Workspace");
  expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
});

it("gives the Operator-only groups the same boundaries", () => {
  expect(OperatorLoading).toBe(AppLoading);
  expect(WorkspaceOperatorLoading).toBe(WorkspaceLoading);
});
