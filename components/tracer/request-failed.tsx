"use client";

/**
 * -------------------------------------------------------------------------
 * @file   request-failed.tsx
 * @brief  The page shown when a request fails on the server.
 *
 * @description
 *  Renders in place of a page whose server render threw. When the error's
 *  digest names a database that did not answer, the page says so and how
 *  long Tracer waited; otherwise it stays generic. Retry asks Next.js to
 *  render the failed segment again.
 *
 * @remarks
 *  Next.js scrubs server error messages before they reach the browser and
 *  keeps only the digest, so the digest is the one fact this page can
 *  rely on. The copy avoids infrastructure names.
 *
 * @see
 *  data/database-unavailable.ts
 *  app/error.tsx
 *  app/(app)/error.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { Frame, FramePanel } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { databaseUnavailableDigest } from "@/data/database-unavailable";

export interface RequestFailedProps {
  error: Error & { digest?: string };
  retry: () => void;
}

export default function RequestFailed({ error, retry }: RequestFailedProps) {
  const databaseUnavailable = error.digest === databaseUnavailableDigest;
  return (
    <Frame>
      <FramePanel className="flex flex-col items-start gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-semibold">{databaseUnavailable ? "The database did not answer" : "This page could not load"}</h1>
          <p role="alert" className="text-sm text-muted-foreground">
            {databaseUnavailable
              ? "Tracer waited 10 seconds for the database and gave up rather than hang. Retry in a moment."
              : "Something went wrong while loading this page. Retry, and if it keeps failing, note the time so the request can be found in the logs."}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => retry()}>
          Retry
        </Button>
      </FramePanel>
    </Frame>
  );
}
