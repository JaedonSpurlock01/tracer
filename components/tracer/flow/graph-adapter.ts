/**
 * -------------------------------------------------------------------------
 * @file   graph-adapter.ts
 * @brief  Converts Call Flow graphs to and from React Flow data.
 *
 * @description
 *  Keeps the pure domain graph independent from React Flow implementation
 *  details while preserving node data, positions, handles, and labels.
 *
 * @remarks
 *  Adapter functions are deterministic and contain no provider or browser work.
 *
 * @see
 *  data/call-flow.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Edge, Node } from "@xyflow/react";

import type { CallFlowGraph, FlowEdge, FlowNode } from "@/data/call-flow";

export function toReactFlow(graph: CallFlowGraph): { nodes: Node<FlowNode>[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((node) => ({ id: node.id, type: node.type, position: node.position, data: node })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      label: edge.sourceHandle,
    })),
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
