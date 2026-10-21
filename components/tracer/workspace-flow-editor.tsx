"use client";

/**
 * -------------------------------------------------------------------------
 * @file   workspace-flow-editor.tsx
 * @brief  Renders the Workspace Call Flow editor.
 *
 * @description
 *  Provides read-only published views, editable drafts, palette insertion,
 *  autosave, live validation, publication, and version history for
 *  Operators. The canvas lays the flow out as a tree from the domain graph,
 *  so positions are derived and nodes are never dragged; the palette,
 *  inspector, and validation issues dock inside the canvas.
 *
 * @remarks
 *  Domain graphs remain the source of truth and React Flow is only the canvas
 *  interaction layer. Validation runs locally on every change; a server
 *  result (from a save or a rejected publish) replaces it only for the exact
 *  graph it was computed for, so a stale server verdict never masks an edit.
 *
 * @see
 *  data/call-flow.ts
 *  components/tracer/flow/graph-layout.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import "@xyflow/react/dist/style.css";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
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
import { XIcon } from "lucide-react";

import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fromReactFlow, styleFlowEdge, toReactFlow } from "@/components/tracer/flow/graph-adapter";
import { layoutCallFlow } from "@/components/tracer/flow/graph-layout";
import FlowNodeView, { FlowCanvasContext } from "@/components/tracer/flow/flow-nodes";
import FlowInspector from "@/components/tracer/flow/flow-inspector";
import { NodeIcon } from "@/components/tracer/flow/node-icon";
import { mutationFetch } from "@/components/tracer/mutation-fetch";
import {
  createFlowNode,
  describeFlowNode,
  flowNodeCatalog,
  nodeHandles,
  validateCallFlow,
  type CallFlowGraph,
  type FlowNode,
  type FlowNodeType,
  type ValidationIssue,
  type ValidationResult,
} from "@/data/call-flow";
import type { FlowState } from "@/data/workspace-routing";
import type { WorkspaceRecord } from "@/data/workspaces";

interface Props {
  workspace: WorkspaceRecord;
  initialFlow: FlowState;
}

const nodeTypes = Object.fromEntries(Object.keys(nodeHandles).map((type) => [type, FlowNodeView]));
const fitViewOptions = { padding: 0.2, maxZoom: 1 };

function EditorBody({ workspace, initialFlow }: Props) {
  const reactFlow = useReactFlow();
  const initialGraph = initialFlow.draft?.graph ?? initialFlow.published?.graph ?? null;
  const [editing, setEditing] = useState(Boolean(initialFlow.draft) && workspace.state !== "Archived");
  const [readOnlyVersion, setReadOnlyVersion] = useState<number | null>(initialFlow.published?.version ?? null);
  const [nodes, setNodes] = useState<Node<FlowNode>[]>(() => (initialGraph ? toReactFlow(initialGraph).nodes : []));
  const [edges, setEdges] = useState<Edge[]>(() => (initialGraph ? toReactFlow(initialGraph).edges : []));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [serverValidation, setServerValidation] = useState<{ graph: string; result: ValidationResult } | null>(null);
  const [saveState, setSaveState] = useState(initialFlow.draft ? "Saved" : "");
  const [status, setStatus] = useState("");
  const [versionDialog, setVersionDialog] = useState(false);
  const [discardDialog, setDiscardDialog] = useState(false);
  const [versions, setVersions] = useState(initialFlow.versions);

  // Positions are derived from the tree on every change; the stored position is only the last derived value.
  const positions = useMemo(() => layoutCallFlow(fromReactFlow(nodes, edges)), [nodes, edges]);
  const canvasNodes = useMemo(() => nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })), [nodes, positions]);
  const canvasEdges = useMemo(() => edges.map(styleFlowEdge), [edges]);
  const graph = useMemo(() => fromReactFlow(canvasNodes, edges), [canvasNodes, edges]);
  const serialized = useMemo(() => JSON.stringify(graph), [graph]);
  const lastSavedRef = useRef(serialized);

  const validation: ValidationResult | null = useMemo(() => {
    if (serverValidation?.graph === serialized) return serverValidation.result;
    if (editing) return validateCallFlow(graph, { recordingEnabled: initialFlow.recordingEnabled });
    return initialFlow.validation;
  }, [serverValidation, serialized, editing, graph, initialFlow.recordingEnabled, initialFlow.validation]);
  const issueCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of validation?.issues ?? []) if (issue.nodeId) counts.set(issue.nodeId, (counts.get(issue.nodeId) ?? 0) + 1);
    return counts;
  }, [validation]);

  const save = useCallback(
    async (nextGraph: CallFlowGraph, key: string) => {
      if (!editing || key === lastSavedRef.current) return;
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
      const body = (await response.json()) as { validation: ValidationResult };
      lastSavedRef.current = key;
      setServerValidation({ graph: key, result: body.validation });
      setSaveState("Saved");
    },
    [editing, workspace.id],
  );

  useEffect(() => {
    if (!editing) return;
    const timer = window.setTimeout(() => void save(graph, serialized), 800);
    return () => window.clearTimeout(timer);
  }, [editing, graph, serialized, save]);

  useEffect(() => {
    reactFlow.fitView(fitViewOptions);
  }, [nodes.length, reactFlow]);

  function updateNodes(changes: NodeChange[]) {
    setNodes(
      (current) =>
        applyNodeChanges(
          changes.filter((change) => change.type !== "remove" || current.find((node) => node.id === change.id)?.data.type !== "incoming_call"),
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
        { ...connection, id: `${connection.source}-${connection.sourceHandle}` },
        current.filter((edge) => !(edge.source === connection.source && edge.sourceHandle === connection.sourceHandle)),
      ),
    );
  }
  function setBranch(source: string, handle: string, targetId: string | null) {
    setEdges((current) => [
      ...current.filter((edge) => !(edge.source === source && edge.sourceHandle === handle)),
      ...(targetId && targetId !== source ? [{ id: `${source}-${handle}`, source, target: targetId, sourceHandle: handle }] : []),
    ]);
  }
  function loadGraph(next: CallFlowGraph | null) {
    const converted = next ? toReactFlow(next) : { nodes: [], edges: [] };
    setNodes(converted.nodes);
    setEdges(converted.edges);
    setSelectedId(null);
    setServerValidation(null);
  }
  async function beginEditing() {
    const response = await mutationFetch(`/api/workspaces/${workspace.id}/flow`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ graph }),
    });
    if (!response.ok) return;
    const body = (await response.json()) as { validation: ValidationResult };
    lastSavedRef.current = serialized;
    setServerValidation({ graph: serialized, result: body.validation });
    setEditing(true);
    setReadOnlyVersion(null);
  }
  async function publish() {
    const response = await mutationFetch(`/api/workspaces/${workspace.id}/flow/publish`, { method: "POST" });
    if (!response.ok) {
      if (response.status === 422) {
        const body = (await response.json()) as { issues?: ValidationIssue[] };
        if (body.issues) setServerValidation({ graph: serialized, result: { valid: false, issues: body.issues } });
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
    await mutationFetch(`/api/workspaces/${workspace.id}/flow`, { method: "DELETE" });
    setEditing(false);
    setDiscardDialog(false);
    loadGraph(initialFlow.published?.graph ?? null);
    setReadOnlyVersion(initialFlow.published?.version ?? null);
  }
  async function showVersion(version: number) {
    const response = await fetch(`/api/workspaces/${workspace.id}/flow/versions/${version}`);
    if (!response.ok) return;
    const body = (await response.json()) as { graph: CallFlowGraph };
    loadGraph(body.graph);
    setReadOnlyVersion(version);
    setVersionDialog(false);
    setEditing(false);
  }
  function addNode(type: FlowNodeType) {
    const next = createFlowNode(type, { destinationNumber: workspace.destinationNumber ?? "" });
    setNodes((current) => [...current, { id: next.id, type: next.type, position: next.position, data: next }]);
    setSelectedId(next.id);
  }
  function focusNode(id: string) {
    setSelectedId(id);
    reactFlow.fitView({ nodes: [{ id }], duration: 0 });
  }

  const selected = nodes.find((node) => node.id === selectedId)?.data;
  const hasDisclosure = nodes.some((node) => node.data.type === "recording_disclosure");
  const publishable = validation?.valid === true && workspace.state === "Active";
  const issues = validation?.issues ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={editing ? "primary-light" : "outline"}>{editing ? "Draft" : readOnlyVersion ? `Published v${readOnlyVersion}` : "No published version"}</Badge>
        {editing && initialFlow.draft?.basedOnVersion ? <span className="text-xs text-muted-foreground">based on v{initialFlow.draft.basedOnVersion}</span> : null}
        <span className="text-xs text-muted-foreground">{saveState}</span>
        {editing && validation ? (
          <Badge variant={validation.valid ? "success-light" : "warning-light"}>{validation.valid ? "Publishable" : `${issues.length} issue${issues.length === 1 ? "" : "s"}`}</Badge>
        ) : null}
        {workspace.state === "Setup Required" ? (
          <Link className="text-sm underline" href={`/workspaces?resume=${workspace.id}`}>
            Activation publishes the first version
          </Link>
        ) : null}
        {status ? <span role="status">{status}</span> : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setVersionDialog(true)}>
            Version history
          </Button>
          {editing ? (
            <Button variant="outline" onClick={() => setDiscardDialog(true)}>
              Discard Draft
            </Button>
          ) : workspace.state !== "Archived" && nodes.length ? (
            <Button variant="outline" onClick={() => void beginEditing()}>
              Edit Flow
            </Button>
          ) : null}
          <Button disabled={!publishable} onClick={() => void publish()}>
            Publish
          </Button>
        </div>
      </div>
      <div className="relative h-[40rem] overflow-hidden rounded-lg border bg-background">
        <FlowCanvasContext.Provider value={{ selectedId, issueCounts }}>
          <ReactFlow
            nodes={canvasNodes}
            edges={canvasEdges}
            nodeTypes={nodeTypes}
            onNodesChange={editing ? updateNodes : undefined}
            onEdgesChange={editing ? updateEdges : undefined}
            onConnect={editing ? connect : undefined}
            nodesDraggable={false}
            nodesConnectable={editing}
            elementsSelectable={editing}
            deleteKeyCode={editing ? "Backspace" : null}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            fitViewOptions={fitViewOptions}
          >
            <Background gap={16} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </FlowCanvasContext.Provider>
        <div className="absolute top-3 left-3 flex flex-wrap items-center gap-1 rounded-md border bg-card/90 p-1 backdrop-blur" aria-label="Nodes">
          <span className="px-1 text-xs text-muted-foreground">Add</span>
          {flowNodeCatalog.map((entry) => {
            const onlyOne = entry.type === "recording_disclosure" && hasDisclosure;
            return (
              <Button
                key={entry.type}
                size="xs"
                variant="ghost"
                aria-label={entry.title}
                title={onlyOne ? "Only one disclosure" : entry.hint}
                disabled={!editing || onlyOne}
                onClick={() => addNode(entry.type)}
              >
                <NodeIcon type={entry.type} className="size-3" />
                {entry.title}
              </Button>
            );
          })}
        </div>
        {selected ? (
          <div className="absolute top-3 right-3 bottom-3 w-80 overflow-y-auto rounded-md border bg-card">
            <Button size="icon-xs" variant="ghost" className="absolute top-2 right-2" aria-label="Close inspector" onClick={() => setSelectedId(null)}>
              <XIcon />
            </Button>
            <FlowInspector
              node={selected}
              nodes={nodes.map((candidate) => candidate.data)}
              issues={issues.filter((issue) => issue.nodeId === selected.id)}
              targets={Object.fromEntries(edges.filter((edge) => edge.source === selected.id).map((edge) => [edge.sourceHandle, edge.target]))}
              editing={editing}
              timeZone={workspace.reportingTimezone}
              onChange={(nextNode) => setNodes((current) => current.map((candidate) => (candidate.id === nextNode.id ? { ...candidate, data: nextNode } : candidate)))}
              onConnectHandle={(handle, targetId) => setBranch(selected.id, handle, targetId)}
              onDelete={() => {
                setNodes((current) => current.filter((candidate) => candidate.id !== selected.id));
                setEdges((current) => current.filter((edge) => edge.source !== selected.id && edge.target !== selected.id));
                setSelectedId(null);
              }}
            />
          </div>
        ) : null}
        {editing && issues.length ? (
          <ul className="absolute bottom-3 left-3 max-w-sm rounded-md border border-warning/40 bg-card/95 p-2 text-xs backdrop-blur" aria-label="Validation">
            {issues.map((issue) => {
              const targetId = issue.nodeId ?? (issue.edgeId ? edges.find((edge) => edge.id === issue.edgeId)?.source : undefined);
              const targetNode = nodes.find((node) => node.id === targetId)?.data;
              return (
                <li key={`${issue.code}-${issue.message}-${targetId ?? ""}`} className="flex items-baseline gap-1">
                  <button type="button" className="text-left hover:underline" onClick={() => targetId && focusNode(targetId)}>
                    {issue.message}
                  </button>
                  {targetNode ? <span className="text-muted-foreground">· {describeFlowNode(targetNode).title}</span> : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
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
