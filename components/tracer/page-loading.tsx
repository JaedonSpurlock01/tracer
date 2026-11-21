/**
 * -------------------------------------------------------------------------
 * @file   page-loading.tsx
 * @brief  Paints each page's shape at once while its data streams in.
 *
 * @description
 *  Every page has its own loading state, exported here and re-exported by
 *  the loading file beside the page. Each one is built from skeletons of
 *  the shared parts: a page header with the page's controls, a stat strip,
 *  ledger panels, and panels that carry the loaded page's real headings.
 *  A loading state keeps its page's width (reading pages cap at
 *  max-w-6xl) and renders the same named regions the loaded page always
 *  shows, so nothing moves when the data arrives.
 *
 * @remarks
 *  Next prefetches a page's loading state with the links that lead to it,
 *  stopping at the first segment that has one. A loading file on a route
 *  group would therefore stand in for every page beneath it, so each page
 *  has its own, and Home, the Workspace Overview, and Workspace Calls sit
 *  in their own route groups for that reason. Panels a page shows only for
 *  some roles or states (Business, Needs attention, a settings section
 *  other than the first) stay out of its skeleton. The boundaries sit
 *  inside the route groups whose layouts decide authorization, so a denied
 *  page still answers with a real 404 before anything streams.
 *
 * @see
 *  components/tracer/page-parts.tsx
 *  tests/components/app-loading.test.tsx
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cn } from "cn";
import type { ReactNode } from "react";

import { Panel } from "@/components/tracer/page-parts";
import { Skeleton } from "@/components/ui/skeleton";

function Loading({ status, reading = false, className, children }: { status: string; reading?: boolean; className?: string; children: ReactNode }) {
  return (
    <div aria-busy="true" className={cn("flex flex-col gap-5", reading ? "mx-auto w-full max-w-6xl" : null, className)}>
      <span role="status" className="sr-only">{status}</span>
      {children}
    </div>
  );
}

function times(count: number) {
  return Array.from({ length: count }, (_, index) => index);
}

function HeaderSkeleton({ controls = 0 }: { controls?: number }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-5 w-72 max-w-full" />
      </div>
      {controls ? (
        <div className="flex flex-wrap items-center gap-2">
          {times(controls).map((index) => <Skeleton key={index} className="h-9 w-28" />)}
        </div>
      ) : null}
    </div>
  );
}

function StripSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 xl:grid-cols-4">
      {times(4).map((index) => (
        <div key={index} className="flex flex-col gap-1.5 bg-card px-4 py-3.5">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  );
}

function Rows({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-3 p-4">
      {times(count).map((index) => <Skeleton key={index} className="h-9 w-full" />)}
    </div>
  );
}

function ChartPanel({ title, className }: { title: string; className?: string }) {
  return (
    <Panel title={title} className={className}>
      <div className="p-4">
        <Skeleton className="h-64 w-full" />
      </div>
    </Panel>
  );
}

function SectionNav({ items }: { items: number }) {
  return (
    <div className="flex gap-1 overflow-hidden md:flex-col">
      {times(items).map((index) => <Skeleton key={index} className="h-9 w-28 shrink-0 md:w-full" />)}
    </div>
  );
}

function LedgerLoading({ status }: { status: string }) {
  return (
    <Loading status={status}>
      <HeaderSkeleton controls={1} />
      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Skeleton className="h-9 w-full sm:w-64" />
          <Skeleton className="h-9 w-24" />
        </div>
        <Rows count={10} />
      </Panel>
    </Loading>
  );
}

export function HomeLoading() {
  return (
    <Loading status="Loading Home" reading>
      <HeaderSkeleton controls={2} />
      <StripSkeleton />
      <div className="grid items-start gap-5 lg:grid-cols-3">
        <ChartPanel title="Leads generated" className="lg:col-span-2" />
        <Panel title="Recent Calls">
          <Rows count={5} />
        </Panel>
      </div>
      <Panel title="Workspaces">
        <Rows count={4} />
      </Panel>
    </Loading>
  );
}

export function CallsLoading() {
  return <LedgerLoading status="Loading Calls" />;
}

export function ReportsLoading() {
  return <LedgerLoading status="Loading Reports" />;
}

export function WorkspacesLoading() {
  return <LedgerLoading status="Loading Workspaces" />;
}

export function UsersLoading() {
  return <LedgerLoading status="Loading Users" />;
}

export function FormsLoading() {
  return <LedgerLoading status="Loading Forms" />;
}

export function AccountSettingsLoading() {
  return (
    <Loading status="Loading Account Settings" reading>
      <HeaderSkeleton />
      <div className="grid items-start gap-5 md:grid-cols-[12rem_1fr]">
        <SectionNav items={3} />
        <Panel title="Profile">
          <Rows count={4} />
        </Panel>
      </div>
    </Loading>
  );
}

export function WorkspaceSettingsLoading() {
  return (
    <Loading status="Loading Workspace Settings" reading>
      <HeaderSkeleton />
      <div className="grid items-start gap-5 md:grid-cols-[12rem_1fr]">
        <SectionNav items={6} />
        <Panel>
          <Rows count={5} />
        </Panel>
      </div>
    </Loading>
  );
}

export function IntegrationsLoading() {
  return (
    <Loading status="Loading Integrations">
      <HeaderSkeleton />
      <div className="grid gap-5 md:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="flex gap-1 overflow-hidden md:flex-col">
          {times(8).map((index) => <Skeleton key={index} className="h-10 w-32 shrink-0 md:w-full" />)}
        </div>
        <Panel className="gap-5 p-4">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-5 w-64 max-w-full" />
          </div>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {times(6).map((index) => <Skeleton key={index} className="h-10 w-full" />)}
          </div>
        </Panel>
      </div>
    </Loading>
  );
}

export function PricingLoading() {
  return (
    <Loading status="Loading Pricing" reading>
      <HeaderSkeleton />
      <Panel title="Rates">
        <Rows count={8} />
      </Panel>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Panel title="A two-hour Call">
          <Rows count={6} />
        </Panel>
        <Panel title="Monthly cost and revenue">
          <Rows count={6} />
        </Panel>
      </div>
    </Loading>
  );
}

export function WorkspaceOverviewLoading() {
  return (
    <Loading status="Loading Workspace" reading>
      <HeaderSkeleton controls={3} />
      <StripSkeleton />
      <div className="grid items-start gap-5 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
          <ChartPanel title="Leads generated" />
          <Panel title="Recent Calls">
            <Rows count={5} />
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Routing health">
            <Rows count={3} />
          </Panel>
          <Panel title="Site">
            <Rows count={3} />
          </Panel>
          <Panel title="Call Flow">
            <Rows count={4} />
          </Panel>
        </div>
      </div>
    </Loading>
  );
}

export function SiteLoading() {
  return (
    <Loading status="Loading Site" reading>
      <HeaderSkeleton controls={3} />
      <Panel role="region" aria-label="Site preview" className="p-4">
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <Skeleton className="aspect-[16/10] w-full rounded-md" />
          <div className="grid content-start gap-3 sm:grid-cols-2">
            {times(6).map((index) => <Skeleton key={index} className="h-10 w-full" />)}
          </div>
        </div>
      </Panel>
      <StripSkeleton />
      <ChartPanel title="Traffic and Calls" />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Panel title="Top pages">
          <Rows count={5} />
        </Panel>
        <Panel title="Referrers">
          <Rows count={5} />
        </Panel>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Panel title="Performance">
          <Rows count={2} />
        </Panel>
        <Panel title="Search">
          <Rows count={4} />
        </Panel>
      </div>
    </Loading>
  );
}

export function FlowLoading() {
  return (
    <Loading status="Loading Call Flow" className="gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-5 w-24" />
        <div className="ml-auto flex items-center gap-2">
          {times(3).map((index) => <Skeleton key={index} className="h-9 w-28" />)}
        </div>
      </div>
      <Skeleton className="h-[40rem] w-full rounded-lg" />
    </Loading>
  );
}

export function CallDetailLoading() {
  return (
    <Loading status="Loading Call" className="min-h-[calc(100vh-6rem)] gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Skeleton className="size-9" />
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-5 w-24" />
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="size-9" />
          </div>
        </div>
        <Skeleton className="h-5 w-80 max-w-full" />
      </div>
      <Panel className="gap-3 p-4">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-4 w-56" />
      </Panel>
      <div className="grid flex-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel title="Transcript">
          <Rows count={8} />
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title="Call facts">
            <Rows count={6} />
          </Panel>
          <Panel title="Processing timeline" />
        </div>
      </div>
      <section aria-label="Recording" className="sticky bottom-0 z-10 -mx-6 -mb-6 border-t border-border bg-background px-6 py-3">
        <Skeleton className="h-16 w-full" />
      </section>
    </Loading>
  );
}
