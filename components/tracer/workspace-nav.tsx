/**
 * -------------------------------------------------------------------------
 * @file   workspace-nav.tsx
 * @brief  Registers the current Workspace for the Sidebar navigation.
 *
 * @description
 *  WorkspaceNavProvider holds the Workspace whose pages the Sidebar should
 *  navigate: its id, name, state, and whether the actor is an Operator.
 *  WorkspaceNav registers one Workspace for as long as it is mounted, and
 *  useWorkspaceNav reads the registration from the Sidebar.
 *
 * @remarks
 *  The Workspace layout renders WorkspaceNav after its authorized Workspace
 *  read, the way it registers the breadcrumb label, so the registration
 *  clears when the actor leaves the Workspace and global navigation
 *  returns. The cleanup only clears its own registration, so moving
 *  between two Workspaces never drops the newer one.
 *
 * @see
 *  components/tracer/app-sidebar.tsx
 *  components/tracer/breadcrumbs.tsx
 *  app/(app)/workspaces/[id]/layout.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { WorkspaceState } from "@/data/workspace-policy";

export interface WorkspaceNavRegistration {
  id: string;
  name: string;
  state: WorkspaceState;
  operator: boolean;
}

interface WorkspaceNavContextValue {
  workspace: WorkspaceNavRegistration | null;
  register: (workspace: WorkspaceNavRegistration) => () => void;
}

const WorkspaceNavContext = createContext<WorkspaceNavContextValue>({ workspace: null, register: () => () => undefined });

export function WorkspaceNavProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<WorkspaceNavRegistration | null>(null);
  const register = useCallback((next: WorkspaceNavRegistration) => {
    setWorkspace(next);
    return () => setWorkspace((current) => (current === next ? null : current));
  }, []);
  const value = useMemo(() => ({ workspace, register }), [workspace, register]);
  return <WorkspaceNavContext.Provider value={value}>{children}</WorkspaceNavContext.Provider>;
}

/** Registers the Workspace the Sidebar navigates for as long as it is mounted. */
export function WorkspaceNav({ id, name, state, operator }: WorkspaceNavRegistration) {
  const { register } = useContext(WorkspaceNavContext);
  useEffect(() => register({ id, name, state, operator }), [register, id, name, state, operator]);
  return null;
}

export function useWorkspaceNav(): WorkspaceNavRegistration | null {
  return useContext(WorkspaceNavContext).workspace;
}
