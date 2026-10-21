/**
 * -------------------------------------------------------------------------
 * @file   flow-summary.tsx
 * @brief  Renders a read-only, linearized Call Flow summary.
 *
 * @description
 *  Lists a Call Flow's steps in execution order, labeling each branch step
 *  with the branch that reaches it and indenting it under its parent step.
 *
 * @remarks
 *  The Create Workspace review uses this compact outline; Workspace Overview
 *  shows the richer FlowSpine instead. Both read the domain graph, never the
 *  editable canvas.
 *
 * @see
 *  data/call-flow.ts
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { Badge } from "@/components/reui/badge";
import { summarizeCallFlow, type CallFlowGraph } from "@/data/call-flow";

export default function FlowSummary({ graph }: { graph: CallFlowGraph }) {
  return (
    <ol aria-label="Call Flow steps" className="flex flex-col gap-1 text-sm">
      {summarizeCallFlow(graph).map((item, index) => (
        <li key={index} className="flex min-w-0 items-center gap-2" style={{ paddingInlineStart: `${item.depth * 1.25}rem` }}>
          {item.branch ? <Badge variant="outline">{item.branch}</Badge> : null}
          <span className="min-w-0 truncate">{item.label}</span>
        </li>
      ))}
    </ol>
  );
}
