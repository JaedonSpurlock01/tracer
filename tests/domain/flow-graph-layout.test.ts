/**
 * -------------------------------------------------------------------------
 * @file   flow-graph-layout.test.ts
 * @brief  Verifies the derived Call Flow canvas layout.
 *
 * @description
 *  Checks that steps descend by depth, that sibling branches fan out
 *  horizontally without overlapping, that a shared target sits once, and
 *  that unreachable nodes still receive a position.
 *
 * @see
 *  components/tracer/flow/graph-layout.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { FLOW_NODE_WIDTH, layoutCallFlow } from "@/components/tracer/flow/graph-layout";
import { generateInitialCallFlow } from "@/data/call-flow";

const options = {
  destinationNumber: "+14155552671",
  recordingEnabled: true,
  spamGateEnabled: true,
  whisperEnabled: false,
  whisperMessage: null,
  disclosureVoice: "Polly.Joanna" as const,
};

describe("Call Flow layout", () => {
  it("places each step one layer below its parent and fans branches out side by side", () => {
    const positions = layoutCallFlow(generateInitialCallFlow(options));
    const y = (id: string) => positions.get(id)!.y;
    const x = (id: string) => positions.get(id)!.x;
    expect(y("incoming")).toBe(0);
    expect(y("disclosure")).toBeGreaterThan(y("incoming"));
    expect(y("gate")).toBeGreaterThan(y("disclosure"));
    expect(y("forward")).toBeGreaterThan(y("gate"));
    expect(y("outcome-blocked")).toBe(y("forward"));
    const outcomes = ["outcome-answered", "outcome-missed", "outcome-failed"].map(x).sort((a, b) => a - b);
    expect(new Set(outcomes).size).toBe(3);
    expect(outcomes[1] - outcomes[0]).toBeGreaterThanOrEqual(FLOW_NODE_WIDTH);
    expect(outcomes[2] - outcomes[1]).toBeGreaterThanOrEqual(FLOW_NODE_WIDTH);
    expect(x("outcome-blocked")).toBeGreaterThanOrEqual(x("outcome-failed") + FLOW_NODE_WIDTH);
    expect(x("incoming")).toBe(x("disclosure"));
  });

  it("gives an unreachable node a position off to the side", () => {
    const graph = generateInitialCallFlow(options);
    graph.nodes.push({ id: "stray", type: "outcome", position: { x: 0, y: 0 }, outcome: "Abandoned" });
    const positions = layoutCallFlow(graph);
    expect(positions.has("stray")).toBe(true);
    expect(positions.get("stray")!.x).toBeLessThan(0);
  });
});
