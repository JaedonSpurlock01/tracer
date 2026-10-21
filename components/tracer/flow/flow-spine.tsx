/**
 * -------------------------------------------------------------------------
 * @file   flow-spine.tsx
 * @brief  Renders a published Call Flow as its main path with side exits.
 *
 * @description
 *  Follows the happy path (next, Open, Pass, Answered) from the Incoming
 *  Call as a vertical rail of steps, each with its icon, title, and detail
 *  line. A step's other branches appear beneath it as exit chips naming the
 *  branch in its tone and where it leads, so a reader sees the common call
 *  top to bottom and every way out at a glance.
 *
 * @remarks
 *  Read-only. Steps are the only list items so tests and assistive
 *  technology count them directly; exits are inline chips.
 *
 * @see
 *  data/call-flow.ts
 *  components/tracer/workspace-overview.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { Badge } from "@/components/reui/badge";
import { toneBadge, toneColor } from "@/components/tracer/flow/flow-tones";
import { NodeIcon } from "@/components/tracer/flow/node-icon";
import { branchLabels, branchTones, callFlowTree, describeFlowNode, outcomeTones, type CallFlowGraph, type EdgeHandle, type FlowTreeBranch, type FlowTreeNode } from "@/data/call-flow";

const mainHandles: readonly EdgeHandle[] = ["next", "open", "pass", "answered"];

function mainBranch(tree: FlowTreeNode): FlowTreeBranch | undefined {
  return tree.branches.find((branch) => mainHandles.includes(branch.handle));
}

/** Where an exit leads: the Outcome, or the chain of steps until the path ends or rejoins. */
function exitTarget(branch: FlowTreeBranch): { chain: string[]; outcome: FlowTreeNode["node"] | null } {
  const chain: string[] = [];
  let cursor = branch.child;
  while (cursor) {
    if (cursor.node.type === "outcome") return { chain, outcome: cursor.node };
    chain.push(describeFlowNode(cursor.node).title);
    const next = mainBranch(cursor);
    cursor = next?.child && !next.shared ? next.child : null;
  }
  return { chain, outcome: null };
}

export default function FlowSpine({ graph }: { graph: CallFlowGraph }) {
  const steps: Array<{ tree: FlowTreeNode; exits: FlowTreeBranch[] }> = [];
  let cursor = callFlowTree(graph);
  while (cursor) {
    const main = mainBranch(cursor);
    steps.push({ tree: cursor, exits: cursor.branches.filter((branch) => branch !== main) });
    cursor = main?.child && !main.shared ? main.child : null;
  }
  return (
    <ol aria-label="Call Flow steps" className="flex flex-col">
      {steps.map(({ tree, exits }, index) => {
        const { node } = tree;
        const { title, detail } = describeFlowNode(node);
        return (
          <li key={node.id} className="relative flex gap-3 pb-4 last:pb-0">
            {index < steps.length - 1 ? <span className="absolute top-7 bottom-0 left-3.5 w-px bg-border" aria-hidden /> : null}
            <span className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border bg-card">
              <NodeIcon type={node.type} className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <strong className="font-medium">{title}</strong>
                {node.type === "outcome" ? <Badge variant={toneBadge[outcomeTones[node.outcome]]}>{node.outcome}</Badge> : null}
              </p>
              {node.type !== "outcome" ? <p className="truncate text-xs text-muted-foreground">{detail}</p> : null}
              {exits.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {exits.map((exit) => {
                    const target = exitTarget(exit);
                    return (
                      <span key={exit.handle} className="flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs">
                        <span style={{ color: toneColor[branchTones[exit.handle]] }}>{branchLabels[exit.handle] ?? exit.handle}</span>
                        <span className="text-muted-foreground">→</span>
                        {exit.child === null ? (
                          <span className="text-destructive">not connected</span>
                        ) : (
                          <>
                            {target.chain.length ? <span>{target.chain.join(" → ")}</span> : null}
                            {target.chain.length && target.outcome ? <span className="text-muted-foreground">→</span> : null}
                            {target.outcome?.type === "outcome" ? (
                              <Badge size="xs" variant={toneBadge[outcomeTones[target.outcome.outcome]]}>
                                {target.outcome.outcome}
                              </Badge>
                            ) : null}
                          </>
                        )}
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
