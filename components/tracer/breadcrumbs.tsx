/**
 * -------------------------------------------------------------------------
 * @file   breadcrumbs.tsx
 * @brief  Renders the application header breadcrumbs from the route.
 *
 * @description
 *  Breadcrumbs derives one crumb per path segment, linking every crumb but
 *  the current page. Static segments have fixed labels; a dynamic segment
 *  (a Workspace or Call id) shows the label the owning route registered
 *  through BreadcrumbLabel, or a generic noun until it has.
 *
 * @remarks
 *  Labels live in one provider above the header and the page, so a nested
 *  route can name its own segment without the header knowing about it.
 *  The root route shows a single Home crumb; Home is not prefixed
 *  elsewhere because the Sidebar already offers it.
 *
 * @see
 *  app/(app)/layout.tsx
 *  app/(app)/workspaces/[id]/layout.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { workspaceSettingsSections } from "@/components/tracer/workspace-settings-sections";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

type Labels = Readonly<Record<string, string>>;

interface BreadcrumbContextValue {
  labels: Labels;
  register: (segment: string, label: string) => () => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue>({ labels: {}, register: () => () => undefined });

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [labels, setLabels] = useState<Labels>({});
  const register = useCallback((segment: string, label: string) => {
    setLabels((previous) => (previous[segment] === label ? previous : { ...previous, [segment]: label }));
    return () => {
      setLabels((previous) => {
        if (!(segment in previous)) return previous;
        const next = { ...previous };
        delete next[segment];
        return next;
      });
    };
  }, []);
  const value = useMemo(() => ({ labels, register }), [labels, register]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

/** Names one dynamic path segment for as long as it is mounted. */
export function BreadcrumbLabel({ segment, label }: { segment: string; label: string }) {
  const { register } = useContext(BreadcrumbContext);
  useEffect(() => register(segment, label), [register, segment, label]);
  return null;
}

const staticLabels: Readonly<Record<string, string>> = {
  activity: "Activity",
  calls: "Calls",
  workspaces: "Workspaces",
  reports: "Reports",
  users: "Users",
  integrations: "Integrations",
  account: "Account",
  settings: "Settings",
  flow: "Flow",
};

/** Segments with no page of their own render as text, not links. */
const unlinked = new Set(["account"]);

function fallbackLabel(segment: string, parent: string | undefined): string {
  if (parent === "workspaces") return "Workspace";
  if (parent === "calls") return "Call";
  if (parent === "settings") return workspaceSettingsSections.find((section) => section.slug === segment)?.label ?? segment;
  return segment;
}

export function crumbsFor(pathname: string, labels: Labels): { href: string; label: string; link: boolean }[] {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return [{ href: "/", label: "Home", link: true }];
  return segments.map((segment, index) => ({
    href: `/${segments.slice(0, index + 1).join("/")}`,
    label: staticLabels[segment] ?? labels[segment] ?? fallbackLabel(segment, segments[index - 1]),
    link: !unlinked.has(segment),
  }));
}

export function Breadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname();
  const { labels } = useContext(BreadcrumbContext);
  const crumbs = crumbsFor(pathname, labels);
  const last = crumbs.length - 1;
  return (
    <Breadcrumb className={className}>
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, index) => (
          <Fragment key={crumb.href}>
            {index > 0 ? <BreadcrumbSeparator /> : null}
            <BreadcrumbItem className="min-w-0">
              {index === last ? (
                <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
              ) : crumb.link ? (
                <BreadcrumbLink render={<Link href={crumb.href} prefetch />} className="truncate">
                  {crumb.label}
                </BreadcrumbLink>
              ) : (
                <span className="truncate">{crumb.label}</span>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
