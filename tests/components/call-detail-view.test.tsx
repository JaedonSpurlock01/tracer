/**
 * -------------------------------------------------------------------------
 * @file   call-detail-view.test.tsx
 * @brief  Verifies the Call Detail header, Call facts, and timeline.
 *
 * @description
 *  Covers the caller-first header with Workspace and Tracking Number
 *  context and the Call Outcome Badge, the Call facts definition list with
 *  the Operator-only Twilio call SID, Recording and retention status
 *  including Expired media, the processing timeline with its Transcript,
 *  Lead Assessment, and Lead Review entries, and the absence of actions
 *  deferred to later milestones.
 *
 * @remarks
 *  The player is covered by recording-player.test.tsx and the Transcript,
 *  Lead Assessment, and Lead Review by call-detail-analysis.test.tsx, so
 *  wavesurfer.js is replaced at its module boundary here only to keep
 *  jsdom quiet.
 *
 * @see
 *  components/tracer/call-detail-view.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CallDetailView from "@/components/tracer/call-detail-view";
import type { CallDetail } from "@/data/call-details";

vi.mock("wavesurfer.js", () => ({ default: { create: () => ({ zoom: vi.fn(), destroy: vi.fn() }) } }));
vi.mock("wavesurfer.js/plugins/timeline", () => ({ default: { create: () => ({}) } }));

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
  recording: { state: "Ready", id: "recording-1", channels: 2, lanes: ["Caller", "Business"], durationSeconds: 83, waveform: true, expiresAt: "2027-10-16T20:04:05.000Z" },
  mp3RecordingId: null,
  timeline: [
    { id: "event-1", label: "Call received", status: "Completed", at: "2026-10-16T20:04:05.000Z" },
    { id: "recording-transfer", label: "Recording stored", status: "Completed", at: "2026-10-16T20:05:50.000Z" },
    { id: "recording-waveform", label: "Waveform generation failed", status: "Failed", at: "2026-10-16T20:06:00.000Z" },
  ],
  transcript: { state: "Unavailable" },
  leadAssessment: { state: "Unavailable" },
  leadReview: null,
  effectiveLeadClassification: null,
  twilioCallSid: "CA00000000000000000000000000000001",
};

function fact(term: string): HTMLElement {
  const facts = screen.getByRole("region", { name: "Call facts" });
  const definition = within(facts).getByText(term, { selector: "dt" }).nextElementSibling;
  if (!(definition instanceof HTMLElement)) throw new Error(`${term} has no value`);
  return definition;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CallDetailView", () => {
  it("identifies the Call by caller number with Workspace, Tracking Number, and Call Outcome", () => {
    render(<CallDetailView call={call} operator />);
    const heading = screen.getByRole("heading", { level: 1, name: "+13125550142" });
    const header = heading.closest("header");
    if (!header) throw new Error("Call header missing");
    expect(within(header).getByRole("link", { name: "Acme Plumbing" })).toHaveAttribute("href", "/workspaces/workspace-1");
    expect(within(header).getByText("+14155550100")).toBeVisible();
    expect(within(header).getByText("Answered")).toBeVisible();
    expect(screen.getByRole("region", { name: "Recording" })).toBeVisible();
  });

  it("lists the Call facts with the Operator-only Twilio call SID", () => {
    render(<CallDetailView call={call} operator />);
    expect(fact("Call start")).toHaveTextContent("Oct 16, 2026, 3:04:05 PM");
    expect(fact("Call end")).toHaveTextContent("Oct 16, 2026, 3:05:40 PM");
    expect(fact("Total duration")).toHaveTextContent("1:35");
    expect(fact("Connected duration")).toHaveTextContent("1:18");
    expect(fact("Tracking Number dialed")).toHaveTextContent("+14155550100");
    expect(fact("Destination Number used")).toHaveTextContent("+14155550199");
    expect(fact("Workspace")).toHaveTextContent("Acme Plumbing");
    expect(fact("Call Outcome")).toHaveTextContent("Answered");
    expect(fact("Spam gate")).toHaveTextContent("Passed");
    expect(fact("Recording")).toHaveTextContent("Dual-channel, retained until Oct 16, 2027");
    expect(fact("Twilio call SID")).toHaveTextContent("CA00000000000000000000000000000001");
  });

  it("omits the Twilio call SID for a Client Viewer and shows placeholders for missing facts", () => {
    render(<CallDetailView operator={false} call={{ ...call, twilioCallSid: undefined, callerNumber: null, destinationNumber: null, state: "In Progress", outcome: null, endedAt: null, totalDurationSeconds: null, connectedDurationSeconds: null }} />);
    expect(screen.getByRole("heading", { level: 1, name: "Unknown caller" })).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Call facts" })).queryByText("Twilio call SID")).not.toBeInTheDocument();
    expect(fact("Call end")).toHaveTextContent("-");
    expect(fact("Destination Number used")).toHaveTextContent("Not forwarded");
    expect(fact("Call Outcome")).toHaveTextContent("In Progress");
  });

  it("keeps the Call facts and labels Recording media Expired without audio", () => {
    render(<CallDetailView call={{ ...call, recording: { state: "Expired", expiredAt: "2026-10-16T20:04:05.000Z" } }} operator />);
    expect(fact("Recording")).toHaveTextContent("Expired");
    expect(fact("Total duration")).toHaveTextContent("1:35");
    expect(screen.getByText("Recording expired")).toBeVisible();
    expect(document.querySelector("audio")).toBeNull();
  });

  it("describes Processing, Failed, and Unavailable Recordings in the Recording fact", () => {
    const cases: [CallDetail["recording"], string][] = [
      [{ state: "Processing", stage: "transfer" }, "Processing"],
      [{ state: "Failed" }, "Failed"],
      [{ state: "Unavailable", reason: "disabled" }, "Not recorded"],
      [{ state: "Unavailable", reason: "not_captured" }, "Not captured"],
      [{ ...call.recording, state: "Ready", channels: 1, lanes: ["Mixed"] } as CallDetail["recording"], "Mixed audio, retained until Oct 16, 2027"],
    ];
    for (const [recording, text] of cases) {
      render(<CallDetailView call={{ ...call, recording }} operator />);
      expect(fact("Recording")).toHaveTextContent(text);
      cleanup();
    }
  });

  it("renders the processing timeline with each entry's status", () => {
    render(<CallDetailView call={call} operator />);
    const timeline = screen.getByRole("region", { name: "Processing timeline" });
    expect(within(timeline).getByText("Call received")).toBeVisible();
    expect(within(timeline).getByText("Recording stored")).toBeVisible();
    expect(within(timeline).getByText("Waveform generation failed")).toBeVisible();
    expect(within(timeline).getAllByText("Completed")).toHaveLength(2);
    expect(within(timeline).getByText("Failed")).toBeVisible();
  });

  it("starts the Recording player when opened from Play Recording", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    render(<CallDetailView call={call} operator={false} autoPlay />);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    play.mockRestore();
  });

  it("offers Download MP3 in the header whenever the read model gives a downloadable MP3, even while the waveform is Pending", () => {
    const { rerender } = render(<CallDetailView call={{ ...call, mp3RecordingId: "recording-1" }} operator={false} />);
    const header = () => screen.getByRole("heading", { level: 1 }).closest("header")!;
    expect(within(header()).getByRole("link", { name: "Download MP3" })).toHaveAttribute("href", "/api/workspaces/workspace-1/recordings/recording-1/mp3");
    expect(within(header()).getByRole("link", { name: "Download MP3" })).toHaveAttribute("download");
    rerender(<CallDetailView call={{ ...call, recording: { state: "Processing", stage: "waveform" }, mp3RecordingId: "recording-1" }} operator={false} />);
    expect(within(header()).getByRole("link", { name: "Download MP3" })).toHaveAttribute("href", "/api/workspaces/workspace-1/recordings/recording-1/mp3");
    for (const recording of [call.recording, { state: "Expired", expiredAt: "2026-10-16T20:04:05.000Z" }] as CallDetail["recording"][]) {
      rerender(<CallDetailView call={{ ...call, recording, mp3RecordingId: null }} operator={false} />);
      expect(screen.queryByRole("link", { name: "Download MP3" })).not.toBeInTheDocument();
    }
  });

  it("offers no actions deferred to later milestones", () => {
    render(<CallDetailView call={call} operator />);
    for (const name of ["Export Call", "Purge Media"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    }
  });

  it("renders Transcript, Lead Assessment, and Lead Review entries in the processing timeline", () => {
    const timeline: CallDetail["timeline"] = [
      { id: "transcript", label: "Transcript completed", status: "Completed", at: "2026-10-16T20:07:00.000Z" },
      { id: "lead-assessment", label: "Lead Assessment failed", status: "Failed", at: "2026-10-16T20:08:00.000Z" },
      { id: "lead-review", label: "Lead Review added", status: "Completed", at: "2026-10-16T20:09:00.000Z" },
    ];
    render(<CallDetailView call={{ ...call, timeline }} operator />);
    const region = screen.getByRole("region", { name: "Processing timeline" });
    for (const label of ["Transcript completed", "Lead Assessment failed", "Lead Review added"]) expect(within(region).getByText(label)).toBeVisible();
    expect(within(region).getByText("Failed")).toBeVisible();
  });

  it("links back to the source list and steps to the previous and next Call in it", () => {
    render(
      <CallDetailView
        call={call}
        operator={false}
        navigation={{
          back: "/calls?sort=leadScore&order=asc",
          previous: "/workspaces/workspace-2/calls/call-0?back=%2Fcalls%3Fsort%3DleadScore%26order%3Dasc",
          next: "/workspaces/workspace-1/calls/call-2?back=%2Fcalls%3Fsort%3DleadScore%26order%3Dasc",
        }}
      />,
    );
    const header = screen.getByRole("heading", { level: 1 }).closest("header")!;
    expect(within(header).getByRole("link", { name: "Back to Calls" })).toHaveAttribute("href", "/calls?sort=leadScore&order=asc");
    const navigation = within(header).getByRole("group", { name: "Call navigation" });
    expect(within(navigation).getByRole("link", { name: "Previous Call" })).toHaveAttribute("href", "/workspaces/workspace-2/calls/call-0?back=%2Fcalls%3Fsort%3DleadScore%26order%3Dasc");
    expect(within(navigation).getByRole("link", { name: "Next Call" })).toHaveAttribute("href", "/workspaces/workspace-1/calls/call-2?back=%2Fcalls%3Fsort%3DleadScore%26order%3Dasc");
    expect(screen.getByRole("link", { name: "Back to Calls" }).compareDocumentPosition(screen.getByRole("heading", { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("disables previous or next Call at either end of the list", () => {
    render(<CallDetailView call={call} operator navigation={{ back: "/workspaces/workspace-1/calls", previous: null, next: "/workspaces/workspace-1/calls/call-2" }} />);
    expect(screen.getByRole("button", { name: "Previous Call" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Previous Call" })).toBeNull();
    expect(screen.getByRole("link", { name: "Next Call" })).toHaveAttribute("href", "/workspaces/workspace-1/calls/call-2");
  });

  it("falls back to Workspace Calls for the back link and renders no Workspace tabs", () => {
    render(<CallDetailView call={call} operator />);
    expect(screen.getByRole("link", { name: "Back to Calls" })).toHaveAttribute("href", "/workspaces/workspace-1/calls");
    expect(screen.getByRole("button", { name: "Previous Call" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next Call" })).toBeDisabled();
    expect(screen.queryByRole("navigation", { name: "Workspace" })).toBeNull();
  });
});
