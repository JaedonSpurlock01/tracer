/**
 * -------------------------------------------------------------------------
 * @file   recording-player.test.tsx
 * @brief  Verifies the Recording now-playing bar.
 *
 * @description
 *  Covers the mirrored Caller-over-Business waveform drawn from the
 *  precomputed peaks with each party's talk share, the Mixed audio lane,
 *  play and pause with elapsed and total time, auto play from Play
 *  Recording, the accessible seek control, the centered ten-second skips,
 *  scoped keyboard shortcuts, playback speed, volume, and mute, the peaks
 *  and audio failure states with Retry, and the processing, failed,
 *  unavailable, and expired Recording states.
 *
 * @remarks
 *  jsdom plays no media, so HTMLMediaElement play, pause, and load are
 *  replaced and the component is driven through the media element's
 *  events the way a browser does. jsdom has no ResizeObserver either, so
 *  one is stubbed that reports a fixed width, which is what sizes the SVG
 *  bars. Base UI keeps a slider thumb hidden until it is measured, so
 *  getBoundingClientRect is given a size.
 *
 * @see
 *  components/tracer/recording-player.tsx
 *  components/tracer/mirror-waveform.tsx
 *  components/tracer/recording-engine.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RecordingPlayer from "@/components/tracer/recording-player";
import type { RecordingAvailability } from "@/data/call-details";
import type { TranscriptTurn } from "@/data/transcript";

const ready: Extract<RecordingAvailability, { state: "Ready" }> = {
  state: "Ready",
  id: "recording-1",
  channels: 2,
  lanes: ["Caller", "Business"],
  durationSeconds: 83,
  waveform: true,
  expiresAt: "2027-10-17T15:00:00.000Z",
};
const dualPeaks = { version: 1, sampleRate: 8000, samplesPerPixel: 160, pixelsPerSecond: 50, durationSeconds: 83, lanes: ["Caller", "Business"], peaks: [[0.1, 0.5], [0.25, 1]] };
const mixedPeaks = { ...dualPeaks, lanes: ["Mixed"], peaks: [[0.2, 0.4]] };
const turns: TranscriptTurn[] = [
  { speaker: "Business", startMs: 0, endMs: 6000, text: "Thanks for calling." },
  { speaker: "Caller", startMs: 6000, endMs: 10000, text: "My water heater is leaking." },
];

let fetchMock: ReturnType<typeof vi.fn>;

function peaksResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function audio(): HTMLAudioElement {
  const element = document.querySelector("audio");
  if (!element) throw new Error("audio element missing");
  return element;
}

function waveform(): HTMLElement {
  return screen.getByRole("group", { name: "Waveform" });
}

async function renderReady(recording = ready, peaks: unknown = dualPeaks, props: { turns?: TranscriptTurn[]; autoPlay?: boolean } = {}) {
  fetchMock.mockResolvedValue(peaksResponse(peaks));
  render(<RecordingPlayer workspaceId="workspace-1" recording={recording} {...props} />);
  if (recording.waveform) await screen.findByRole("group", { name: "Waveform" });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: (entries: { contentRect: { width: number } }[]) => void) {}
      observe() {
        this.callback([{ contentRect: { width: 200 } }]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("pause"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 12, width: 200, height: 12, toJSON: () => ({}) });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RecordingPlayer", () => {
  it("draws Caller above and Business below one mirrored lane from precomputed peaks over the streamed Recording", async () => {
    await renderReady();
    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/workspace-1/recordings/recording-1/peaks", expect.anything());
    expect(audio().getAttribute("src")).toBe("/api/workspaces/workspace-1/recordings/recording-1/audio");
    expect(screen.getByText("Caller")).toBeVisible();
    expect(screen.getByText("Business")).toBeVisible();
    const bars = waveform().querySelectorAll("rect");
    expect(bars.length).toBeGreaterThan(0);
    expect(bars.length % 2).toBe(0);
    expect(bars[0]).toHaveAttribute("fill", "var(--chart-1)");
    expect(bars[1]).toHaveAttribute("fill", "var(--chart-2)");
  });

  it("labels each lane with that party's share of the spoken time when a Transcript exists", async () => {
    await renderReady(ready, dualPeaks, { turns });
    expect(screen.getByText("Caller (40%)")).toBeVisible();
    expect(screen.getByText("Business (60%)")).toBeVisible();
  });

  it("mirrors a single-channel Recording's one Mixed audio lane on both halves", async () => {
    await renderReady({ ...ready, channels: 1, lanes: ["Mixed"] }, mixedPeaks);
    expect(screen.getAllByText("Mixed audio")).toHaveLength(2);
    expect(screen.queryByText("Caller")).not.toBeInTheDocument();
  });

  it("plays and pauses, shows elapsed and total time, and says who is speaking", async () => {
    await renderReady(ready, dualPeaks, { turns });
    expect(screen.getByText("0:00")).toBeVisible();
    expect(screen.getByText("1:23")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Paused");
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status")).toHaveTextContent("Business speaking");
    audio().currentTime = 7;
    fireEvent.timeUpdate(audio());
    expect(screen.getByRole("status")).toHaveTextContent("Caller speaking");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Play" })).toBeVisible();
  });

  it("starts playback on open when asked to play, as from the Calls Play Recording action", async () => {
    fetchMock.mockResolvedValue(peaksResponse(dualPeaks));
    render(<RecordingPlayer workspaceId="workspace-1" recording={ready} autoPlay />);
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: "Pause" })).toBeVisible();
  });

  it("does not start playback on open by default", async () => {
    await renderReady();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("seeks with an accessible seek control that announces the time", async () => {
    await renderReady();
    const seek = screen.getByRole("slider", { name: "Seek" });
    expect(seek).toHaveAttribute("aria-valuetext", "0:00 of 1:23");
    fireEvent.keyDown(seek, { key: "ArrowRight" });
    expect(audio().currentTime).toBe(1);
    expect(screen.getByRole("slider", { name: "Seek" })).toHaveAttribute("aria-valuetext", "0:01 of 1:23");
    fireEvent.keyDown(screen.getByRole("slider", { name: "Seek" }), { key: "End" });
    expect(audio().currentTime).toBe(83);
  });

  it("skips ten seconds either way from the centered transport and seeks from the waveform", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Forward 10 seconds" }));
    expect(audio().currentTime).toBe(10);
    fireEvent.click(screen.getByRole("button", { name: "Forward 10 seconds" }));
    fireEvent.click(screen.getByRole("button", { name: "Back 10 seconds" }));
    expect(audio().currentTime).toBe(10);
    expect(screen.getByText("0:10")).toBeVisible();
    fireEvent.pointerDown(waveform(), { clientX: 100, pointerId: 1 });
    expect(audio().currentTime).toBeCloseTo(41.5);
  });

  it("handles keyboard shortcuts inside the player without hijacking typing elsewhere", async () => {
    render(<input aria-label="Notes" />);
    await renderReady();
    fireEvent.keyDown(waveform(), { key: "k" });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(waveform(), { key: " " });
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(waveform(), { key: "ArrowRight" });
    fireEvent.keyDown(waveform(), { key: "ArrowRight" });
    expect(audio().currentTime).toBe(10);
    fireEvent.keyDown(waveform(), { key: "ArrowLeft" });
    expect(audio().currentTime).toBe(5);
    expect(screen.getByText("0:05")).toBeVisible();
    fireEvent.keyDown(waveform(), { key: "m" });
    expect(audio().muted).toBe(true);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Notes" }), { key: "k" });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it("changes playback speed, volume, and mute", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("combobox", { name: "Playback speed" }));
    const option = await screen.findByRole("option", { name: "1.5x" });
    option.focus();
    fireEvent.keyDown(option, { key: "Enter" });
    await waitFor(() => expect(audio().playbackRate).toBe(1.5));
    const volume = screen.getByRole("slider", { name: "Volume" });
    expect(volume).toHaveAttribute("aria-valuetext", "100%");
    fireEvent.keyDown(volume, { key: "ArrowLeft" });
    expect(audio().volume).toBeCloseTo(0.9);
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(audio().muted).toBe(true);
    expect(await screen.findByRole("button", { name: "Unmute" })).toBeVisible();
  });

  it("keeps playback and seeking available when the peaks request fails, explains it, and retries", async () => {
    fetchMock.mockResolvedValueOnce(peaksResponse({ error: "not_found" }, 404));
    render(<RecordingPlayer workspaceId="workspace-1" recording={ready} />);
    expect(await screen.findByText("Waveform unavailable. Use the seek control or keyboard shortcuts to move through the audio.")).toBeVisible();
    expect(screen.queryByRole("group", { name: "Waveform" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
    expect(screen.getByRole("slider", { name: "Seek" })).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(peaksResponse(dualPeaks));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("group", { name: "Waveform" })).toBeVisible();
  });

  it("plays a Recording whose waveform failed without requesting peaks", async () => {
    await renderReady({ ...ready, waveform: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Waveform" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
  });

  it("explains a Recording audio load failure and retries it", async () => {
    await renderReady();
    fireEvent(audio(), new Event("error"));
    expect(await screen.findByText("Recording audio could not be loaded.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
    expect(screen.queryByText("Recording audio could not be loaded.")).not.toBeInTheDocument();
  });

  it("shows a player-shaped Skeleton with status while the Recording is processing", () => {
    render(<RecordingPlayer workspaceId="workspace-1" recording={{ state: "Processing", stage: "waveform" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Recording processing");
    expect(screen.getByText("The waveform is being generated.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Play" })).not.toBeInTheDocument();
    expect(document.querySelector("audio")).toBeNull();
  });

  it("explains failed, disabled, not captured, and expired Recordings without audio", () => {
    const cases: [RecordingAvailability, string, string][] = [
      [{ state: "Failed" }, "Recording unavailable", "The Recording could not be stored."],
      [{ state: "Unavailable", reason: "disabled" }, "Recording unavailable", "Recording was disabled for this Call."],
      [{ state: "Unavailable", reason: "not_captured" }, "Recording unavailable", "No Recording was captured for this Call."],
      [{ state: "Expired", expiredAt: "2026-01-01T00:00:00.000Z" }, "Recording expired", "Recording media is removed 12 months after the Call."],
    ];
    for (const [recording, title, detail] of cases) {
      render(<RecordingPlayer workspaceId="workspace-1" recording={recording} />);
      expect(screen.getByText(title)).toBeVisible();
      expect(screen.getByText(detail)).toBeVisible();
      expect(document.querySelector("audio")).toBeNull();
      expect(screen.queryByRole("button", { name: "Play" })).not.toBeInTheDocument();
      cleanup();
    }
  });
});
