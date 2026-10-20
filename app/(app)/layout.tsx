/**
 * -------------------------------------------------------------------------
 * @file   layout.tsx
 * @brief  Protects and composes the authenticated Tracer application shell.
 *
 * @description
 *  Resolves the current actor, redirects unauthenticated requests, and wraps
 *  authenticated pages in the responsive Sidebar shell with the actor's
 *  account menu and current Organization. The header holds the report and
 *  export notification popover, and one jobs provider spans the header and
 *  page so a job a page requests appears in the popover at once.
 *
 * @remarks
 *  Route authorization remains server-side before shell content renders. The
 *  inset may shrink below its content width so wide Data Grids scroll inside
 *  their Frame instead of widening the page beside the Sidebar.
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
import { ReportJobsProvider } from "@/components/tracer/report-jobs";
import ReportNotifications from "@/components/tracer/report-notifications";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { resolveRequestActor } from "@/app/(app)/actor";
import { createOrganizationRepository } from "@/data/organization-repository";
import { withTracerRuntime } from "@/data/tracer-runtime";

interface AppLayoutProps {
  children: ReactNode;
}

export default async function AppLayout({ children }: AppLayoutProps) {
  const actor = await resolveRequestActor();
  if (!actor) {
    redirect("/sign-in");
  }
  const organization = await withTracerRuntime(({ pool }) => createOrganizationRepository(pool).findById(actor.organizationId));

  return (
    <SidebarProvider>
      <AppSidebar
        actor={{ id: actor.userId, name: actor.name, email: actor.email, role: actor.role }}
        organization={{ name: organization?.name ?? "Organization", slug: organization?.slug ?? "" }}
      />
      <SidebarInset className="min-w-0">
        <ReportJobsProvider>
          <header className="flex h-12 items-center justify-between gap-2 border-b border-border px-4">
            <SidebarTrigger />
            <ReportNotifications />
          </header>
          <div className="flex flex-1 flex-col gap-6 p-6">{children}</div>
        </ReportJobsProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
