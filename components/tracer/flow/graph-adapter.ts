/**
 * -------------------------------------------------------------------------
 * @file   graph-adapter.ts
 * @brief  Converts Call Flow graphs to and from React Flow data.
 *
 * @description
 *  Keeps the pure domain graph independent from React Flow implementation
 *  details while preserving node data, positions, handles, and labels, and
 *  styles each edge by its branch tone.
 *
 * @remarks
 *  Adapter functions are deterministic and contain no provider or browser work.
 *  Edge styling lives here, not on the stored edge, so edges created by a
 *  canvas connection and edges loaded from a graph look the same.
 *
 * @see
 *  data/call-flow.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { MarkerType, type Edge, type Node } from "@xyflow/react";

import { toneColor } from "@/components/tracer/flow/flow-tones";
import { branchLabels, branchTones, type CallFlowGraph, type EdgeHandle, type FlowEdge, type FlowNode } from "@/data/call-flow";

export function toReactFlow(graph: CallFlowGraph): { nodes: Node<FlowNode>[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((node) => ({ id: node.id, type: node.type, position: node.position, data: node })),
    edges: graph.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle })),
  };
}

export function fromReactFlow(nodes: Node<FlowNode>[], edges: Edge[]): CallFlowGraph {
  return {
    version: 1,
    nodes: nodes.map((node) => ({ ...node.data, id: node.id, position: node.position })),
    edges: edges.map(
      (edge): FlowEdge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle as FlowEdge["sourceHandle"],
      }),
    ),
  };
}

/** Applies the branch label, tone color, and arrow for rendering; `next` edges stay unlabeled. */
export function styleFlowEdge(edge: Edge): Edge {
  const handle = edge.sourceHandle as EdgeHandle;
  const color = toneColor[branchTones[handle] ?? "neutral"];
  return {
    ...edge,
    type: "smoothstep",
    label: branchLabels[handle] ?? undefined,
    labelStyle: { fill: color, fontSize: 10, fontWeight: 600 },
    labelBgStyle: { fill: "var(--color-card)" },
    labelBgPadding: [6, 2],
    labelBgBorderRadius: 2,
    style: { stroke: color, strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color },
  };
}
