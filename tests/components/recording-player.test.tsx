/**
 * -------------------------------------------------------------------------
 * @file   recording-player.test.tsx
 * @brief  Verifies the Call Detail Recording player and its states.
 *
 * @description
 *  Covers aligned Caller and Business lanes from precomputed peaks, the
 *  Mixed audio fallback, play and pause, elapsed and total time, the
 *  accessible seek control, scoped keyboard shortcuts, zoom, playback
 *  speed, volume and mute, playback without peaks, and the processing,
 *  failed, unavailable, and expired Recording states.
 *
 * @remarks
 *  wavesurfer.js draws to a canvas jsdom cannot render, so it is replaced
 *  at its module boundary and the test asserts what the player hands it.
 *  jsdom media elements cannot play, so play and pause dispatch their
 *  events the way a browser does. Base UI keeps a slider thumb hidden until
 *  it measures a layout box, which jsdom never computes, so element boxes
 *  get a fixed size.
 *
 * @see
 *  components/tracer/recording-player.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RecordingPlayer from "@/components/tracer/recording-player";
import type { RecordingAvailability } from "@/data/call-details";

const wavesurfer = vi.hoisted(() => ({
  instances: [] as { options: Record<string, unknown>; zoom: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[],
}));

vi.mock("wavesurfer.js", () => ({
  default: {
    create: (options: Record<string, unknown>) => {
      const instance = { options, zoom: vi.fn(), destroy: vi.fn() };
      wavesurfer.instances.push(instance);
      return instance;
    },
  },
}));
vi.mock("wavesurfer.js/plugins/timeline", () => ({ default: { create: vi.fn(() => ({ name: "timeline" })) } }));

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

let fetchMock: ReturnType<typeof vi.fn>;

function peaksResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function audio(): HTMLAudioElement {
  const element = document.querySelector("audio");
  if (!element) throw new Error("audio element missing");
  return element;
}

async function renderReady(recording = ready, peaks: unknown = dualPeaks) {
  fetchMock.mockResolvedValue(peaksResponse(peaks));
  render(<RecordingPlayer workspaceId="workspace-1" recording={recording} />);
  if (recording.waveform) await waitFor(() => expect(wavesurfer.instances).toHaveLength(1));
}

beforeEach(() => {
  wavesurfer.instances.length = 0;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
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
  it("renders aligned Caller and Business lanes from precomputed peaks over the streamed Recording", async () => {
    await renderReady();
    expect(fetchMock).toHaveBeenCalledWith("/api/workspaces/workspace-1/recordings/recording-1/peaks", expect.anything());
    expect(audio().getAttribute("src")).toBe("/api/workspaces/workspace-1/recordings/recording-1/audio");
    const options = wavesurfer.instances[0].options;
    expect(options.media).toBe(audio());
    expect(options.peaks).toEqual(dualPeaks.peaks);
    expect(options.duration).toBe(83);
    expect(options.splitChannels).toHaveLength(2);
    const waveform = screen.getByRole("group", { name: "Waveform" });
    expect(within(waveform).getByText("Caller")).toBeVisible();
    expect(within(waveform).getByText("Business")).toBeVisible();
  });

  it("labels a single-channel Recording as one Mixed audio lane", async () => {
    await renderReady({ ...ready, channels: 1, lanes: ["Mixed"] }, mixedPeaks);
    expect(wavesurfer.instances[0].options.splitChannels).toBeUndefined();
    const waveform = screen.getByRole("group", { name: "Waveform" });
    expect(within(waveform).getByText("Mixed audio")).toBeVisible();
    expect(within(waveform).queryByText("Caller")).not.toBeInTheDocument();
  });

  it("plays and pauses and shows elapsed and total time as text", async () => {
    await renderReady();
    expect(screen.getByText("0:00 / 1:23")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
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

  it("handles keyboard shortcuts inside the player without hijacking typing elsewhere", async () => {
    render(<input aria-label="Notes" />);
    await renderReady();
    const waveform = screen.getByRole("group", { name: "Waveform" });
    fireEvent.keyDown(waveform, { key: "k" });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(waveform, { key: " " });
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(waveform, { key: "ArrowRight" });
    fireEvent.keyDown(waveform, { key: "ArrowRight" });
    expect(audio().currentTime).toBe(10);
    fireEvent.keyDown(waveform, { key: "ArrowLeft" });
    expect(audio().currentTime).toBe(5);
    expect(screen.getByText("0:05 / 1:23")).toBeVisible();
    fireEvent.keyDown(waveform, { key: "m" });
    expect(audio().muted).toBe(true);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Notes" }), { key: "k" });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it("zooms the waveform in and out from fit", async () => {
    await renderReady();
    const instance = wavesurfer.instances[0];
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(instance.zoom).toHaveBeenLastCalledWith(50);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(instance.zoom).toHaveBeenLastCalledWith(25);
    fireEvent.keyDown(screen.getByRole("group", { name: "Waveform" }), { key: "-" });
    expect(instance.zoom).toHaveBeenLastCalledWith(0);
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

  it("starts the reduced-motion player without auto-centering the playhead", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), addEventListener: () => undefined, removeEventListener: () => undefined }));
    await renderReady();
    expect(wavesurfer.instances[0].options.autoCenter).toBe(false);
  });

  it("keeps playback and seeking available when the peaks request fails, explains it, and retries", async () => {
    fetchMock.mockResolvedValueOnce(peaksResponse({ error: "not_found" }, 404));
    render(<RecordingPlayer workspaceId="workspace-1" recording={ready} />);
    expect(await screen.findByText("Waveform unavailable. Use the seek control or keyboard shortcuts to move through the audio.")).toBeVisible();
    expect(wavesurfer.instances).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
    expect(screen.getByRole("slider", { name: "Seek" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    fetchMock.mockResolvedValueOnce(peaksResponse(dualPeaks));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(wavesurfer.instances).toHaveLength(1));
  });

  it("plays a Recording whose waveform failed without requesting peaks", async () => {
    await renderReady({ ...ready, waveform: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Waveform unavailable. Use the seek control or keyboard shortcuts to move through the audio.")).toBeVisible();
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
