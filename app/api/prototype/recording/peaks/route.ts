/**
 * PROTOTYPE - throwaway. Serves synthetic waveform peaks for the Call
 * Detail demo fixture, shaped from the Transcript turns so the Caller and
 * Business lanes line up with the text. 404 in production.
 */
import { demoDurationSeconds, demoTurns } from "@/components/tracer/prototype/call-detail-fixture";
import type { WaveformPeaks } from "@/data/recording-waveform";

const pixelsPerSecond = 50;

function build(): WaveformPeaks {
  const points = demoDurationSeconds * pixelsPerSecond;
  const lanes = ["Caller", "Business"] as const;
  const peaks = lanes.map((lane) =>
    Array.from({ length: points }, (_, index) => {
      const ms = (index / pixelsPerSecond) * 1000;
      const speaking = demoTurns.some((turn) => turn.speaker === lane && ms >= turn.startMs && ms < turn.endMs);
      if (!speaking) return 0.03;
      const time = ms / 1000;
      const envelope = 0.35 + 0.65 * Math.abs(Math.sin(time * 4.3) * Math.sin(time * 1.7 + 0.4));
      return Math.round(envelope * 0.9 * 100) / 100;
    }),
  );
  return { version: 1, sampleRate: 8000, samplesPerPixel: 8000 / pixelsPerSecond, pixelsPerSecond, durationSeconds: demoDurationSeconds, lanes: [...lanes], peaks };
}

export async function GET() {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  return Response.json(build(), { headers: { "cache-control": "private, no-store" } });
}
