/**
 * -------------------------------------------------------------------------
 * @file   workspace-overview.tsx
 * @brief  Renders the Workspace Overview stub.
 *
 * @description
 *  Displays Workspace identity, lifecycle state, placeholders, and setup
 *  requirements before Call Flow publication exists.
 *
 * @remarks
 *  Tracking and Destination Number placeholders are intentionally explicit.
 *
 * @see
 *  data/workspace-policy.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import Link from "next/link";

import { Badge } from "@/components/reui/badge";
import { Frame, FramePanel } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import type { WorkspaceRecord } from "@/data/workspaces";
import { describeSetupChecklist } from "@/data/workspace-policy";

function stateVariant(state: WorkspaceRecord["state"]): "primary-light" | "success-light" | "destructive-light" {
  if (state === "Active") return "success-light";
  if (state === "Archived") return "destructive-light";
  return "primary-light";
}

export default function WorkspaceOverview({ workspace }: { workspace: WorkspaceRecord }) {
  const checklist = describeSetupChecklist(workspace);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1>
          <div className="mt-2 flex items-center gap-2">
            <Badge variant={stateVariant(workspace.state)}>{workspace.state}</Badge>
            <span className="text-sm text-muted-foreground">{workspace.reportingTimezone}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" render={<Link href={`/workspaces/${workspace.id}/settings`} />}>
            Workspace Settings
          </Button>
          {workspace.state === "Setup Required" ? (
            <Button render={<Link href={`/workspaces?resume=${workspace.id}`} />}>
              Resume Setup
            </Button>
          ) : null}
          {workspace.state === "Archived" ? (
            <Button render={<Link href={`/workspaces/${workspace.id}/settings#danger`} />}>
              Restore
            </Button>
          ) : null}
        </div>
      </div>
      <Frame>
        <FramePanel className="grid gap-5 sm:grid-cols-3">
          <div>
            <p className="text-sm text-muted-foreground">Tracking Number</p>
            <p>-</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Destination Number</p>
            <p>-</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Reporting timezone</p>
            <p>{workspace.reportingTimezone}</p>
          </div>
        </FramePanel>
      </Frame>
      {workspace.state === "Setup Required" ? (
        <Frame>
          <FramePanel className="flex flex-col gap-4">
            <div>
              <h2 className="font-semibold">Setup Required</h2>
              <p className="text-sm text-muted-foreground">
                Finish these requirements before the Workspace can become Active.
              </p>
            </div>
            <ul className="grid gap-2">
              {checklist.map((item) => (
                <li key={item.label} className="flex items-center gap-2 text-sm">
                  <span>{item.complete ? "Complete" : "Incomplete"}</span>
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          </FramePanel>
        </Frame>
      ) : null}
    </div>
  );
}
