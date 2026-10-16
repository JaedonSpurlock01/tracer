/**
 * -------------------------------------------------------------------------
 * @file   workspace-list-query.test.ts
 * @brief  Verifies how the Workspaces page reads its list query from the URL.
 *
 * @description
 *  Checks that search, Workspace State filter, and page come from URL search
 *  params, and that missing or invalid values fall back to the first page of
 *  all Workspaces instead of failing the page.
 *
 * @remarks
 *  The JSON API stays strict about invalid states; this reader serves URLs a
 *  person may type or bookmark.
 *
 * @see
 *  data/workspaces.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { workspaceListQueryFromSearchParams } from "@/data/workspaces";

describe("Workspaces page list query", () => {
  it("reads search, Workspace State, and page", () => {
    expect(workspaceListQueryFromSearchParams({ search: " pho ", state: "Active", page: "3" })).toEqual({ search: "pho", state: "Active", page: 3 });
  });

  it("falls back to the first page of all Workspaces", () => {
    expect(workspaceListQueryFromSearchParams({})).toEqual({ search: "", state: "All", page: 1 });
    expect(workspaceListQueryFromSearchParams({ state: "Deleted", page: "-2" })).toEqual({ search: "", state: "All", page: 1 });
    expect(workspaceListQueryFromSearchParams({ search: ["a", "b"], page: "1.5" })).toEqual({ search: "a", state: "All", page: 1 });
  });
});
