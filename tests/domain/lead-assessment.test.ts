/**
 * -------------------------------------------------------------------------
 * @file   lead-assessment.test.ts
 * @brief  Verifies the Lead Assessment request, output validation, and cost.
 *
 * @description
 *  Checks that the fixed Tracer prompt carries the Workspace name and the
 *  indexed, timestamped speaker turns with a strict schema for gpt-5-mini,
 *  that model output is accepted only with a known classification, an
 *  integer score from 0 to 100, a summary, a rationale, and evidence whose
 *  quote appears in the Transcript turn it references, and that cost
 *  follows gpt-5-mini's token prices.
 *
 * @see
 *  data/lead-assessment.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { LeadAssessmentError, leadAssessmentCostUsd, leadAssessmentRequest, parseLeadAssessment } from "@/data/lead-assessment";
import type { TranscriptTurn } from "@/data/transcript";

const turns: TranscriptTurn[] = [
  { speaker: "Caller", startMs: 1200, endMs: 4000, text: "Hi, I'm calling about a quote for a new water heater." },
  { speaker: "Business", startMs: 4500, endMs: 6000, text: "Sure. When works for a visit?" },
  { speaker: "Caller", startMs: 3_725_000, endMs: 3_727_000, text: "Thursday   morning works." },
];

const valid = {
  classification: "Good Lead",
  score: 86,
  summary: "Caller requested a water heater quote.",
  rationale: "A prospective customer asked for a quote and a visit.",
  evidence: [
    { turnIndex: 0, quote: "a quote for a new water heater" },
    { turnIndex: 2, quote: "thursday morning works" },
  ],
};

function output(overrides: Record<string, unknown>): string {
  return JSON.stringify({ ...valid, ...overrides });
}

describe("Lead Assessment request", () => {
  it("asks gpt-5-mini with the fixed Tracer prompt, the Workspace name, and indexed timestamped speaker turns", () => {
    const request = leadAssessmentRequest("Example Plumbing", turns);

    expect(request.model).toBe("gpt-5-mini");
    expect(request.schemaName).toBe("lead_assessment");
    expect(request.instructions).toContain("Good Lead");
    expect(request.instructions).toContain("Not Good Lead");
    expect(request.instructions).toContain("Uncertain");
    expect(request.instructions).toMatch(/spam/i);
    expect(request.instructions).toMatch(/existing customer/i);
    expect(request.input).toBe(
      [
        "Workspace: Example Plumbing",
        "",
        "Transcript turns:",
        "0 [00:01] Caller: Hi, I'm calling about a quote for a new water heater.",
        "1 [00:04] Business: Sure. When works for a visit?",
        "2 [1:02:05] Caller: Thursday   morning works.",
      ].join("\n"),
    );
  });

  it("constrains the output with a strict schema of classification, integer score, summary, rationale, and evidence", () => {
    const { schema } = leadAssessmentRequest("Example Plumbing", turns);

    expect(schema).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["classification", "score", "summary", "rationale", "evidence"],
      properties: {
        classification: { type: "string", enum: ["Good Lead", "Not Good Lead", "Uncertain"] },
        score: { type: "integer", minimum: 0, maximum: 100 },
        summary: { type: "string" },
        rationale: { type: "string" },
        evidence: {
          type: "array",
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["turnIndex", "quote"],
            properties: { turnIndex: { type: "integer", minimum: 0 }, quote: { type: "string" } },
          },
        },
      },
    });
  });
});

describe("Lead Assessment output", () => {
  it("accepts valid output and links each evidence quote to its Transcript turn's start time", () => {
    expect(parseLeadAssessment(output({}), turns)).toEqual({
      classification: "Good Lead",
      score: 86,
      summary: "Caller requested a water heater quote.",
      rationale: "A prospective customer asked for a quote and a visit.",
      evidence: [
        { turnIndex: 0, startMs: 1200, quote: "a quote for a new water heater" },
        { turnIndex: 2, startMs: 3_725_000, quote: "thursday morning works" },
      ],
    });
  });

  it("accepts the score bounds and an assessment without evidence", () => {
    expect(parseLeadAssessment(output({ classification: "Uncertain", score: 0, evidence: [] }), [])).toMatchObject({ classification: "Uncertain", score: 0, evidence: [] });
    expect(parseLeadAssessment(output({ score: 100 }), turns).score).toBe(100);
  });

  it("rejects an unknown classification, an out-of-range or fractional score, or an empty summary or rationale", () => {
    const invalid = [
      output({ classification: "Great Lead" }),
      output({ score: 101 }),
      output({ score: -1 }),
      output({ score: 50.5 }),
      output({ summary: " " }),
      output({ rationale: "" }),
      "not json",
      JSON.stringify([valid]),
    ];
    for (const text of invalid) expect(() => parseLeadAssessment(text, turns)).toThrow(new LeadAssessmentError("Lead Assessment output is invalid"));
  });

  it("rejects evidence whose turn index does not resolve to a Transcript turn", () => {
    expect(() => parseLeadAssessment(output({ evidence: [{ turnIndex: 3, quote: "Hi" }] }), turns)).toThrow(new LeadAssessmentError("Lead Assessment evidence does not match the Transcript"));
    expect(() => parseLeadAssessment(output({ evidence: [{ turnIndex: 0.5, quote: "Hi" }] }), turns)).toThrow(LeadAssessmentError);
  });

  it("rejects evidence whose quote does not appear in the referenced turn", () => {
    expect(() => parseLeadAssessment(output({ evidence: [{ turnIndex: 1, quote: "a quote for a new water heater" }] }), turns)).toThrow(
      new LeadAssessmentError("Lead Assessment evidence does not match the Transcript"),
    );
    expect(() => parseLeadAssessment(output({ evidence: [{ turnIndex: 0, quote: " " }] }), turns)).toThrow(LeadAssessmentError);
  });
});

describe("Lead Assessment cost", () => {
  it("charges gpt-5-mini's $0.25 per million input tokens and $2.00 per million output tokens", () => {
    expect(leadAssessmentCostUsd(812, 436)).toBe(0.001075);
    expect(leadAssessmentCostUsd(1_000_000, 1_000_000)).toBe(2.25);
  });
});
