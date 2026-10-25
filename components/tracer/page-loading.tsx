/**
 * -------------------------------------------------------------------------
 * @file   page-loading.tsx
 * @brief  Paints a page area at once while its data streams in.
 *
 * @description
 *  PageLoading is the shape most global pages settle into: a heading line,
 *  a row of three stat tiles, and one wide Frame. WorkspaceLoading is the
 *  shape of the Workspace Overview and Site page: the Workspace heading,
 *  the scorecard tiles, and two Frames side by side. Each route group's
 *  loading file re-exports one of them.
 *
 * @remarks
 *  Next prefetches a route group's loading fallback with the Sidebar links,
 *  so navigation never waits on the database to show something, and
 *  Skeletons keep their final sizes so the page does not shift when the data
 *  renders. The boundaries sit inside the route groups whose layouts decide
 *  authorization, so a denied page still answers with a real 404 before
 *  anything streams.
 *
 * @see
 *  app/(app)/(everyone)/loading.tsx
 *  app/(app)/(operator)/layout.tsx
 *  app/(app)/workspaces/[id]/layout.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { Frame, FramePanel } from "@/components/reui/frame";
import { Skeleton } from "@/components/ui/skeleton";

export function PageLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span role="status" className="sr-only">Loading page</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-5 w-80" />
      </div>
      <Frame className="grid gap-2 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <FramePanel key={index} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-20" />
          </FramePanel>
        ))}
      </Frame>
      <Frame>
        <FramePanel className="flex flex-col gap-3">
          {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-9 w-full" />)}
        </FramePanel>
      </Frame>
    </div>
  );
}

export function WorkspaceLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span role="status" className="sr-only">Loading Workspace</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-5 w-48" />
      </div>
      <Frame className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <FramePanel key={index} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-20" />
          </FramePanel>
        ))}
      </Frame>
      <div className="grid gap-6 lg:grid-cols-2">
        <Frame>
          <FramePanel className="flex flex-col gap-3">
            {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-9 w-full" />)}
          </FramePanel>
        </Frame>
        <Frame>
          <FramePanel className="flex flex-col gap-3">
            {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-9 w-full" />)}
          </FramePanel>
        </Frame>
      </div>
    </div>
  );
}
