/**
 * PROTOTYPE - throwaway. Serves a synthetic stereo WAV for the Call Detail
 * demo fixture: a soft tone in the Caller or Business channel wherever that
 * speaker has a Transcript turn, so the player really plays and the
 * waveform lanes line up with the Transcript. 404 in production.
 */
import { demoDurationSeconds, demoTurns } from "@/components/tracer/prototype/call-detail-fixture";

const sampleRate = 8000;

function build(): Uint8Array {
  const frames = demoDurationSeconds * sampleRate;
  const data = new Uint8Array(frames * 2);
  data.fill(128);
  for (const turn of demoTurns) {
    const channel = turn.speaker === "Caller" ? 0 : 1;
    const pitch = turn.speaker === "Caller" ? 230 : 170;
    const start = Math.floor((turn.startMs / 1000) * sampleRate);
    const end = Math.min(frames, Math.floor((turn.endMs / 1000) * sampleRate));
    for (let frame = start; frame < end; frame += 1) {
      const time = frame / sampleRate;
      // A syllable-ish envelope so the lane reads as speech, not a flat tone.
      const envelope = 0.35 + 0.65 * Math.abs(Math.sin(time * 4.3) * Math.sin(time * 1.7 + 0.4));
      const sample = Math.sin(2 * Math.PI * pitch * time) * envelope * 22;
      data[frame * 2 + channel] = 128 + Math.round(sample);
    }
  }
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const ascii = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + data.length, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 8, true);
  ascii(36, "data");
  view.setUint32(40, data.length, true);
  const wav = new Uint8Array(44 + data.length);
  wav.set(new Uint8Array(header), 0);
  wav.set(data, 44);
  return wav;
}

let cached: Uint8Array | null = null;

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  cached ??= build();
  const total = cached.length;
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  const start = range?.[1] ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
  const body = cached.slice(start, end + 1);
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      "content-type": "audio/wav",
      "accept-ranges": "bytes",
      "content-length": String(body.length),
      ...(range ? { "content-range": `bytes ${start}-${end}/${total}` } : {}),
      "cache-control": "private, no-store",
    },
  });
}
