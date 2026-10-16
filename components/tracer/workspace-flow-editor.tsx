"use client";

/**
 * -------------------------------------------------------------------------
 * @file   workspace-flow-editor.tsx
 * @brief  Renders the Workspace Call Flow editor.
 *
 * @description
 *  Provides read-only published views, editable drafts, palette insertion,
 *  autosave, validation, publication, and version history for Operators.
 *
 * @remarks
 *  Domain graphs remain the source of truth and React Flow is only the canvas
 *  interaction layer.
 *
 * @see
 *  data/call-flow.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import "@xyflow/react/dist/style.css";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";

import { Badge } from "@/components/reui/badge";
import { Frame, FramePanel } from "@/components/reui/frame";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fromReactFlow, toReactFlow } from "@/components/tracer/flow/graph-adapter";
import FlowNodeView from "@/components/tracer/flow/flow-nodes";
import FlowInspector from "@/components/tracer/flow/flow-inspector";
import { validateCallFlow, type CallFlowGraph, type FlowNode, type FlowNodeType, type ValidationIssue } from "@/data/call-flow";
import type { FlowState } from "@/data/workspace-routing";
import type { WorkspaceRecord } from "@/data/workspaces";

interface Props {
  workspace: WorkspaceRecord;
  initialFlow: FlowState;
}

function defaultNode(type: FlowNodeType, workspace: WorkspaceRecord, offset: number): FlowNode {
  const position = { x: offset, y: offset };
  if (type === "incoming_call") return { id: `incoming-${crypto.randomUUID()}`, type, position };
  if (type === "recording_disclosure") return { id: `disclosure-${crypto.randomUUID()}`, type, position, voice: "Polly.Joanna" };
  if (type === "business_hours")
    return {
      id: `hours-${crypto.randomUUID()}`,
      type,
      position,
      weeklyWindows: [
        { day: 1, start: "09:00", end: "17:00" },
        { day: 2, start: "09:00", end: "17:00" },
        { day: 3, start: "09:00", end: "17:00" },
        { day: 4, start: "09:00", end: "17:00" },
        { day: 5, start: "09:00", end: "17:00" },
      ],
      dateOverrides: [],
    };
  if (type === "keypad_gate")
    return {
      id: `gate-${crypto.randomUUID()}`,
      type,
      position,
      prompt: "Press 1 to be connected.",
      voice: "Polly.Joanna",
      digit: "1",
      timeoutSeconds: 10,
    };
  if (type === "forward_call")
    return {
      id: `forward-${crypto.randomUUID()}`,
      type,
      position,
      destinationNumber: workspace.destinationNumber ?? "",
      timeoutSeconds: 30,
    };
  if (type === "whisper") return { id: `whisper-${crypto.randomUUID()}`, type, position, message: "", voice: "Polly.Joanna" };
  if (type === "voicemail")
    return {
      id: `voicemail-${crypto.randomUUID()}`,
      type,
      position,
      greeting: "Please leave a message after the tone.",
      voice: "Polly.Joanna",
    };
  return { id: `outcome-${crypto.randomUUID()}`, type: "outcome", position, outcome: "Answered" };
}

function EditorBody({ workspace, initialFlow }: Props) {
  const reactFlow = useReactFlow();
  const initialGraph = initialFlow.draft?.graph ?? initialFlow.published?.graph ?? null;
  const [graph, setGraph] = useState<CallFlowGraph | null>(initialGraph);
  const [editing, setEditing] = useState(Boolean(initialFlow.draft) && workspace.state !== "Archived");
  const [readOnlyVersion, setReadOnlyVersion] = useState<number | null>(initialFlow.published?.version ?? null);
  const [nodes, setNodes] = useState<Node<FlowNode>[]>(() => (initialGraph ? toReactFlow(initialGraph).nodes : []));
  const [edges, setEdges] = useState<Edge[]>(() => (initialGraph ? toReactFlow(initialGraph).edges : []));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [validation, setValidation] = useState(initialFlow.validation);
  const [saveState, setSaveState] = useState(initialFlow.draft ? "Saved" : "");
  const [status, setStatus] = useState("");
  const [versionDialog, setVersionDialog] = useState(false);
  const [discardDialog, setDiscardDialog] = useState(false);
  const [versions, setVersions] = useState(initialFlow.versions);
  const lastSavedRef = useRef(
    initialGraph ? JSON.stringify(fromReactFlow(toReactFlow(initialGraph).nodes, toReactFlow(initialGraph).edges)) : "",
  );

  const graphFromState = useCallback((nextNodes: Node<FlowNode>[], nextEdges: Edge[]) => fromReactFlow(nextNodes, nextEdges), []);
  const save = useCallback(
    async (nextGraph: CallFlowGraph) => {
      if (!editing) return;
      const serialized = JSON.stringify(nextGraph);
      if (serialized === lastSavedRef.current) return;
      setSaveState("Saving...");
      const response = await fetch(`/api/workspaces/${workspace.id}/flow`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ graph: nextGraph }),
      }).catch(() => null);
      if (!response?.ok) {
        setSaveState("Save failed");
        return;
      }
      const body = (await response.json()) as { validation: FlowState["validation"] };
      lastSavedRef.current = serialized;
      setGraph(nextGraph);
      setValidation(body.validation);
      setSaveState("Saved");
    },
    [editing, workspace.id],
  );

  useEffect(() => {
    if (!editing) return;
    const nextGraph = graphFromState(nodes, edges);
    const timer = window.setTimeout(() => void save(nextGraph), 800);
    return () => window.clearTimeout(timer);
  }, [edges, graphFromState, nodes, save, editing]);

  function updateNodes(changes: NodeChange[]) {
    setNodes(
      (current) =>
        applyNodeChanges(
          changes.filter(
            (change) => change.type !== "remove" || current.find((node) => node.id === change.id)?.data.type !== "incoming_call",
          ),
          current,
        ) as Node<FlowNode>[],
    );
  }
  function updateEdges(changes: EdgeChange[]) {
    setEdges((current) => applyEdgeChanges(changes, current));
  }
  function connect(connection: Connection) {
    const targetNode = nodes.find((node) => node.id === connection.target);
    if (!connection.sourceHandle || connection.source === connection.target || targetNode?.data.type === "incoming_call") return;
    setEdges((current) =>
      addEdge(
        {
          ...connection,
          id: `${connection.source}-${connection.sourceHandle}`,
          label: connection.sourceHandle,
          markerEnd: { type: MarkerType.ArrowClosed },
        },
        current.filter((edge) => !(edge.source === connection.source && edge.sourceHandle === connection.sourceHandle)),
      ),
    );
  }
  async function beginEditing() {
    if (!graph) return;
    const response = await fetch(`/api/workspaces/${workspace.id}/flow`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ graph }),
    });
    if (!response.ok) return;
    const body = (await response.json()) as { validation: FlowState["validation"] };
    setValidation(body.validation);
    setEditing(true);
    setReadOnlyVersion(null);
  }
  async function publish() {
    const response = await fetch(`/api/workspaces/${workspace.id}/flow/publish`, { method: "POST" });
    if (!response.ok) {
      if (response.status === 422) {
        const body = (await response.json()) as { issues?: ValidationIssue[] };
        setValidation(body.issues ? { valid: false, issues: body.issues } : validation);
        setStatus("Draft is not publishable");
      } else {
        setStatus("Publish failed. The published version is unchanged.");
      }
      return;
    }
    const body = (await response.json()) as { workspace: WorkspaceRecord };
    setStatus(`Version ${body.workspace.publishedFlowVersion?.version ?? ""} published`);
    const refreshed = await fetch(`/api/workspaces/${workspace.id}/flow`).catch(() => null);
    if (refreshed?.ok) {
      const refreshedFlow = (await refreshed.json()) as FlowState;
      if (Array.isArray(refreshedFlow.versions)) setVersions(refreshedFlow.versions);
    }
    setEditing(false);
    setReadOnlyVersion(body.workspace.publishedFlowVersion?.version ?? null);
  }
  async function discard() {
    await fetch(`/api/workspaces/${workspace.id}/flow`, { method: "DELETE" });
    setEditing(false);
    setDiscardDialog(false);
    const publishedGraph = initialFlow.published?.graph ?? null;
    setGraph(publishedGraph);
    const publishedReactFlow = publishedGraph ? toReactFlow(publishedGraph) : { nodes: [], edges: [] };
    setNodes(publishedReactFlow.nodes);
    setEdges(publishedReactFlow.edges);
    setReadOnlyVersion(initialFlow.published?.version ?? null);
  }
  async function showVersion(version: number) {
    const response = await fetch(`/api/workspaces/${workspace.id}/flow/versions/${version}`);
    if (!response.ok) return;
    const body = (await response.json()) as { graph: CallFlowGraph };
    setGraph(body.graph);
    const converted = toReactFlow(body.graph);
    setNodes(converted.nodes);
    setEdges(converted.edges);
    setReadOnlyVersion(version);
    setVersionDialog(false);
    setEditing(false);
  }
  function addNode(type: FlowNodeType) {
    const next = defaultNode(type, workspace, nodes.length * 30);
    setNodes((current) => [...current, { id: next.id, type: next.type, position: next.position, data: next }]);
    setSelectedId(next.id);
  }
  const selected = nodes.find((node) => node.id === selectedId)?.data;
  const catalog: Array<[FlowNodeType, string]> = [
    ["incoming_call", "Fixed start"],
    ["recording_disclosure", "Required when recording"],
    ["business_hours", "Open and closed routing"],
    ["keypad_gate", "Caller keypad gate"],
    ["forward_call", "Destination routing"],
    ["whisper", "Business whisper"],
    ["voicemail", "Caller voicemail"],
    ["outcome", "Terminal outcome"],
  ];
  const hasDisclosure = nodes.some((node) => node.data.type === "recording_disclosure");
  const publishable = validation?.valid === true && workspace.state === "Active";
  const selectedIssues = validation?.issues.filter((issue) => issue.nodeId === selectedId) ?? [];

  return (
    <div className="flex min-h-[36rem] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{editing ? "Draft" : readOnlyVersion ? `Published v${readOnlyVersion}` : "No published version"}</Badge>
        <span className="text-sm text-muted-foreground">{saveState}</span>
        <Button
          variant="outline"
          onClick={() => setValidation(validateCallFlow(fromReactFlow(nodes, edges), { recordingEnabled: initialFlow.recordingEnabled }))}
        >
          Validate
        </Button>
        <Button variant="outline" onClick={() => setVersionDialog(true)}>
          Version history
        </Button>
        {editing ? (
          <Button variant="outline" onClick={() => setDiscardDialog(true)}>
            Discard Draft
          </Button>
        ) : workspace.state !== "Archived" && graph ? (
          <Button variant="outline" onClick={() => void beginEditing()}>
            Edit Flow
          </Button>
        ) : null}
        <Button disabled={!publishable} onClick={() => void publish()}>
          Publish
        </Button>
        {workspace.state === "Setup Required" ? (
          <Link className="text-sm underline" href={`/workspaces?resume=${workspace.id}`}>
            Activation publishes the first version
          </Link>
        ) : null}
        {status ? <span role="status">{status}</span> : null}
      </div>
      <div className="grid flex-1 gap-3 lg:grid-cols-[13rem_1fr_18rem]">
        <Frame>
          <FramePanel>
            <h2 className="font-semibold">Nodes</h2>
            <div className="mt-3 grid gap-2">
              {catalog.map(([type, description]) => {
                const disabled = type === "incoming_call" || (type === "recording_disclosure" && hasDisclosure);
                return (
                  <Button key={type} aria-label={type} variant="outline" disabled={!editing || disabled} onClick={() => addNode(type)}>
                    {type.replaceAll("_", " ")}
                    <span className="block text-xs text-muted-foreground">
                      {disabled ? (type === "incoming_call" ? "Already present" : "Only one disclosure") : description}
                    </span>
                  </Button>
                );
              })}
            </div>
          </FramePanel>
        </Frame>
        <div className="min-h-96 rounded-md border">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={{
              incoming_call: FlowNodeView,
              recording_disclosure: FlowNodeView,
              business_hours: FlowNodeView,
              keypad_gate: FlowNodeView,
              forward_call: FlowNodeView,
              whisper: FlowNodeView,
              voicemail: FlowNodeView,
              outcome: FlowNodeView,
            }}
            onNodesChange={editing ? updateNodes : undefined}
            onEdgesChange={editing ? updateEdges : undefined}
            onConnect={editing ? connect : undefined}
            nodesDraggable={editing}
            nodesConnectable={editing}
            elementsSelectable={editing}
            deleteKeyCode={editing ? "Backspace" : null}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
        <FlowInspector
          node={selected}
          nodes={nodes.map((candidate) => candidate.data)}
          issues={selectedIssues}
          editing={editing}
          timeZone={workspace.reportingTimezone}
          onChange={(nextNode) =>
            setNodes((current) => current.map((candidate) => (candidate.id === nextNode.id ? { ...candidate, data: nextNode } : candidate)))
          }
          onConnectHandle={(handle, targetId) => {
            if (!selectedId || !targetId || targetId === selectedId || targetId === "incoming") {
              setEdges((current) => current.filter((edge) => !(edge.source === selectedId && edge.sourceHandle === handle)));
              return;
            }
            setEdges((current) => [
              ...current.filter((edge) => !(edge.source === selectedId && edge.sourceHandle === handle)),
              { id: `${selectedId}-${handle}`, source: selectedId, target: targetId, sourceHandle: handle, label: handle },
            ]);
          }}
          onDelete={() => {
            if (!selectedId) return;
            setNodes((current) => current.filter((candidate) => candidate.id !== selectedId));
            setEdges((current) => current.filter((edge) => edge.source !== selectedId && edge.target !== selectedId));
            setSelectedId(null);
          }}
        />
      </div>
      {validation?.issues?.length ? (
        <Frame>
          <FramePanel>
            <h2 className="font-semibold">Validation</h2>
            <ul className="mt-2 grid gap-1 text-sm">
              {validation.issues.map((issue) => {
                const targetId = issue.nodeId ?? (issue.edgeId ? edges.find((edge) => edge.id === issue.edgeId)?.source : undefined);
                return (
                  <li key={`${issue.code}-${issue.message}`}>
                    <button
                      type="button"
                      className="text-left underline"
                      onClick={() => {
                        if (targetId) {
                          setSelectedId(targetId);
                          reactFlow.fitView({ nodes: [{ id: targetId }], duration: 0 });
                        }
                      }}
                    >
                      {issue.message}
                    </button>
                  </li>
                );
              })}
            </ul>
          </FramePanel>
        </Frame>
      ) : validation ? (
        <p>Valid</p>
      ) : null}
      <Dialog open={versionDialog} onOpenChange={setVersionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Version history</DialogTitle>
          </DialogHeader>
          {versions.map((version) => (
            <Button key={version.version} variant="outline" onClick={() => void showVersion(version.version)}>
              Version {version.version}
            </Button>
          ))}
        </DialogContent>
      </Dialog>
      <Dialog open={discardDialog} onOpenChange={setDiscardDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard Draft?</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardDialog(false)}>
              Cancel
            </Button>
            <Button onClick={() => void discard()}>Discard Draft</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function WorkspaceFlowEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <EditorBody {...props} />
    </ReactFlowProvider>
  );
}
