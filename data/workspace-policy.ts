/**
 * -------------------------------------------------------------------------
 * @file   workspace-policy.ts
 * @brief  Defines pure Workspace lifecycle and setup policy.
 *
 * @description
 *  Normalizes Workspace names, validates lifecycle transitions, and describes
 *  requirements that remain before a Workspace can be activated.
 *
 * @remarks
 *  Provider integration is intentionally outside this policy for M6.
 *
 * @see
 *  CONTEXT.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export type WorkspaceState = "Setup Required" | "Active" | "Archived";

export const workspaceStates: readonly WorkspaceState[] = ["Setup Required", "Active", "Archived"];
export const initialWorkspaceState: WorkspaceState = "Setup Required";

export function normalizeWorkspaceName(value: string): string | null {
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= 80 ? normalized : null;
}

export type WorkspaceTransitionDecision =
  | { allowed: true; nextState: WorkspaceState }
  | { allowed: false; reason: "state_unchanged" | "archive_unavailable" };

export function decideArchive(state: WorkspaceState): WorkspaceTransitionDecision {
  if (state === "Setup Required") return { allowed: true, nextState: "Archived" };
  if (state === "Active") return { allowed: false, reason: "archive_unavailable" };
  return { allowed: false, reason: "state_unchanged" };
}

export function decideRestore(state: WorkspaceState): WorkspaceTransitionDecision {
  return state === "Archived"
    ? { allowed: true, nextState: "Setup Required" }
    : { allowed: false, reason: "state_unchanged" };
}

export function describeSetupChecklist(record: { destinationNumber: string | null }): Array<{ label: string; complete: boolean }> {
  return [
    { label: "Tracking Number", complete: false },
    { label: "Destination Number", complete: Boolean(record.destinationNumber) },
    { label: "Published Call Flow", complete: false },
  ];
}
