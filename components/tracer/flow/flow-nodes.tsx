/**
 * -------------------------------------------------------------------------
 * @file   flow-nodes.tsx
 * @brief  Renders custom Call Flow nodes for React Flow.
 *
 * @description
 *  Shows each step's icon, title, and detail line from the domain
 *  description, an Outcome Badge in its tone, an issue count, the selected
 *  ring, and a tone-colored source handle per branch.
 *
 * @remarks
 *  Node rendering is intentionally presentational so graph rules stay in the
 *  Call Flow domain validator. Selection and issue counts arrive through
 *  FlowCanvasContext because React Flow owns the node props.
 *
 * @see
 *  data/call-flow.ts
 *  components/tracer/workspace-flow-editor.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { createContext, useContext } from "react";

import { Badge } from "@/components/reui/badge";
import { toneBadge, toneColor } from "@/components/tracer/flow/flow-tones";
import { NodeIcon } from "@/components/tracer/flow/node-icon";
import { FLOW_NODE_WIDTH } from "@/components/tracer/flow/graph-layout";
import { branchTones, describeFlowNode, nodeHandles, outcomeTones, type FlowNode } from "@/data/call-flow";

export const FlowCanvasContext = createContext<{ selectedId: string | null; issueCounts: ReadonlyMap<string, number> }>({
  selectedId: null,
  issueCounts: new Map(),
});

export default function FlowNodeView({ data: rawData }: NodeProps) {
  const data = rawData as unknown as FlowNode;
  const { selectedId, issueCounts } = useContext(FlowCanvasContext);
  const { title, detail } = describeFlowNode(data);
  const issues = issueCounts.get(data.id) ?? 0;
  const selected = selectedId === data.id;
  const handles = nodeHandles[data.type];
  return (
    <div
      style={{ width: FLOW_NODE_WIDTH }}
      data-testid={`flow-node-${data.id}`}
      className={`rounded-md border bg-card px-3 py-2 text-xs transition-colors ${selected ? "border-primary ring-2 ring-primary/30" : issues ? "border-destructive" : "border-border"}`}
    >
      {data.type !== "incoming_call" && <Handle type="target" position={Position.Top} className="!size-2" isConnectable />}
      <div className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-muted text-foreground">
          <NodeIcon type={data.type} className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <strong className="truncate">{title}</strong>
            {data.type === "outcome" ? (
              <Badge size="xs" variant={toneBadge[outcomeTones[data.outcome]]}>
                {data.outcome}
              </Badge>
            ) : null}
            {issues ? (
              <Badge size="xs" variant="destructive-light" aria-label={`${issues} issue${issues === 1 ? "" : "s"}`}>
                {issues}
              </Badge>
            ) : null}
          </div>
          {data.type !== "outcome" ? <span className="block truncate text-muted-foreground">{detail}</span> : null}
        </div>
      </div>
      {handles.map((handle, index) => (
        <Handle
          key={handle}
          id={handle}
          type="source"
          position={Position.Bottom}
          className="!size-2"
          style={{ left: `${((index + 1) / (handles.length + 1)) * 100}%`, background: toneColor[branchTones[handle]] }}
          isConnectable
        />
      ))}
    </div>
  );
}
