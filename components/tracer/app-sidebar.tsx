/**
 * -------------------------------------------------------------------------
 * @file   app-sidebar.tsx
 * @brief  Renders the role-aware Tracer application Sidebar.
 *
 * @description
 *  Provides global navigation and an account menu at the top of the Sidebar.
 *  The menu lists the current Organization with a disabled New organization
 *  action, the signed-in user with a DiceBear avatar, Account Settings, and
 *  Sign out.
 *
 * @remarks
 *  Workspace selection lives on the Workspaces page, so the Sidebar carries
 *  no Workspace switcher. The first release has one Organization; New
 *  organization stays disabled until multiple Organizations are supported.
 *  Operator navigation is hidden for Client Viewers while server guards
 *  remain authoritative for protected routes. The avatar is seeded by the
 *  opaque user id so no email or name is sent to DiceBear.
 *
 * @see
 *  DESIGN.md
 *  https://www.dicebear.com/styles/gaze/
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import {
  Activity,
  Building2,
  Check,
  ChevronsUpDown,
  FileText,
  House,
  LayoutGrid,
  LogOut,
  Phone,
  Plug,
  Plus,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentType } from "react";

import { Badge } from "@/components/reui/badge";
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
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { type CanonicalRole } from "@/data/auth-policy";

interface AppSidebarProps {
  actor: { id: string; name: string; email: string; role: CanonicalRole };
  organization: { name: string; slug: string };
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

export function avatarUrl(userId: string): string {
  return `https://api.dicebear.com/10.x/gaze/svg?seed=${encodeURIComponent(userId)}`;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

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
            <span aria-hidden="true" className="size-6 shrink-0 rounded-full bg-[radial-gradient(circle_at_30%_30%,var(--color-chart-1),var(--color-chart-3))]" />
            <span className="flex min-w-0 flex-col items-start leading-tight">
              <span className="truncate font-semibold">{actor.name}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">{organization.slug}</span>
            </span>
            <ChevronsUpDown className="ml-auto opacity-60" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Organizations</DropdownMenuLabel>
              <DropdownMenuItem>
                <Building2 aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{organization.name}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">{organization.slug}</span>
                </span>
                <Check className="ml-auto" aria-hidden="true" />
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <Plus aria-hidden="true" />
                New organization
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <div className="flex items-center gap-2 px-1.5 py-1.5">
              <Avatar className="size-8">
                <AvatarImage src={avatarUrl(actor.id)} alt="" />
                <AvatarFallback>{initials(actor.name)}</AvatarFallback>
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

export default function AppSidebar({ actor, organization }: AppSidebarProps) {
  const pathname = usePathname();
  const items = navigation.filter((item) => !item.operatorOnly || actor.role === "Operator");

  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <AccountMenu actor={actor} organization={organization} />
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
    </Sidebar>
  );
}
