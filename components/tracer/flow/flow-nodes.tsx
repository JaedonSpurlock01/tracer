/**
 * -------------------------------------------------------------------------
 * @file   flow-nodes.tsx
 * @brief  Renders custom Call Flow nodes for React Flow.
 *
 * @description
 *  Shows node titles, concise type-specific summaries, validation borders, and
 *  labelled source handles.
 *
 * @remarks
 *  Node rendering is intentionally presentational so graph rules stay in the
 *  Call Flow domain validator.
 *
 * @see
 *  data/call-flow.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { Handle, Position, type NodeProps } from "@xyflow/react";

import { nodeHandles, type FlowNode } from "@/data/call-flow";

function summary(node: FlowNode): string {
  if (node.type === "forward_call") return node.destinationNumber || "No destination";
  if (node.type === "keypad_gate") return `Press ${node.digit}`;
  if (node.type === "whisper") return node.message.slice(0, 36) || "No message";
  if (node.type === "voicemail") return node.greeting.slice(0, 36);
  if (node.type === "outcome") return node.outcome;
  if (node.type === "recording_disclosure") return "Fixed disclosure";
  if (node.type === "business_hours") return "Open and closed";
  return "Start of call";
}

export default function FlowNodeView({ data: rawData }: NodeProps) {
  const data = rawData as unknown as FlowNode;
  return (
    <div className="min-w-36 rounded-md border bg-card p-2 text-xs shadow-sm" data-testid={`flow-node-${data.id}`}>
      <strong className="block capitalize">{data.type.replaceAll("_", " ")}</strong>
      <span className="block text-muted-foreground">{summary(data)}</span>
      {data.type !== "incoming_call" && <Handle type="target" position={Position.Top} isConnectable />}
      {nodeHandles[data.type].map((handle) => (
        <Handle key={handle} type="source" position={Position.Bottom} id={handle} isConnectable />
      ))}
    </div>
  );
}
