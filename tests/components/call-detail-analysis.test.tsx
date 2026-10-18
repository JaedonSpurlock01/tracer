/**
 * -------------------------------------------------------------------------
 * @file   call-detail-analysis.test.tsx
 * @brief  Verifies the Call Detail Transcript, Lead Assessment, and Lead Review.
 *
 * @description
 *  Covers the Transcript below the player with timestamped Caller and
 *  Business turns that seek playback, the active turn during playback,
 *  follow mode with Resume Follow, Transcript search, and every Transcript
 *  processing state; the automated Lead Assessment with evidence that seeks
 *  and emphasizes its turn and its isolated processing states; the Lead
 *  Review as the reporting result with the Operator form; and the
 *  Operator-only analysis Retry.
 *
 * @remarks
 *  Playback is driven through the real Recording player's media element,
 *  so the player and Transcript seam is tested end to end. wavesurfer.js
 *  and the network are replaced only at their module and fetch boundaries.
 *
 * @see
 *  components/tracer/call-detail-view.tsx
 *  components/tracer/call-analysis.tsx
 *  components/tracer/playback.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CallDetailView from "@/components/tracer/call-detail-view";
import type { CallDetail } from "@/data/call-details";

vi.mock("wavesurfer.js", () => ({ default: { create: () => ({ zoom: vi.fn(), destroy: vi.fn() }) } }));
vi.mock("wavesurfer.js/plugins/timeline", () => ({ default: { create: () => ({}) } }));

const turns: NonNullable<CallDetail["transcript"]["turns"]> = [
  { speaker: "Business", startMs: 0, endMs: 4000, text: "Thanks for calling Acme Plumbing." },
  { speaker: "Caller", startMs: 4500, endMs: 12000, text: "Hi, my water heater is leaking and I need someone today." },
  { speaker: "Business", startMs: 12500, endMs: 20000, text: "We can send a plumber this afternoon. What is your address?" },
  { speaker: "Caller", startMs: 20500, endMs: 30000, text: "It is 12 Main Street, and the heater is in the basement." },
];

const call: CallDetail = {
  id: "call-1",
  workspace: { id: "workspace-1", name: "Acme Plumbing", reportingTimezone: "America/Chicago" },
  callerNumber: "+13125550142",
  trackingNumber: "+14155550100",
  destinationNumber: "+14155550199",
  state: "Completed",
  outcome: "Answered",
  startedAt: "2026-10-16T20:04:05.000Z",
  endedAt: "2026-10-16T20:05:40.000Z",
  totalDurationSeconds: 95,
  connectedDurationSeconds: 78,
  spamGate: "Passed",
  recording: { state: "Ready", id: "recording-1", channels: 2, lanes: ["Caller", "Business"], durationSeconds: 83, waveform: false, expiresAt: "2027-10-16T20:04:05.000Z" },
  timeline: [],
  transcript: { state: "Completed", turns },
  leadAssessment: {
    state: "Completed",
    classification: "Good Lead",
    score: 86,
    summary: "A homeowner requested same-day water heater repair.",
    rationale: "The Caller described an urgent service need and shared an address.",
    processedAt: "2026-10-16T20:08:00.000Z",
    evidence: [{ turnIndex: 1, startMs: 4500, quote: "my water heater is leaking" }],
  },
  leadReview: null,
  effectiveLeadClassification: { classification: "Good Lead", source: "assessment" },
};

function audio(): HTMLAudioElement {
  const element = document.querySelector("audio");
  if (!element) throw new Error("audio element missing");
  return element;
}

function transcript(): HTMLElement {
  return screen.getByRole("region", { name: "Transcript" });
}

function turnItems(): HTMLElement[] {
  return within(within(transcript()).getByRole("list", { name: "Transcript turns" })).getAllByRole("listitem");
}

function playTo(seconds: number) {
  audio().currentTime = seconds;
  fireEvent.timeUpdate(audio());
}

let fetchMock: ReturnType<typeof vi.fn>;
let scrollTo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() => new Promise(() => undefined));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  scrollTo = vi.fn();
  Object.defineProperty(Element.prototype, "scrollTo", { value: scrollTo, configurable: true, writable: true });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("pause"));
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Call Detail Transcript", () => {
  it("shows timestamped Caller and Business turns immediately below the player", () => {
    render(<CallDetailView call={call} operator={false} />);
    const regions = screen.getAllByRole("region").map((region) => region.querySelector("h2")?.textContent);
    expect(regions.indexOf("Transcript")).toBe(regions.indexOf("Recording") + 1);
    const items = turnItems();
    expect(items).toHaveLength(4);
    expect(within(items[1]).getByText("Caller")).toBeVisible();
    expect(within(items[1]).getByRole("button", { name: "Seek to 0:04, Caller" })).toBeVisible();
    expect(within(items[0]).getByText("Business")).toBeVisible();
    expect(items[1]).toHaveTextContent("Hi, my water heater is leaking and I need someone today.");
  });

  it("seeks playback to a turn's start from its timestamp or its text", () => {
    render(<CallDetailView call={call} operator={false} />);
    fireEvent.click(within(turnItems()[2]).getByRole("button", { name: "Seek to 0:12, Business" }));
    expect(audio().currentTime).toBe(12.5);
    fireEvent.click(within(turnItems()[3]).getByText(/12 Main Street/));
    expect(audio().currentTime).toBe(20.5);
  });

  it("highlights the active turn during playback", () => {
    render(<CallDetailView call={call} operator={false} />);
    playTo(5);
    expect(turnItems()[1]).toHaveAttribute("aria-current", "true");
    playTo(13);
    expect(turnItems()[1]).not.toHaveAttribute("aria-current");
    expect(turnItems()[2]).toHaveAttribute("aria-current", "true");
  });
});

describe("Call Detail Transcript states", () => {
  function withTranscript(transcript: CallDetail["transcript"], leadAssessment: CallDetail["leadAssessment"] = { state: "Unavailable" }): CallDetail {
    return { ...call, transcript, leadAssessment, effectiveLeadClassification: null };
  }

  it("keeps the player and shows Skeleton rows while the Transcript is processing", () => {
    render(<CallDetailView call={withTranscript({ state: "Pending" })} operator={false} />);
    expect(screen.getByRole("group", { name: "Waveform" })).toBeVisible();
    expect(within(transcript()).getByRole("status")).toHaveTextContent("Transcript processing");
    expect(transcript().querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "Lead Assessment" })).toHaveTextContent("Analysis pending");
  });

  it("offers Operators a Retry with the failure reason when transcription failed", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ retry: { stage: "transcription" } }), { status: 202 }));
    render(<CallDetailView call={withTranscript({ state: "Failed", failureReason: "OpenAI request failed (HTTP 503)" })} operator />);
    expect(transcript()).toHaveTextContent("Transcription failed");
    expect(transcript()).toHaveTextContent("OpenAI request failed (HTTP 503)");
    fireEvent.click(within(transcript()).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(within(transcript()).getByRole("status")).toHaveTextContent("Transcript processing"));
    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/workspace-1/calls/call-1/analysis/retry", expect.objectContaining({ method: "POST" }));
  });

  it("reports a refused analysis Retry without leaving the failed state", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "provider_unavailable" }), { status: 502 }));
    render(<CallDetailView call={withTranscript({ state: "Failed" })} operator />);
    fireEvent.click(within(transcript()).getByRole("button", { name: "Retry" }));
    expect(await within(transcript()).findByRole("alert")).toHaveTextContent("Analysis could not be restarted. Try again.");
    expect(within(transcript()).getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  it("shows Client Viewers a neutral unavailable message without Retry when transcription failed", () => {
    render(<CallDetailView call={withTranscript({ state: "Failed" })} operator={false} />);
    expect(transcript()).toHaveTextContent("Transcript unavailable");
    expect(transcript()).not.toHaveTextContent("failed");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("explains why a Transcript was skipped in plain language", () => {
    const cases: [NonNullable<CallDetail["transcript"]["skipReason"]>, string][] = [
      ["analysis_disabled", "Analysis was turned off for this Workspace"],
      ["spam_gate_not_passed", "did not pass the spam gate"],
      ["too_short", "less than 15 seconds"],
    ];
    for (const [skipReason, text] of cases) {
      render(<CallDetailView call={withTranscript({ state: "Skipped", skipReason })} operator />);
      expect(transcript()).toHaveTextContent("No Transcript");
      expect(transcript()).toHaveTextContent(text);
      cleanup();
    }
  });

  it("labels an Expired Transcript without its content and a missing one as unavailable", () => {
    render(<CallDetailView call={withTranscript({ state: "Expired" })} operator />);
    expect(transcript()).toHaveTextContent("Transcript expired");
    expect(within(transcript()).queryByRole("list")).not.toBeInTheDocument();
    cleanup();
    render(<CallDetailView call={withTranscript({ state: "Unavailable" })} operator />);
    expect(transcript()).toHaveTextContent("Transcript unavailable");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});

describe("Call Detail Lead Assessment", () => {
  function assessment(): HTMLElement {
    return screen.getByRole("region", { name: "Lead Assessment" });
  }

  it("shows the automated classification, score, summary, rationale, and processing time after the Transcript", () => {
    render(<CallDetailView call={call} operator={false} />);
    const regions = screen.getAllByRole("region").map((region) => region.querySelector("h2")?.textContent);
    expect(regions.indexOf("Lead Assessment")).toBeGreaterThan(regions.indexOf("Transcript"));
    expect(within(assessment()).getByText("Good Lead")).toBeVisible();
    expect(assessment()).toHaveTextContent("86 / 100");
    expect(assessment()).toHaveTextContent("A homeowner requested same-day water heater repair.");
    expect(assessment()).toHaveTextContent("The Caller described an urgent service need and shared an address.");
    expect(assessment()).toHaveTextContent("Processed Oct 16, 2026, 3:08:00 PM");
    expect(assessment()).toHaveTextContent("Automated estimate");
    expect(assessment()).toHaveTextContent("not been reviewed");
  });

  it("labels the header classification as automated until a Lead Review exists", () => {
    render(<CallDetailView call={call} operator={false} />);
    const header = screen.getByRole("heading", { level: 1 }).closest("header");
    if (!header) throw new Error("Call header missing");
    expect(within(header).getByText("Good Lead (automated)")).toBeVisible();
    cleanup();
    const leadReview = { classification: "Not Good Lead" as const, note: null, reviewerName: "Example Operator", reviewedAt: "2026-10-16T21:00:00.000Z" };
    render(<CallDetailView call={{ ...call, leadReview, effectiveLeadClassification: { classification: "Not Good Lead", source: "review" } }} operator={false} />);
    const reviewed = screen.getByRole("heading", { level: 1 }).closest("header");
    if (!reviewed) throw new Error("Call header missing");
    expect(within(reviewed).getByText("Not Good Lead")).toBeVisible();
    expect(within(reviewed).queryByText(/automated/)).not.toBeInTheDocument();
  });

  it("seeks to evidence and emphasizes the matching Transcript turn", () => {
    render(<CallDetailView call={call} operator={false} />);
    fireEvent.click(within(assessment()).getByRole("button", { name: /0:04.*my water heater is leaking/ }));
    expect(audio().currentTime).toBe(4.5);
    expect(turnItems()[1]).toHaveAttribute("data-evidence", "true");
    expect(turnItems()[0]).not.toHaveAttribute("data-evidence");
    expect(scrollTo).toHaveBeenCalled();
  });

  it("isolates a failed Lead Assessment so the Transcript stays usable, with Retry only for Operators", () => {
    const failed: CallDetail = { ...call, leadAssessment: { state: "Failed", failureReason: "OpenAI request failed (HTTP 500)" }, effectiveLeadClassification: null };
    render(<CallDetailView call={failed} operator />);
    expect(assessment()).toHaveTextContent("Lead Assessment failed");
    expect(within(assessment()).getByRole("button", { name: "Retry" })).toBeVisible();
    expect(turnItems()).toHaveLength(4);
    expect(within(transcript()).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    cleanup();
    render(<CallDetailView call={{ ...failed, leadAssessment: { state: "Failed" } }} operator={false} />);
    expect(assessment()).toHaveTextContent("Lead Assessment unavailable");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.queryByText("Good Lead")).not.toBeInTheDocument();
  });

  it("keeps non-content assessment fields when evidence expired with the Transcript", () => {
    render(<CallDetailView call={{ ...call, transcript: { state: "Expired" }, leadAssessment: { ...call.leadAssessment, evidence: undefined } }} operator={false} />);
    expect(assessment()).toHaveTextContent("86 / 100");
    expect(within(assessment()).queryByRole("button")).not.toBeInTheDocument();
    expect(assessment()).toHaveTextContent("Evidence expired with the Transcript.");
  });
});

describe("Call Detail Transcript follow mode and search", () => {
  function turnList(): HTMLElement {
    return within(transcript()).getByRole("list", { name: "Transcript turns" });
  }

  it("follows the active turn during playback and pauses after the user scrolls away", () => {
    render(<CallDetailView call={call} operator={false} />);
    playTo(5);
    expect(scrollTo).not.toHaveBeenCalled();
    fireEvent.play(audio());
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(within(transcript()).queryByRole("button", { name: "Resume Follow" })).not.toBeInTheDocument();
    fireEvent.wheel(turnList());
    playTo(13);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    fireEvent.click(within(transcript()).getByRole("button", { name: "Resume Follow" }));
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(within(transcript()).queryByRole("button", { name: "Resume Follow" })).not.toBeInTheDocument();
    playTo(21);
    expect(scrollTo).toHaveBeenCalledTimes(3);
  });

  it("scrolls without smooth motion when reduced motion is preferred", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
    render(<CallDetailView call={call} operator={false} />);
    fireEvent.play(audio());
    playTo(5);
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "auto" }));
  });

  it("highlights search matches with a match count and moves between them from the keyboard", () => {
    render(<CallDetailView call={call} operator={false} />);
    const search = within(transcript()).getByRole("searchbox", { name: "Search Transcript" });
    fireEvent.change(search, { target: { value: "heater" } });
    expect(within(transcript()).getByRole("status")).toHaveTextContent("2 matches");
    const marks = turnList().querySelectorAll("mark");
    expect(marks).toHaveLength(2);
    expect(marks[0].closest("li")).toBe(turnItems()[1]);
    expect(marks[1].closest("li")).toBe(turnItems()[3]);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(within(transcript()).getByRole("status")).toHaveTextContent("Match 1 of 2");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(within(transcript()).getByRole("status")).toHaveTextContent("Match 2 of 2");
    expect(marks[1]).toHaveAttribute("data-current", "true");
    fireEvent.keyDown(search, { key: "Enter", shiftKey: true });
    expect(within(transcript()).getByRole("status")).toHaveTextContent("Match 1 of 2");
    fireEvent.change(search, { target: { value: "invoice" } });
    expect(within(transcript()).getByRole("status")).toHaveTextContent("No matches");
    expect(turnList().querySelectorAll("mark")).toHaveLength(0);
  });
});

describe("Call Detail Lead Review", () => {
  const leadReview = { classification: "Not Good Lead" as const, note: "Caller was selling advertising.", reviewerName: "Example Operator", reviewedAt: "2026-10-16T21:00:00.000Z" };
  const reviewed: CallDetail = { ...call, leadReview, effectiveLeadClassification: { classification: "Not Good Lead", source: "review" } };

  function review(): HTMLElement {
    return screen.getByRole("region", { name: "Lead Review" });
  }

  async function chooseClassification(name: string) {
    fireEvent.click(within(review()).getByRole("combobox", { name: "Classification" }));
    const option = await screen.findByRole("option", { name });
    option.focus();
    fireEvent.keyDown(option, { key: "Enter" });
  }

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    Object.defineProperty(Element.prototype, "getAnimations", { value: () => [], configurable: true });
  });

  it("places the Lead Review directly above the Lead Assessment as the reporting result, read only for Client Viewers", () => {
    render(<CallDetailView call={reviewed} operator={false} />);
    const regions = screen.getAllByRole("region").map((region) => region.querySelector("h2")?.textContent);
    expect(regions.indexOf("Lead Review")).toBe(regions.indexOf("Lead Assessment") - 1);
    expect(review()).toHaveTextContent("Reporting result");
    expect(within(review()).getByText("Not Good Lead")).toBeVisible();
    expect(review()).toHaveTextContent("Caller was selling advertising.");
    expect(review()).toHaveTextContent("Reviewed by Example Operator on Oct 16, 2026, 4:00:00 PM");
    expect(within(review()).queryByRole("button")).not.toBeInTheDocument();
    expect(within(review()).queryByText(/score/i)).not.toBeInTheDocument();
  });

  it("omits the Lead Review for Client Viewers when none exists", () => {
    render(<CallDetailView call={call} operator={false} />);
    expect(screen.queryByRole("region", { name: "Lead Review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Lead Review" })).not.toBeInTheDocument();
  });

  it("lets an Operator add a Lead Review with a classification and an optional note", async () => {
    const saved = { classification: "Good Lead", note: "Booked a same-day visit.", reviewerName: "Example Operator", reviewedAt: "2026-10-16T22:00:00.000Z" };
    let resolve: (response: Response) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    render(<CallDetailView call={call} operator />);
    fireEvent.click(within(review()).getByRole("button", { name: "Add Lead Review" }));
    await chooseClassification("Good Lead");
    const note = within(review()).getByRole("textbox", { name: "Note (optional)" });
    fireEvent.change(note, { target: { value: "Booked a same-day visit." } });
    expect(review()).toHaveTextContent("24 / 2000");
    fireEvent.click(within(review()).getByRole("button", { name: "Save Lead Review" }));
    expect(within(review()).getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/workspace-1/calls/call-1/lead-review", expect.objectContaining({ method: "PUT", body: JSON.stringify({ classification: "Good Lead", note: "Booked a same-day visit." }) }));
    resolve(new Response(JSON.stringify({ leadReview: saved }), { status: 200 }));
    await waitFor(() => expect(within(review()).queryByRole("textbox")).not.toBeInTheDocument());
    expect(within(review()).getByText("Booked a same-day visit.")).toBeVisible();
    expect(review()).toHaveTextContent("Reviewed by Example Operator on Oct 16, 2026, 5:00:00 PM");
    expect(within(review()).getByRole("button", { name: "Update Lead Review" })).toBeVisible();
  });

  it("validates the classification and note length before saving", async () => {
    render(<CallDetailView call={call} operator />);
    fireEvent.click(within(review()).getByRole("button", { name: "Add Lead Review" }));
    fireEvent.click(within(review()).getByRole("button", { name: "Save Lead Review" }));
    expect(within(review()).getByRole("alert")).toHaveTextContent("Choose a classification.");
    await chooseClassification("Uncertain");
    fireEvent.change(within(review()).getByRole("textbox", { name: "Note (optional)" }), { target: { value: "x".repeat(2001) } });
    expect(review()).toHaveTextContent("2001 / 2000");
    fireEvent.click(within(review()).getByRole("button", { name: "Save Lead Review" }));
    expect(within(review()).getByRole("alert")).toHaveTextContent("Keep the note to 2000 characters or fewer.");
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("lead-review"), expect.anything());
  });

  it("updates an existing Lead Review from its current values and reports a refused save", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "invalid_input" }), { status: 400 }));
    render(<CallDetailView call={reviewed} operator />);
    fireEvent.click(within(review()).getByRole("button", { name: "Update Lead Review" }));
    expect(within(review()).getByRole("combobox", { name: "Classification" })).toHaveTextContent("Not Good Lead");
    expect(within(review()).getByRole("textbox", { name: "Note (optional)" })).toHaveValue("Caller was selling advertising.");
    fireEvent.click(within(review()).getByRole("button", { name: "Save Lead Review" }));
    expect(await within(review()).findByRole("alert")).toHaveTextContent("Check the classification and note, then try again.");
    expect(within(review()).getByRole("button", { name: "Save Lead Review" })).toBeEnabled();
    fireEvent.click(within(review()).getByRole("button", { name: "Cancel" }));
    expect(review()).toHaveTextContent("Caller was selling advertising.");
  });
});
