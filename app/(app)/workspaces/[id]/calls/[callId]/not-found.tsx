/**
 * -------------------------------------------------------------------------
 * @file   not-found.tsx
 * @brief  Explains a Call that cannot be shown.
 *
 * @description
 *  Renders when the Call does not exist or its Workspace is not readable by
 *  the actor, with a link back to Workspaces.
 *
 * @remarks
 *  Missing and unauthorized Calls share this page so it never reveals
 *  whether a Call exists in an ungranted Workspace.
 *
 * @see
 *  app/(app)/workspaces/[id]/calls/[callId]/page.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import Link from "next/link";

import { Frame, FramePanel } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";

export default function CallNotFound() {
  return (
    <Frame>
      <FramePanel className="flex flex-col items-start gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-semibold">Call not found</h1>
          <p className="text-sm text-muted-foreground">This Call does not exist or you do not have access to it.</p>
        </div>
        <Button variant="outline" render={<Link href="/workspaces" />}>
          Workspaces
        </Button>
      </FramePanel>
    </Frame>
  );
}
