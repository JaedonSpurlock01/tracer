/**
 * -------------------------------------------------------------------------
 * @file   graph-layout.ts
 * @brief  Derives canvas positions for a Call Flow from its tree.
 *
 * @description
 *  Lays the Call Flow tree out top-down: each step sits one layer below
 *  its parent and sibling branches fan out side by side, each subtree
 *  taking the width of its leaves. A shared target is placed once, where
 *  it is first reached. Unreachable nodes line up to the left of the tree
 *  so they stay visible until they are connected or deleted.
 *
 * @remarks
 *  Positions are presentational: the editor recomputes them on every
 *  change and never lets the Operator drag a node, so the picture is
 *  always tidy. The stored `position` on each node is only the last
 *  derived value, kept so the schema stays at version 1.
 *
 * @see
 *  data/call-flow.ts
 *  components/tracer/workspace-flow-editor.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { callFlowTree, type CallFlowGraph, type FlowPosition, type FlowTreeNode } from "@/data/call-flow";

export const FLOW_NODE_WIDTH = 208;
export const FLOW_NODE_HEIGHT = 56;
const GAP_X = 32;
const GAP_Y = 72;

export function layoutCallFlow(graph: CallFlowGraph): Map<string, FlowPosition> {
  const positions = new Map<string, FlowPosition>();
  const root = callFlowTree(graph);
  const width = (tree: FlowTreeNode): number => {
    const children = tree.branches.filter((branch) => branch.child && !branch.shared).map((branch) => width(branch.child!));
    return Math.max(FLOW_NODE_WIDTH, children.reduce((sum, w) => sum + w, 0) + Math.max(0, children.length - 1) * GAP_X);
  };
  const place = (tree: FlowTreeNode, left: number, depth: number): void => {
    positions.set(tree.node.id, { x: left + width(tree) / 2 - FLOW_NODE_WIDTH / 2, y: depth * (FLOW_NODE_HEIGHT + GAP_Y) });
    let cursor = left;
    for (const branch of tree.branches) {
      if (!branch.child || branch.shared) continue;
      place(branch.child, cursor, depth + 1);
      cursor += width(branch.child) + GAP_X;
    }
  };
  if (root) place(root, 0, 0);
  let stray = 0;
  for (const node of graph.nodes) {
    if (!positions.has(node.id)) positions.set(node.id, { x: -FLOW_NODE_WIDTH - GAP_X, y: stray++ * (FLOW_NODE_HEIGHT + GAP_Y) });
  }
  return positions;
}
