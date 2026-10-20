/**
 * -------------------------------------------------------------------------
 * @file   app-sidebar.tsx
 * @brief  Renders the role-aware Tracer application Sidebar.
 *
 * @description
 *  Provides global navigation and an account menu at the top of the Sidebar.
 *  The menu trigger carries the Tracer orb. The menu lists the
 *  current Organization with a disabled New organization action, the
 *  signed-in user with a DiceBear avatar, Account Settings, and Sign out.
 *  The Sidebar is flat on the root color with one hairline on its edge.
 *
 * @remarks
 *  Workspace selection lives on the Workspaces page, so the Sidebar carries
 *  no Workspace switcher. The first release has one Organization; New
 *  organization stays disabled until multiple Organizations are supported.
 *  Operator navigation is hidden for Client Viewers while server guards
 *  remain authoritative for protected routes. The avatar is the DiceBear
 *  Gaze face the user picked in Account Settings, or one seeded by the
 *  opaque user id, so no email or name is sent to DiceBear.
 *
 * @see
 *  DESIGN.md
 *  data/avatar.ts
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
import { BrandMark } from "@/components/tracer/brand";
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

export default function AppSidebar({ actor, organization }: AppSidebarProps) {
  const pathname = usePathname();
  const items = navigation.filter((item) => !item.operatorOnly || actor.role === "Operator");

  return (
    <Sidebar>
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
                <SidebarMenuButton render={<Link href={item.href} prefetch />} isActive={isActive}>
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
