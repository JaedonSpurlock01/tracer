/**
 * -------------------------------------------------------------------------
 * @file   workspace-flow-editor.test.tsx
 * @brief  Verifies the Workspace Flow editor interactions.
 *
 * @description
 *  Covers read-only views, editing, palette insertion, autosave, validation,
 *  publication, draft discard, version history, and business-hours overrides.
 *
 * @remarks
 *  React Flow is replaced with a small public interaction stub at the canvas
 *  boundary so these tests focus on editor behavior.
 *
 * @see
 *  components/tracer/workspace-flow-editor.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fitView = vi.fn();
vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return {
    ...actual,
    ReactFlow: ({
      nodes,
      children,
      onNodeClick,
      onNodesChange,
    }: {
      nodes: Array<{ id: string; data: unknown }>;
      children: React.ReactNode;
      onNodeClick?: (event: React.MouseEvent, node: unknown) => void;
      onNodesChange?: (changes: Array<{ type: "remove"; id: string }>) => void;
    }) => (
      <div data-testid="react-flow">
        <ul>
          {nodes.map((node) => (
            <li key={node.id}>
              <button type="button" onClick={(event) => onNodeClick?.(event, node)}>
                {node.id}
              </button>
              <button type="button" onClick={() => onNodesChange?.([{ type: "remove", id: node.id }])}>
                remove-{node.id}
              </button>
            </li>
          ))}
        </ul>
        {children}
      </div>
    ),
    Background: () => null,
    Controls: () => null,
    Handle: () => <span />,
    Position: { Top: "top", Bottom: "bottom" },
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useReactFlow: () => ({ fitView }),
  };
});

import WorkspaceFlowEditor from "@/components/tracer/workspace-flow-editor";
import { generateInitialCallFlow, type CallFlowGraph } from "@/data/call-flow";
import type { FlowState } from "@/data/workspace-routing";
import type { WorkspaceRecord } from "@/data/workspaces";

const workspace = {
  id: "workspace-1",
  name: "Phoenix Office",
  reportingTimezone: "America/Chicago",
  state: "Active" as const,
  destinationNumber: "+14155550101",
  trackingNumber: "+14155550100",
  numberAssignmentStartedAt: "2026-01-01T00:00:00.000Z",
  voiceRestoreNeeded: null,
  publishedFlowVersion: { version: 1, publishedAt: "2026-01-02T00:00:00.000Z" },
  hasDraft: false,
  recordingEnabled: false,
  analysisEnabled: false,
  spamGateEnabled: false,
  whisperEnabled: false,
  whisperMessage: null,
  createdBy: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
} satisfies WorkspaceRecord;
const graph = generateInitialCallFlow({
  destinationNumber: "+14155550101",
  recordingEnabled: false,
  spamGateEnabled: false,
  whisperEnabled: false,
  whisperMessage: null,
  disclosureVoice: "Polly.Joanna",
});
const invalidGraph: CallFlowGraph = { ...graph, edges: graph.edges.filter((edge) => edge.sourceHandle !== "missed") };

function flow(overrides: Partial<FlowState> = {}): FlowState {
  return {
    draft: null,
    validation: null,
    versions: [{ id: "version-1", version: 1, publishedAt: "2026-01-02T00:00:00.000Z", publishedBy: null }],
    published: { version: 1, graph },
    recordingEnabled: false,
    workspaceState: workspace.state,
    ...overrides,
  };
}

beforeEach(() => {
  fitView.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("WorkspaceFlowEditor", () => {
  it("shows a read-only published view and Edit Flow", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<WorkspaceFlowEditor workspace={workspace} initialFlow={flow()} />);
    expect(screen.getByText("Published v1")).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit Flow" })).toBeVisible();
  });

  it("derives tree positions so the Outcomes fan out side by side", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ validation: { valid: true, issues: [] } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    render(<WorkspaceFlowEditor workspace={workspace} initialFlow={flow()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Flow" }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { graph: CallFlowGraph };
    const outcomes = body.graph.nodes.filter((node) => node.type === "outcome");
    expect(new Set(outcomes.map((node) => node.position.x)).size).toBe(3);
    expect(new Set(outcomes.map((node) => node.position.y)).size).toBe(1);
  });

  it("PUTs the published graph when Edit Flow is selected", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ validation: { valid: true, issues: [] } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    render(<WorkspaceFlowEditor workspace={workspace} initialFlow={flow()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Flow" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspaces/workspace-1/flow",
        expect.objectContaining({ method: "PUT", body: expect.stringContaining('"version":1') }),
      ),
    );
  });

  it("adds a Keypad Gate and shows its Prompt inspector field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ validation: { valid: true, issues: [] } }), { status: 200 })),
    );
    render(
      <WorkspaceFlowEditor
        workspace={workspace}
        initialFlow={flow({
          draft: { graph, basedOnVersion: 1, updatedAt: "2026-01-02T00:00:00.000Z" },
          validation: { valid: true, issues: [] },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Keypad Gate" }));
    expect(await screen.findByLabelText("Prompt")).toBeVisible();
  });

  it("disables the disclosure palette entry when one exists", () => {
    const disclosure = generateInitialCallFlow({
      ...{
        destinationNumber: "+14155550101",
        recordingEnabled: true,
        spamGateEnabled: false,
        whisperEnabled: false,
        whisperMessage: null,
        disclosureVoice: "Polly.Joanna",
      },
    }).nodes.find((node) => node.type === "recording_disclosure");
    if (!disclosure) throw new Error("Expected disclosure");
    const graphWithDisclosure = { ...graph, nodes: [...graph.nodes, disclosure] };
    render(
      <WorkspaceFlowEditor
        workspace={workspace}
        initialFlow={flow({
          draft: { graph: graphWithDisclosure, basedOnVersion: 1, updatedAt: "2026-01-02T00:00:00.000Z" },
          validation: { valid: true, issues: [] },
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Recording Disclosure" })).toBeDisabled();
  });

  it("autosaves a changed forward destination", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ validation: { valid: true, issues: [] } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const draft = { graph, basedOnVersion: 1, updatedAt: "2026-01-02T00:00:00.000Z" };
    render(<WorkspaceFlowEditor workspace={workspace} initialFlow={flow({ draft, validation: { valid: true, issues: [] } })} />);
    fireEvent.click(screen.getByRole("button", { name: "forward" }));
    fireEvent.change(screen.getByLabelText("Destination Number"), { target: { value: "+14155550199" } });
    await vi.advanceTimersByTimeAsync(800);
    expect(fetch).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/flow",
      expect.objectContaining({ method: "PUT", body: expect.stringContaining("+14155550199") }),
    );
  });

  it("lists validation issues and selects the affected node", () => {
    render(
      <WorkspaceFlowEditor
        workspace={workspace}
        initialFlow={flow({
          draft: { graph: invalidGraph, basedOnVersion: 1, updatedAt: "2026-01-02T00:00:00.000Z" },
          validation: { valid: false, issues: [{ code: "missing_branch", message: "A required branch is missing.", nodeId: "forward" }] },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "A required branch is missing." }));
    expect(screen.getByRole("heading", { name: "Forward Call" })).toBeVisible();
    expect(fitView).toHaveBeenCalledWith(expect.objectContaining({ nodes: [{ id: "forward" }] }));
  });

  it("rewires a branch through the inspector", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ validation: { valid: true, issues: [] } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    render(
      <WorkspaceFlowEditor
        workspace={workspace}
        initialFlow={flow({
          draft: { graph, basedOnVersion: 1, updatedAt: "2026-01-02T00:00:00.000Z" },
          validation: { valid: true, issues: [] },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "forward" }));
    expect(screen.getByRole("combobox", { name: "answered" })).toHaveValue("outcome-answered");
    fireEvent.change(screen.getByRole("combobox", { name: "answered" }), { target: { value: "outcome-missed" } });
    await vi.advanceTimersByTimeAsync(800);
    expect(fetch).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/flow",
      expect.objectContaining({ body: expect.stringContaining('"target":"outcome-missed"') }),
    );
  });

  it("disables Publish for Setup Required and explains activation", () => {
    render(
      <WorkspaceFlowEditor
        workspace={{ ...workspace, state: "Setup Required" }}
        initialFlow={flow({
          workspaceState: "Setup Required",
          draft: { graph, basedOnVersion: null, updatedAt: "2026-01-02T00:00:00.000Z" },
          validation: { valid: true, issues: [] },
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(screen.getByText("Activation publishes the first version")).toBeVisible();
  });

  it("publishes an Active draft", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ workspace: { ...workspace, publishedFlowVersion: { version: 2, publishedAt: "2026-01-03T00:00:00.000Z" } } }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    render(
      <WorkspaceFlowEditor
        workspace={workspace}
        initialFlow={flow({
          draft: { graph, basedOnVersion: 1, updatedAt: "2026-01-02T00:00:00.000Z" },
          validation: { valid: true, issues: [] },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/workspaces/workspace-1/flow/publish", expect.objectContaining({ method: "POST" })),
    );
    expect(await screen.findByText("Version 2 published")).toBeVisible();
  });

  it("shows 422 publish issues and keeps editing", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ issues: [{ code: "missing_branch", message: "A required branch is missing." }] }), { status: 422 }),
    );
    vi.stubGlobal("fetch", fetch);
    render(
      <WorkspaceFlowEditor
        workspace={workspace}
        initialFlow={flow({
          draft: { graph, basedOnVersion: 1, updatedAt: "2026-01-02T00:00:00.000Z" },
          validation: { valid: true, issues: [] },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByText("A required branch is missing.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Discard Draft" })).toBeVisible();
  });

  it("discards a draft after confirmation", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    render(
      <WorkspaceFlowEditor
        workspace={workspace}
        initialFlow={flow({
          draft: { graph, basedOnVersion: 1, updatedAt: "2026-01-02T00:00:00.000Z" },
          validation: { valid: true, issues: [] },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard Draft" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard Draft" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/workspaces/workspace-1/flow", expect.objectContaining({ method: "DELETE" })),
    );
  });

  it("loads version history and shows its read-only banner", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ graph }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    render(<WorkspaceFlowEditor workspace={workspace} initialFlow={flow()} />);
    fireEvent.click(screen.getByRole("button", { name: "Version history" }));
    fireEvent.click(screen.getByRole("button", { name: "Version 1" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/workspaces/workspace-1/flow/versions/1"));
    expect(screen.getByText("Published v1")).toBeVisible();
  });

  it("adds a date override and shows times when Open is toggled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ validation: { valid: true, issues: [] } }), { status: 200 })),
    );
    const hours = generateInitialCallFlow({
      ...{
        destinationNumber: "+14155550101",
        recordingEnabled: false,
        spamGateEnabled: false,
        whisperEnabled: false,
        whisperMessage: null,
        disclosureVoice: "Polly.Joanna",
      },
    }).nodes;
    hours.push({
      id: "hours",
      type: "business_hours",
      position: { x: 0, y: 0 },
      weeklyWindows: [{ day: 1, start: "09:00", end: "17:00" }],
      dateOverrides: [],
    });
    render(
      <WorkspaceFlowEditor
        workspace={workspace}
        initialFlow={flow({
          draft: { graph: { version: 1, nodes: hours, edges: [] }, basedOnVersion: 1, updatedAt: "2026-01-02T00:00:00.000Z" },
          validation: { valid: true, issues: [] },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "hours" }));
    fireEvent.click(screen.getByRole("button", { name: "Add override" }));
    fireEvent.click(screen.getByRole("switch", { name: "Open" }));
    expect(screen.getAllByDisplayValue("09:00").length).toBeGreaterThan(1);
  });

  function renderDraft(extra: CallFlowGraph["nodes"]): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ validation: { valid: true, issues: [] } }), { status: 200 })),
    );
    render(
      <WorkspaceFlowEditor
        workspace={workspace}
        initialFlow={flow({
          draft: { graph: { version: 1, nodes: [...graph.nodes, ...extra], edges: graph.edges }, basedOnVersion: 1, updatedAt: "2026-01-02T00:00:00.000Z" },
          validation: { valid: true, issues: [] },
        })}
      />,
    );
  }

  it("edits Business Hours in the Workspace timezone and ends a window at 24:00", () => {
    renderDraft([{ id: "hours", type: "business_hours", position: { x: 0, y: 0 }, weeklyWindows: [{ day: 5, start: "22:00", end: "23:00" }], dateOverrides: [] }]);
    fireEvent.click(screen.getByRole("button", { name: "hours" }));
    expect(screen.getByText("Times use the America/Chicago timezone. Enter overnight hours as one window per day, ending at 24:00.")).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "Window 1 end" }), { target: { value: "24:00" } });
    expect(screen.getByRole("combobox", { name: "Window 1 end" })).toHaveValue("24:00");
    expect(screen.getByRole("combobox", { name: "Window 1 start" })).toHaveValue("22:00");
  });

  it("edits the Recording Disclosure message and offers sixteen voices", async () => {
    vi.useFakeTimers();
    renderDraft([{ id: "disclosure-node", type: "recording_disclosure", position: { x: 0, y: 0 }, message: "This call may be recorded for quality purposes.", voice: "Polly.Joanna" }]);
    fireEvent.click(screen.getByRole("button", { name: "disclosure-node" }));
    fireEvent.change(screen.getByLabelText("Disclosure"), { target: { value: "Calls are recorded for training." } });
    const voice = screen.getByRole("combobox", { name: "Voice" });
    expect(within(voice).getAllByRole("option")).toHaveLength(16);
    fireEvent.change(voice, { target: { value: "Polly.Brian" } });
    expect(within(voice).getByRole("option", { name: "Brian (British), male" })).toBeTruthy();

    await vi.advanceTimersByTimeAsync(800);
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/workspaces/workspace-1/flow",
      expect.objectContaining({ method: "PUT", body: expect.stringMatching(/"message":"Calls are recorded for training\.".*"voice":"Polly\.Brian"/) }),
    );
  });

  it("shows character guidance for a text-to-speech prompt", () => {
    renderDraft([{ id: "greeting-node", type: "voicemail", position: { x: 0, y: 0 }, greeting: "Leave a message.", voice: "Polly.Joanna" }]);
    fireEvent.click(screen.getByRole("button", { name: "greeting-node" }));
    expect(screen.getByText("16 / 500 characters")).toBeVisible();
  });

  it("previews a text-to-speech prompt with the browser voice as an approximation", () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    vi.stubGlobal("speechSynthesis", { speak, cancel });
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        lang = "";
        constructor(public text: string) {}
      },
    );
    renderDraft([{ id: "whisper-node", type: "whisper", position: { x: 0, y: 0 }, message: "Tracer lead", voice: "Polly.Matthew" }]);
    fireEvent.click(screen.getByRole("button", { name: "whisper-node" }));
    expect(screen.getByText("Preview uses your browser's voice, which only approximates Polly.Matthew.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(cancel).toHaveBeenCalled();
    expect(speak).toHaveBeenCalledWith(expect.objectContaining({ text: "Tracer lead", lang: "en-US" }));
  });

  it("keeps the Incoming Call node when a remove change targets it", () => {
    render(
      <WorkspaceFlowEditor
        workspace={workspace}
        initialFlow={flow({
          draft: { graph, basedOnVersion: 1, updatedAt: "2026-01-02T00:00:00.000Z" },
          validation: { valid: true, issues: [] },
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "incoming" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "remove-incoming" }));
    expect(screen.getByRole("button", { name: "incoming" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "remove-forward" }));
    expect(screen.queryByRole("button", { name: "forward" })).toBeNull();
  });

  it("resets the canvas to the published graph after discard", async () => {
    const published = graph;
    const draft = {
      ...graph,
      nodes: [...graph.nodes, { id: "draft-only", type: "outcome" as const, position: { x: 40, y: 40 }, outcome: "Blocked" as const }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    render(
      <WorkspaceFlowEditor
        workspace={workspace}
        initialFlow={flow({
          draft: { graph: draft, basedOnVersion: 1, updatedAt: "2026-01-02T00:00:00.000Z" },
          validation: { valid: true, issues: [] },
          published: { version: 1, graph: published },
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "draft-only" })).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: "Discard Draft" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Discard Draft" }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("button", { name: "draft-only" })).toBeNull();
    expect(screen.getByRole("button", { name: "incoming" })).toBeVisible();
  });

  it("lists the new version in Version history after publishing", async () => {
    const fetch = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      if (url.endsWith("/flow/publish"))
        return new Response(
          JSON.stringify({ workspace: { ...workspace, publishedFlowVersion: { version: 2, publishedAt: "2026-01-03T00:00:00.000Z" } } }),
          { status: 200 },
        );
      if (url.endsWith("/flow") && init?.method !== "PUT")
        return new Response(
          JSON.stringify({
            ...flow(),
            versions: [{ id: "version-2", version: 2, publishedAt: "2026-01-03T00:00:00.000Z", publishedBy: null }, ...flow().versions],
          }),
          { status: 200 },
        );
      return new Response(JSON.stringify({ validation: { valid: true, issues: [] } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    render(
      <WorkspaceFlowEditor
        workspace={workspace}
        initialFlow={flow({
          draft: { graph, basedOnVersion: 1, updatedAt: "2026-01-02T00:00:00.000Z" },
          validation: { valid: true, issues: [] },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await screen.findByText("Version 2 published");
    fireEvent.click(screen.getByRole("button", { name: "Version history" }));
    expect(screen.getByRole("button", { name: "Version 2" })).toBeVisible();
  });

  it("does not autosave an unchanged graph on mount", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ validation: { valid: true, issues: [] } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    render(
      <WorkspaceFlowEditor
        workspace={workspace}
        initialFlow={flow({
          draft: { graph, basedOnVersion: 1, updatedAt: "2026-01-02T00:00:00.000Z" },
          validation: { valid: true, issues: [] },
        })}
      />,
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).not.toHaveBeenCalledWith("/api/workspaces/workspace-1/flow", expect.objectContaining({ method: "PUT" }));
  });

  it("saves an outcome kind change", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ validation: { valid: true, issues: [] } }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    render(
      <WorkspaceFlowEditor
        workspace={workspace}
        initialFlow={flow({
          draft: { graph, basedOnVersion: 1, updatedAt: "2026-01-02T00:00:00.000Z" },
          validation: { valid: true, issues: [] },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "outcome-answered" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Outcome" }), { target: { value: "Blocked" } });
    await vi.advanceTimersByTimeAsync(800);
    expect(fetch).toHaveBeenCalledWith(
      "/api/workspaces/workspace-1/flow",
      expect.objectContaining({ body: expect.stringContaining('"outcome":"Blocked"') }),
    );
  });
});
