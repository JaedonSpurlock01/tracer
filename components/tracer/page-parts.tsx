/**
 * -------------------------------------------------------------------------
 * @file   page-parts.tsx
 * @brief  Provides the shared parts every rebuilt page is composed from.
 *
 * @description
 *  StatStrip is one bordered strip of label-over-value stats. Each stat may
 *  carry its change against the previous period, shown only when there is
 *  one, and a definition that stays out of sight but is read on hover and by
 *  assistive technology. FactList is a label-over-value definition list for
 *  read-only details; an absent value is named ("None", or the wording the
 *  caller gives) and shown muted. PageHeader holds the page's one top
 *  heading, a line of context, and its controls on a single row. Panel is
 *  the bordered surface with an optional header bar of a title and one
 *  action. ListRow is a one-line link row with a detail line beneath its
 *  primary value and room for badges on the right.
 *
 * @remarks
 *  The strip replaces a row of separate tiles so a page's headline numbers
 *  read as one object. A change of zero or no previous period shows nothing
 *  rather than a dash.
 *
 * @see
 *  DESIGN.md
 *  docs/IMPLEMENTATION_ROADMAP.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cn } from "cn";
import Link from "next/link";
import { useId, type ComponentProps, type ReactNode } from "react";

const relativeChange = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0, signDisplay: "exceptZero" });
const pointChange = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, signDisplay: "exceptZero" });

export interface StatChange {
  value: number;
  unit: "relative" | "points";
}

export interface Stat {
  label: string;
  value: string;
  change?: StatChange | null;
  hint?: string;
  tone?: "success" | "destructive";
}

const statColumns = ["", "xl:grid-cols-1", "xl:grid-cols-2", "xl:grid-cols-3", "xl:grid-cols-4", "xl:grid-cols-5", "xl:grid-cols-6"];
const toneClass = { success: "text-success", destructive: "text-destructive" };

function StatCell({ stat }: { stat: Stat }) {
  const id = useId();
  const change = stat.change && stat.change.value !== 0 ? stat.change : null;
  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={stat.hint ? `${id}-hint` : undefined} title={stat.hint} className="flex flex-col gap-1.5 bg-card px-4 py-3.5">
      <span id={`${id}-label`} className="text-xs text-muted-foreground">{stat.label}</span>
      <span className="flex items-baseline gap-2">
        <span className={cn("text-2xl font-semibold tracking-tight tabular-nums", stat.tone ? toneClass[stat.tone] : null)}>{stat.value}</span>
        {change ? (
          <span className={cn("text-xs font-medium tabular-nums", change.value > 0 ? "text-success" : "text-destructive")}>
            {change.unit === "points" ? `${pointChange.format(change.value * 100)} pts` : relativeChange.format(change.value)}
          </span>
        ) : null}
      </span>
      {stat.hint ? <span id={`${id}-hint`} className="sr-only">{stat.hint}</span> : null}
    </div>
  );
}

export function StatStrip({ stats, className }: { stats: Stat[]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3", statColumns[Math.min(stats.length, 6)], className)}>
      {stats.map((stat) => (
        <StatCell key={stat.label} stat={stat} />
      ))}
    </div>
  );
}

export interface Fact {
  label: string;
  value: ReactNode | null;
  /** What to say when there is no value. Defaults to "None". */
  empty?: string;
  /** Phone numbers and identifiers only. */
  mono?: boolean;
}

export function FactList({ facts, className }: { facts: Fact[]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", className)}>
      {facts.map((fact) => {
        const absent = fact.value === null || fact.value === "";
        return (
          <div key={fact.label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{fact.label}</dt>
            <dd className={cn("text-sm break-words tabular-nums", absent ? "text-muted-foreground" : null, fact.mono && !absent ? "font-mono" : null)}>
              {absent ? fact.empty ?? "None" : fact.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function PageHeader({ title, description, children }: { title: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function Panel({ title, action, children, className, ...props }: Omit<ComponentProps<"section">, "title"> & { title?: string; action?: ReactNode }) {
  const id = useId();
  return (
    <section
      role={title ? "region" : undefined}
      aria-labelledby={title ? id : undefined}
      className={cn("flex flex-col rounded-lg border border-border bg-card", className)}
      {...props}
    >
      {title ? (
        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
          <h2 id={id} className="text-sm font-medium">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function ListRow({ href, title, detail, children, className }: { href: string; title: ReactNode; detail?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60", className)}>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium tabular-nums">{title}</span>
        {detail ? <span className="truncate text-xs text-muted-foreground">{detail}</span> : null}
      </span>
      {children}
    </Link>
  );
}
