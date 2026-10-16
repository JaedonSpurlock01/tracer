/**
 * -------------------------------------------------------------------------
 * @file   workspace-overview.tsx
 * @brief  Renders the Workspace Overview and routing health.
 *
 * @description
 *  Displays Workspace identity, routing metadata, setup requirements, and the
 *  published Call Flow summary for Operators.
 *
 * @remarks
 *  Provider health and inbound Call metrics remain deferred to later milestones.
 *
 * @see
 *  data/workspace-routing.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import Link from "next/link";

import { Badge } from "@/components/reui/badge";
import { Frame, FramePanel } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { summarizeCallFlow, type CallFlowGraph } from "@/data/call-flow";
import type { WorkspaceRecord } from "@/data/workspaces";
import { describeSetupChecklist } from "@/data/workspace-policy";

interface WorkspaceOverviewProps {
  workspace: WorkspaceRecord;
  flow?: { published: { version: number; graph: CallFlowGraph } | null };
  readOnly?: boolean;
}

function stateVariant(state: WorkspaceRecord["state"]): "primary-light" | "success-light" | "destructive-light" {
  if (state === "Active") return "success-light";
  if (state === "Archived") return "destructive-light";
  return "primary-light";
}

export default function WorkspaceOverview({ workspace, flow, readOnly = false }: WorkspaceOverviewProps) {
  const checklist = describeSetupChecklist(workspace);
  const published = flow?.published ?? null;

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
        {readOnly ? null : <div className="flex gap-2">
          <Button variant="outline" render={<Link href={`/workspaces/${workspace.id}/settings`} />}>
            Workspace Settings
          </Button>
          {workspace.state === "Setup Required" ? (
            <Button render={<Link href={`/workspaces?resume=${workspace.id}`} />}>Resume Setup</Button>
          ) : null}
          {workspace.state === "Archived" ? (
            <Button render={<Link href={`/workspaces/${workspace.id}/settings#danger`} />}>Restore</Button>
          ) : null}
        </div>}
      </div>
      <Frame>
        <FramePanel className="grid gap-5 sm:grid-cols-3">
          <div>
            <p className="text-sm text-muted-foreground">Tracking Number</p>
            <p>{workspace.trackingNumber ?? "-"}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Destination Number</p>
            <p>{workspace.destinationNumber ?? "-"}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Reporting timezone</p>
            <p>{workspace.reportingTimezone}</p>
          </div>
        </FramePanel>
      </Frame>
      <Frame>
        <FramePanel>
          <h2 className="font-semibold">Routing health</h2>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <p>Tracking Number: {workspace.trackingNumber ?? "-"}</p>
            <p>Assignment start: {workspace.numberAssignmentStartedAt ?? "-"}</p>
            <p>Destination Number: {workspace.destinationNumber ?? "-"}</p>
            <p>Recording: {workspace.recordingEnabled ? "Enabled" : "Disabled"}</p>
            <p>Spam gate: {workspace.spamGateEnabled ? "Enabled" : "Disabled"}</p>
            <p>Whisper: {workspace.whisperEnabled ? workspace.whisperMessage || "Enabled" : "Disabled"}</p>
            <p>Call Flow published: {workspace.publishedFlowVersion?.publishedAt ?? "-"}</p>
            <p>Twilio webhook health and last inbound Call: Available in a later milestone</p>
          </div>
        </FramePanel>
      </Frame>
      <Frame>
        <FramePanel>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Call Flow</h2>
            {readOnly ? null : (
              <Button variant="outline" render={<Link href={`/workspaces/${workspace.id}/flow`} />}>
                Edit Flow
              </Button>
            )}
          </div>
          {published ? (
            <ol className="mt-4 list-decimal pl-5 text-sm">
              {summarizeCallFlow(published.graph).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No published Call Flow.</p>
          )}
        </FramePanel>
      </Frame>
      {workspace.state === "Setup Required" && !readOnly ? (
        <Frame>
          <FramePanel className="flex flex-col gap-4">
            <div>
              <h2 className="font-semibold">Setup Required</h2>
              <p className="text-sm text-muted-foreground">Finish these requirements before the Workspace can become Active.</p>
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
