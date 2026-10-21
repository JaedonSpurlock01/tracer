/**
 * -------------------------------------------------------------------------
 * @file   app-sidebar.tsx
 * @brief  Renders the role-aware Tracer application Sidebar.
 *
 * @description
 *  Provides navigation and an account menu at the top of the Sidebar.
 *  Outside a Workspace the navigation is global. Inside a Workspace, which
 *  the Workspace layout registers through WorkspaceNav, the navigation
 *  swaps to an All Workspaces back link, the Workspace name as a heading,
 *  Overview, a Website group with Site and Forms, a Phone group with Calls and the
 *  Operator-only Flow, Reports, and the Operator-only Settings. The menu
 *  trigger carries the Tracer orb. The menu lists the current Organization
 *  with a disabled New organization action, the signed-in user with a
 *  DiceBear avatar, Account Settings, and Sign out. The Sidebar is flat on
 *  the root color with one hairline on its edge.
 *
 * @remarks
 *  Workspace selection lives on the Workspaces page, so the Sidebar carries
 *  no Workspace switcher. The first release has one Organization; New
 *  organization stays disabled until multiple Organizations are supported.
 *  Operator navigation is hidden for Client Viewers while server guards
 *  remain authoritative for protected routes. Overview is current only on
 *  its exact route; every other Workspace item is current for its route
 *  and the routes below it, so Call Detail marks Calls and every Workspace
 *  Settings section marks Settings. The avatar is the DiceBear Gaze face
 *  the user picked in Account Settings, or one seeded by the opaque user
 *  id, so no email or name is sent to DiceBear.
 *
 * @see
 *  DESIGN.md
 *  components/tracer/workspace-nav.tsx
 *  data/avatar.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import {
  Activity,
  ArrowLeft,
  Check,
  ChevronsUpDown,
  FileText,
  Globe,
  House,
  Inbox,
  LayoutGrid,
  LogOut,
  Phone,
  Plug,
  Plus,
  Settings,
  Users,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentType } from "react";

import { Badge } from "@/components/reui/badge";
import { BrandMark } from "@/components/tracer/brand";
import { useWorkspaceNav, type WorkspaceNavRegistration } from "@/components/tracer/workspace-nav";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { type CanonicalRole } from "@/data/auth-policy";
import { avatarInitials, avatarUrl } from "@/data/avatar";

interface AppSidebarProps {
  actor: { id: string; name: string; email: string; role: CanonicalRole; avatarSeed?: string };
  organization: { name: string; slug: string };
}

interface NavigationItem {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  operatorOnly?: boolean;
  /** Current only on the exact route rather than on the routes below it. */
  exact?: boolean;
}

const navigation: NavigationItem[] = [
  { label: "Home", href: "/", icon: House, exact: true },
  { label: "Activity", href: "/activity", icon: Activity },
  { label: "Calls", href: "/calls", icon: Phone },
  { label: "Workspaces", href: "/workspaces", icon: LayoutGrid },
  { label: "Reports", href: "/reports", icon: FileText },
  { label: "Users", href: "/users", icon: Users, operatorOnly: true },
  { label: "Integrations", href: "/integrations", icon: Plug, operatorOnly: true },
];

function AccountMenu({ actor, organization }: AppSidebarProps) {
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => undefined);
    window.sessionStorage.removeItem("tracer.pending-email");
    router.push("/sign-in");
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" className="aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground" />}
          >
            <BrandMark />
            <span className="flex min-w-0 flex-col items-start leading-tight">
              <span className="truncate font-semibold">{actor.name}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">{organization.slug}</span>
            </span>
            <ChevronsUpDown className="ml-auto opacity-60" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Organizations</DropdownMenuLabel>
              <DropdownMenuItem className="gap-2 px-2 py-2">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate">{organization.name}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">{organization.slug}</span>
                </span>
                <Check className="ml-auto" aria-hidden="true" />
              </DropdownMenuItem>
              <DropdownMenuItem disabled className="gap-2 px-2 py-1.5">
                <Plus aria-hidden="true" />
                New organization
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <div className="flex items-center gap-2 px-1.5 py-1.5">
              <Avatar className="size-8">
                <AvatarImage src={avatarUrl(actor.avatarSeed ?? actor.id)} alt="" />
                <AvatarFallback>{avatarInitials(actor.name)}</AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{actor.name}</span>
                <span className="truncate text-xs text-muted-foreground">{actor.email}</span>
              </span>
              <Badge variant="outline">{actor.role}</Badge>
            </div>
            <DropdownMenuItem render={<Link href="/account/settings" />}>
              <Settings aria-hidden="true" />
              Account Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void signOut()}>
              <LogOut aria-hidden="true" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function isCurrent(item: NavigationItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavigationMenu({ items, operator }: { items: NavigationItem[]; operator: boolean }) {
  const pathname = usePathname();
  return (
    <SidebarMenu>
      {items
        .filter((item) => !item.operatorOnly || operator)
        .map((item) => {
          const Icon = item.icon;
          const active = isCurrent(item, pathname);
          return (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton render={<Link href={item.href} prefetch aria-current={active ? "page" : undefined} />} isActive={active}>
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
    </SidebarMenu>
  );
}

function workspaceNavigation(workspaceId: string): Record<"overview" | "website" | "phone" | "tail", NavigationItem[]> {
  const base = `/workspaces/${workspaceId}`;
  return {
    overview: [{ label: "Overview", href: base, icon: House, exact: true }],
    website: [
      { label: "Site", href: `${base}/site`, icon: Globe },
      { label: "Forms", href: `${base}/forms`, icon: Inbox },
    ],
    phone: [
      { label: "Calls", href: `${base}/calls`, icon: Phone },
      { label: "Flow", href: `${base}/flow`, icon: Workflow, operatorOnly: true },
    ],
    tail: [
      { label: "Reports", href: `${base}/reports`, icon: FileText },
      { label: "Settings", href: `${base}/settings`, icon: Settings, operatorOnly: true },
    ],
  };
}

function WorkspaceNavigation({ workspace }: { workspace: WorkspaceNavRegistration }) {
  const groups = workspaceNavigation(workspace.id);
  return (
    <nav aria-label="Workspace" className="flex flex-col">
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href="/workspaces" prefetch />} className="text-muted-foreground">
              <ArrowLeft aria-hidden="true" />
              <span>All Workspaces</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel className="text-sidebar-foreground">{workspace.name}</SidebarGroupLabel>
        <SidebarGroupContent>
          <NavigationMenu items={groups.overview} operator={workspace.operator} />
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>Website</SidebarGroupLabel>
        <SidebarGroupContent>
          <NavigationMenu items={groups.website} operator={workspace.operator} />
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>Phone</SidebarGroupLabel>
        <SidebarGroupContent>
          <NavigationMenu items={groups.phone} operator={workspace.operator} />
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <NavigationMenu items={groups.tail} operator={workspace.operator} />
      </SidebarGroup>
    </nav>
  );
}

export default function AppSidebar({ actor, organization }: AppSidebarProps) {
  const workspace = useWorkspaceNav();
  const operator = actor.role === "Operator";

  return (
    <Sidebar>
      <SidebarHeader>
        <AccountMenu actor={actor} organization={organization} />
      </SidebarHeader>
      <SidebarContent>
        {workspace ? <WorkspaceNavigation workspace={workspace} /> : <NavigationMenu items={navigation} operator={operator} />}
      </SidebarContent>
    </Sidebar>
  );
}
