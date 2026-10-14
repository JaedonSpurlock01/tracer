/**
 * -------------------------------------------------------------------------
 * @file   app-sidebar.tsx
 * @brief  Renders the role-aware Tracer application Sidebar.
 *
 * @description
 *  Provides global navigation, the Tracer brand lockup, and account actions
 *  for authenticated Operators and Client Viewers.
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
  DropdownMenuItem,
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

interface AppSidebarProps {
  actor: { name: string; email: string; role: CanonicalRole };
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

export default function AppSidebar({ actor }: AppSidebarProps) {
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
