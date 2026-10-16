/**
 * -------------------------------------------------------------------------
 * @file   app-sidebar.tsx
 * @brief  Renders the role-aware Tracer application Sidebar.
 *
 * @description
 *  Provides global navigation, the Tracer brand lockup, a Workspace switcher
 *  limited to the Workspaces the actor may read, and account actions for
 *  authenticated Operators and Client Viewers.
 *
 * @remarks
 *  Operator navigation is hidden for Client Viewers while server guards remain
 *  authoritative for protected routes.
 *
 * @see
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import {
  Activity,
  Check,
  ChevronsUpDown,
  FileText,
  House,
  LayoutGrid,
  Phone,
  Plug,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentType } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { type CanonicalRole } from "@/data/auth-policy";

interface WorkspaceLink {
  id: string;
  name: string;
}

interface AppSidebarProps {
  actor: { name: string; email: string; role: CanonicalRole };
  workspaces: WorkspaceLink[];
}

interface NavigationItem {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  operatorOnly?: boolean;
}

const navigation: NavigationItem[] = [
  { label: "Home", href: "/", icon: House },
  { label: "Activity", href: "/activity", icon: Activity },
  { label: "Calls", href: "/calls", icon: Phone },
  { label: "Workspaces", href: "/workspaces", icon: LayoutGrid },
  { label: "Reports", href: "/reports", icon: FileText },
  { label: "Users", href: "/users", icon: Users, operatorOnly: true },
  { label: "Integrations", href: "/integrations", icon: Plug, operatorOnly: true },
];

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function WorkspaceSwitcher({ workspaces, showAll }: { workspaces: WorkspaceLink[]; showAll: boolean }) {
  const pathname = usePathname();
  const currentId = pathname.match(/^\/workspaces\/([^/]+)/)?.[1];
  const current = workspaces.find((workspace) => workspace.id === currentId);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton className="aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground" />}
          >
            <span className="truncate">{current?.name ?? "Select a Workspace"}</span>
            <ChevronsUpDown className="ml-auto opacity-60" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              {workspaces.map((workspace) => (
                <DropdownMenuItem key={workspace.id} render={<Link href={`/workspaces/${workspace.id}`} />}>
                  <span className="truncate">{workspace.name}</span>
                  {workspace.id === currentId ? <Check className="ml-auto size-3.5" aria-hidden="true" /> : null}
                </DropdownMenuItem>
              ))}
              {workspaces.length ? null : <DropdownMenuItem disabled>No Workspaces</DropdownMenuItem>}
            </DropdownMenuGroup>
            {showAll ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link href="/workspaces" />}>All Workspaces</DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export default function AppSidebar({ actor, workspaces }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const items = navigation.filter((item) => !item.operatorOnly || actor.role === "Operator");

  async function signOut() {
    await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => undefined);
    window.sessionStorage.removeItem("tracer.pending-email");
    router.push("/sign-in");
  }

  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href="/" />} size="lg">
              <span aria-hidden="true" className="size-6 rounded-full bg-[radial-gradient(circle_at_30%_30%,var(--color-chart-1),var(--color-chart-3))]" />
              <span className="font-semibold">Tracer</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <WorkspaceSwitcher workspaces={workspaces} showAll={actor.role === "Operator"} />
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton render={<Link href={item.href} />} isActive={isActive}>
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                <Avatar className="size-8">
                  <AvatarFallback>{initials(actor.name)}</AvatarFallback>
                </Avatar>
                <span className="flex min-w-0 flex-col items-start">
                  <span className="truncate font-medium">{actor.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{actor.email}</span>
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-56">
                <DropdownMenuItem render={<Link href="/account/settings" />}>Account Settings</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void signOut()}>Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
