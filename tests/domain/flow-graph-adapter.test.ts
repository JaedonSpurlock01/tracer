/**
 * -------------------------------------------------------------------------
 * @file   flow-graph-adapter.test.ts
 * @brief  Verifies pure Call Flow and React Flow graph conversion.
 *
 * @description
 *  Covers node positions, node data, edge handles, and round-trip behavior.
 *
 * @remarks
 *  Adapter tests do not render React components or call providers.
 *
 * @see
 *  components/tracer/flow/graph-adapter.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { generateInitialCallFlow } from "@/data/call-flow";
import { fromReactFlow, toReactFlow } from "@/components/tracer/flow/graph-adapter";

describe("Flow graph adapter", () => {
  it("maps and round-trips a Call Flow graph", () => {
    const graph = generateInitialCallFlow({
      destinationNumber: "+14155550101",
      recordingEnabled: true,
      spamGateEnabled: true,
      whisperEnabled: true,
      whisperMessage: "Hello",
      disclosureVoice: "Polly.Joanna",
    });
    const reactFlow = toReactFlow(graph);
    expect(reactFlow.nodes[0]).toMatchObject({ id: "incoming", type: "incoming_call", data: graph.nodes[0], position: { x: 0, y: 0 } });
    expect(reactFlow.edges[0]).toMatchObject({ sourceHandle: "next", label: "next" });
    expect(fromReactFlow(reactFlow.nodes, reactFlow.edges)).toEqual(graph);
  });
});
