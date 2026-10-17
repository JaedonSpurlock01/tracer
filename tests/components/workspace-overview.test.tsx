/**
 * -------------------------------------------------------------------------
 * @file   workspace-overview.test.tsx
 * @brief  Verifies Workspace routing health and Call Flow summary.
 *
 * @description
 *  Covers routing metadata, published flow steps, the Edit Flow link, and
 *  the Recent Calls list with its links to Call Detail and Empty state.
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
import { cleanup, render, screen, within } from "@testing-library/react";
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

    it("lists the published Call Flow in execution order with each branch outcome under its step", () => {
    render(
      <WorkspaceOverview
        workspace={workspace}
        flow={{
          published: {
            version: 1,
            graph: generateInitialCallFlow({
              destinationNumber: "+14155550101",
              recordingEnabled: false,
              spamGateEnabled: true,
              whisperEnabled: false,
              whisperMessage: null,
              disclosureVoice: "Polly.Joanna",
            }),
          },
        }}
      />,
    );
    const steps = within(screen.getByRole("list", { name: "Call Flow steps" })).getAllByRole("listitem").map((item) => item.textContent);
    expect(steps).toEqual([
      "Incoming Call",
      "Keypad Gate: press 1 to continue",
      "PassForward Call to +14155550101",
      "AnsweredOutcome: Answered",
      "MissedOutcome: Missed",
      "FailedOutcome: Failed",
      "BlockedOutcome: Blocked",
    ]);
  });

it("shows a read-only Overview without Operator actions for a Client Viewer", () => {
    render(<WorkspaceOverview workspace={{ ...workspace, state: "Archived" }} flow={{ published: null }} readOnly />);
    expect(screen.getByText("Routing health")).toBeVisible();
    expect(screen.getByText("Call Flow")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Edit Flow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Workspace Settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Restore" })).not.toBeInTheDocument();
  });

  it("lists Recent Calls with Call Outcome, caller, start time, and connected duration linking to Call Detail", () => {
    render(
      <WorkspaceOverview
        workspace={workspace}
        flow={{ published: null }}
        recentCalls={[
          { id: "call-2", callerNumber: "+13125550142", state: "Completed", outcome: "Answered", startedAt: "2026-10-16T20:04:05.000Z", connectedDurationSeconds: 83 },
          { id: "call-1", callerNumber: null, state: "In Progress", outcome: null, startedAt: "2026-10-16T19:00:00.000Z", connectedDurationSeconds: null },
        ]}
      />,
    );
    const recent = screen.getByRole("list", { name: "Recent Calls" });
    const rows = within(recent).getAllByRole("link");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("href", "/workspaces/workspace-1/calls/call-2");
    expect(rows[0]).toHaveTextContent("+13125550142");
    expect(rows[0]).toHaveTextContent("Answered");
    expect(rows[0]).toHaveTextContent("Oct 16, 2026, 3:04:05 PM");
    expect(rows[0]).toHaveTextContent("1:23");
    expect(rows[1]).toHaveTextContent("Unknown caller");
    expect(rows[1]).toHaveTextContent("In Progress");
    expect(screen.queryByRole("link", { name: "View Calls" })).not.toBeInTheDocument();
  });

  it("explains that Calls appear after the first inbound Call when the Workspace has none", () => {
    render(<WorkspaceOverview workspace={workspace} flow={{ published: null }} recentCalls={[]} />);
    expect(screen.getByText("Recent Calls")).toBeVisible();
    expect(screen.getByText("No Calls yet. Calls appear after the first inbound Call reaches the Tracking Number.")).toBeVisible();
  });
});
