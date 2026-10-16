/**
 * -------------------------------------------------------------------------
 * @file   workspace-overview.test.tsx
 * @brief  Verifies Workspace routing health and Call Flow summary.
 *
 * @description
 *  Covers routing metadata, published flow steps, and the Edit Flow link.
 *
 * @remarks
 *  Overview tests use the public component boundary.
 *
 * @see
 *  components/tracer/workspace-overview.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import WorkspaceOverview from "@/components/tracer/workspace-overview";
import { generateInitialCallFlow } from "@/data/call-flow";

const workspace = {
  id: "workspace-1",
  name: "Phoenix Office",
  reportingTimezone: "America/Chicago",
  state: "Active" as const,
  destinationNumber: "+14155550101",
  trackingNumber: "+14155550100",
  numberAssignmentStartedAt: "2026-01-01T00:00:00.000Z",
  publishedFlowVersion: { version: 1, publishedAt: "2026-01-02T00:00:00.000Z" },
  hasDraft: false,
  recordingEnabled: true,
  analysisEnabled: false,
  spamGateEnabled: true,
  whisperEnabled: false,
  whisperMessage: null,
  createdBy: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
};

afterEach(() => cleanup());

describe("WorkspaceOverview", () => {
  it("renders routing health, Call Flow steps, and Edit Flow link", () => {
    render(
      <WorkspaceOverview
        workspace={workspace}
        flow={{
          published: {
            version: 1,
            graph: generateInitialCallFlow({
              destinationNumber: "+14155550101",
              recordingEnabled: false,
              spamGateEnabled: false,
              whisperEnabled: false,
              whisperMessage: null,
              disclosureVoice: "Polly.Joanna",
            }),
          },
        }}
      />,
    );
    expect(screen.getByText("+14155550100")).toBeVisible();
    expect(screen.getByText("+14155550101")).toBeVisible();
    expect(screen.getByText("Routing health")).toBeVisible();
    expect(screen.getByText("Incoming Call")).toBeVisible();
    expect(screen.getByRole("link", { name: "Edit Flow" })).toHaveAttribute("href", "/workspaces/workspace-1/flow");
  });

  it("shows a read-only Overview without Operator actions for a Client Viewer", () => {
    render(<WorkspaceOverview workspace={{ ...workspace, state: "Archived" }} flow={{ published: null }} readOnly />);
    expect(screen.getByText("Routing health")).toBeVisible();
    expect(screen.getByText("Call Flow")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Edit Flow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Workspace Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Restore" })).not.toBeInTheDocument();
  });
});
