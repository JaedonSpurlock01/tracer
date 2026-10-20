/**
 * -------------------------------------------------------------------------
 * @file   workspace-tabs.tsx
 * @brief  Renders the Workspace navigation tabs.
 *
 * @description
 *  Shows one prefetched link per Workspace page: Overview, Calls, Reports,
 *  and, for Operators, Flow before Reports and Settings after it. Each Workspace page renders the tabs below
 *  its own header and names its own tab, which is marked as the current
 *  page, so every Workspace Settings section marks Settings.
 *
 * @remarks
 *  Pages render the tabs only after their Workspace read succeeds, so a
 *  Workspace that is Not Found shows none, and Call Detail, a record-detail
 *  page, has none. Hiding Flow and Settings from Client Viewers is cosmetic;
 *  those routes authorize Operators on the server. The row scrolls
 *  horizontally inside its own width at narrow sizes rather than scrolling
 *  the page.
 *
 * @see
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import Link from "next/link";

import { cn } from "cn";

export type WorkspaceTab = "overview" | "calls" | "flow" | "reports" | "settings";

interface WorkspaceTabsProps {
  workspaceId: string;
  operator: boolean;
  current: WorkspaceTab;
}

export default function WorkspaceTabs({ workspaceId, operator, current }: WorkspaceTabsProps) {
  const base = `/workspaces/${workspaceId}`;
  const tabs: { id: WorkspaceTab; label: string; href: string }[] = [
    { id: "overview", label: "Overview", href: base },
    { id: "calls", label: "Calls", href: `${base}/calls` },
    ...(operator ? [{ id: "flow" as const, label: "Flow", href: `${base}/flow` }] : []),
    { id: "reports", label: "Reports", href: `${base}/reports` },
    ...(operator ? [{ id: "settings" as const, label: "Settings", href: `${base}/settings` }] : []),
  ];

  return (
    <div className="min-w-0 border-b border-border">
      <nav aria-label="Workspace" className="flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === current;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              prefetch
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
