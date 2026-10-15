/**
 * -------------------------------------------------------------------------
 * @file   workspace-policy.test.ts
 * @brief  Verifies Workspace lifecycle and setup policy.
 *
 * @description
 *  Covers Workspace name normalization, lifecycle transitions, and setup
 *  checklist semantics without database or provider dependencies.
 *
 * @remarks
 *  The policy remains pure so every Workspace route shares the same rules.
 *
 * @see
 *  data/workspace-policy.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import {
  decideArchive,
  decideRestore,
  describeSetupChecklist,
  initialWorkspaceState,
  normalizeWorkspaceName,
  workspaceStates,
} from "@/data/workspace-policy";

describe("Workspace policy", () => {
  it("normalizes names and enforces the length boundary", () => {
    expect(normalizeWorkspaceName("")).toBeNull();
    expect(normalizeWorkspaceName("   ")).toBeNull();
    expect(normalizeWorkspaceName("  Phoenix Office  ")).toBe("Phoenix Office");
    expect(normalizeWorkspaceName("a".repeat(81))).toBeNull();
    expect(normalizeWorkspaceName("a".repeat(80))).toBe("a".repeat(80));
  });

  it("starts every Workspace in Setup Required", () => {
    expect(workspaceStates).toEqual(["Setup Required", "Active", "Archived"]);
    expect(initialWorkspaceState).toBe("Setup Required");
  });

  it("allows only never-active Workspaces to archive", () => {
    expect(decideArchive("Setup Required")).toEqual({ allowed: true, nextState: "Archived" });
    expect(decideArchive("Archived")).toEqual({ allowed: false, reason: "state_unchanged" });
    expect(decideArchive("Active")).toEqual({ allowed: false, reason: "archive_unavailable" });
  });

  it("restores Archived Workspaces to Setup Required", () => {
    expect(decideRestore("Archived")).toEqual({ allowed: true, nextState: "Setup Required" });
    expect(decideRestore("Setup Required")).toEqual({ allowed: false, reason: "state_unchanged" });
    expect(decideRestore("Active")).toEqual({ allowed: false, reason: "state_unchanged" });
  });

  it("describes incomplete setup requirements", () => {
    expect(describeSetupChecklist({ destinationNumber: null })).toEqual([
      { label: "Tracking Number", complete: false },
      { label: "Destination Number", complete: false },
      { label: "Published Call Flow", complete: false },
    ]);
    expect(describeSetupChecklist({ destinationNumber: "+14155550100" })).toEqual([
      { label: "Tracking Number", complete: false },
      { label: "Destination Number", complete: true },
      { label: "Published Call Flow", complete: false },
    ]);
  });
});
