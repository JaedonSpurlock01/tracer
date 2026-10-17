"use client";

/**
 * -------------------------------------------------------------------------
 * @file   error.tsx
 * @brief  Shows a Retry state when Call Detail fails to load.
 *
 * @description
 *  Replaces the Call Detail page with a short message and a Retry action
 *  that fetches and renders the Call again.
 *
 * @remarks
 *  The message stays free of infrastructure detail.
 *
 * @see
 *  node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { Frame, FramePanel } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";

export default function CallDetailError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <Frame>
      <FramePanel className="flex flex-col items-start gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-semibold">Call unavailable</h1>
          <p role="alert" className="text-sm text-muted-foreground">The Call could not be loaded.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => retry()}>
          Retry
        </Button>
      </FramePanel>
    </Frame>
  );
}
