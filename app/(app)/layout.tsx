/**
 * -------------------------------------------------------------------------
 * @file   layout.tsx
 * @brief  Protects and composes the authenticated Tracer application shell.
 *
 * @description
 *  Resolves the current actor, redirects unauthenticated requests, and wraps
 *  authenticated pages in the responsive Sidebar shell with the Workspaces
 *  the actor may read.
 *
 * @remarks
 *  Route authorization remains server-side before shell content renders.
 *
 * @see
 *  components/tracer/app-sidebar.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import AppSidebar from "@/components/tracer/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { resolveRequestActor } from "@/app/(app)/actor";
import { createReadableWorkspaces } from "@/data/workspace-authorization";
import { withTracerRuntime } from "@/data/tracer-runtime";

interface AppLayoutProps {
  children: ReactNode;
}

export default async function AppLayout({ children }: AppLayoutProps) {
  const actor = await resolveRequestActor();
  if (!actor) {
    redirect("/sign-in");
  }
  const workspaces = actor.state === "Active"
    ? (await withTracerRuntime(({ pool }) => createReadableWorkspaces(pool, actor).list({ pageSize: 50 }))).workspaces
    : [];

  return (
    <SidebarProvider>
      <AppSidebar
        actor={{ name: actor.name, email: actor.email, role: actor.role }}
        workspaces={workspaces.map(({ id, name }) => ({ id, name }))}
      />
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b border-border px-4">
          <SidebarTrigger />
        </header>
        <div className="flex flex-1 flex-col gap-6 p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
