/**
 * -------------------------------------------------------------------------
 * @file   layout.tsx
 * @brief  Protects and composes the authenticated Tracer application shell.
 *
 * @description
 *  Resolves the current actor, redirects unauthenticated requests, and wraps
 *  authenticated pages in the responsive Sidebar shell with the actor's
 *  account menu and current Organization. The header holds the Sidebar
 *  trigger, route breadcrumbs, and the report and export notification
 *  popover. One jobs provider spans the header and page so a job a page
 *  requests appears in the popover at once, one breadcrumb provider
 *  lets a nested route name its own dynamic segment, and one Workspace
 *  navigation provider spans the Sidebar and the page so the Workspace
 *  layout can swap the Sidebar to that Workspace's pages.
 *
 * @remarks
 *  Route authorization remains server-side before shell content renders. The
 *  inset may shrink below its content width so wide Data Grids scroll inside
 *  their Frame instead of widening the page beside the Sidebar. The inset
 *  alone carries the paper grain; the Sidebar stays flat.
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
import { BreadcrumbProvider, Breadcrumbs } from "@/components/tracer/breadcrumbs";
import { ReportJobsProvider } from "@/components/tracer/report-jobs";
import ReportNotifications from "@/components/tracer/report-notifications";
import { WorkspaceNavProvider } from "@/components/tracer/workspace-nav";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { resolveRequestActor } from "@/app/(app)/actor";
import { createOrganizationRepository } from "@/data/organization-repository";
import { findUserAvatarSeed } from "@/data/user-avatar";
import { withRequestRuntime } from "@/app/(app)/runtime";

interface AppLayoutProps {
  children: ReactNode;
}

export default async function AppLayout({ children }: AppLayoutProps) {
  const actor = await resolveRequestActor();
  if (!actor) {
    redirect("/sign-in");
  }
  const [organization, avatarSeed] = await withRequestRuntime(({ pool }) =>
    Promise.all([
      createOrganizationRepository(pool).findById(actor.organizationId),
      findUserAvatarSeed(pool, actor.userId).catch(() => undefined),
    ]),
  );

  return (
    <SidebarProvider>
      <WorkspaceNavProvider>
        <AppSidebar
          actor={{ id: actor.userId, name: actor.name, email: actor.email, role: actor.role, avatarSeed }}
          organization={{ name: organization?.name ?? "Organization", slug: organization?.slug ?? "" }}
        />
        <SidebarInset className="min-w-0 bg-grain">
          <ReportJobsProvider>
            <BreadcrumbProvider>
              <header className="flex h-12 items-center gap-2 border-b border-border px-4">
                <SidebarTrigger />
                <Separator orientation="vertical" className="h-4 w-px" />
                <Breadcrumbs className="min-w-0" />
                <div className="ml-auto">
                  <ReportNotifications />
                </div>
              </header>
              <div className="flex flex-1 flex-col gap-6 p-6">{children}</div>
            </BreadcrumbProvider>
          </ReportJobsProvider>
        </SidebarInset>
      </WorkspaceNavProvider>
    </SidebarProvider>
  );
}
