/**
 * -------------------------------------------------------------------------
 * @file   loading.tsx
 * @brief  Shows Call Detail Skeletons while the Call loads.
 *
 * @description
 *  Mirrors the final Call Detail layout: the header, the Recording player
 *  Frame, the Call facts, and the processing timeline.
 *
 * @remarks
 *  Skeletons keep their final region sizes so the page does not shift when
 *  the Call renders.
 *
 * @see
 *  components/tracer/call-detail-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { Frame, FramePanel } from "@/components/reui/frame";
import { Skeleton } from "@/components/ui/skeleton";

export default function CallDetailLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span role="status" className="sr-only">Loading Call</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-72" />
      </div>
      <Frame variant="inverse">
        <FramePanel className="flex flex-col gap-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-8 w-full" />
        </FramePanel>
      </Frame>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Frame>
          <FramePanel className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 10 }, (_, index) => <Skeleton key={index} className="h-9 w-full" />)}
          </FramePanel>
        </Frame>
        <Frame>
          <FramePanel className="flex flex-col gap-4">
            {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-8 w-full" />)}
          </FramePanel>
        </Frame>
      </div>
    </div>
  );
}
