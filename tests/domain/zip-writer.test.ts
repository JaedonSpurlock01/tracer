/**
 * -------------------------------------------------------------------------
 * @file   zip-writer.test.ts
 * @brief  Verifies the streaming STORE-mode ZIP writer behind Recording exports.
 *
 * @description
 *  Writes archives through the ZIP writer into an in-memory sink and reads
 *  them back with the dev-only fflate reader, checking that every entry is
 *  stored without compression under its exact UTF-8 name and bytes, that
 *  bytes reach the sink entry by entry rather than only at the end, and
 *  that the ZIP64 records a multi-gigabyte archive needs are written and
 *  readable, using a small injected ZIP64 threshold instead of real
 *  4 GiB data.
 *
 * @remarks
 *  fflate is a devDependency used only as an independent reader. Entry
 *  bytes are fixed, non-round fixture data.
 *
 * @see
 *  data/zip-writer.ts
 *  https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { createZipWriter } from "@/data/zip-writer";

const modifiedAt = new Date("2026-10-14T15:41:27.906Z");

const encoder = new TextEncoder();

const mp3 = Uint8Array.from({ length: 3_217 }, (_, index) => (index * 37 + 11) % 251);

function memorySink() {
  const chunks: Uint8Array[] = [];
  return {
    chunks,
    async write(chunk: Uint8Array) {
      chunks.push(chunk.slice());
    },
    bytes() {
      const total = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
      chunks.reduce((offset, chunk) => (total.set(chunk, offset), offset + chunk.byteLength), 0);
      return total;
    },
  };
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function centralEntries(bytes: Uint8Array): Array<{ method: number; name: string }> {
  const data = view(bytes);
  const entries = [];
  for (let offset = 0; offset + 4 <= bytes.byteLength; offset += 1) {
    if (data.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = data.getUint16(offset + 28, true);
    entries.push({ method: data.getUint16(offset + 10, true), name: new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength)) });
  }
  return entries;
}

function signatureOffsets(bytes: Uint8Array, signature: number): number[] {
  const data = view(bytes);
  const offsets = [];
  for (let offset = 0; offset + 4 <= bytes.byteLength; offset += 1) if (data.getUint32(offset, true) === signature) offsets.push(offset);
  return offsets;
}

describe("ZIP writer", () => {
  it("stores every entry uncompressed under its UTF-8 name, readable by a standard unzip", async () => {
    const sink = memorySink();
    const zip = createZipWriter(sink);

    await zip.addFile("recordings/20261006-114731_north-reviewed.mp3", mp3, modifiedAt);
    expect(sink.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)).toBeGreaterThan(mp3.byteLength);
    await zip.addFile("manifest.csv", encoder.encode("Call ID,Workspace\r\nnorth-reviewed,Nørth Plumbing\r\n"), modifiedAt);
    const { byteSize } = await zip.finish();

    const bytes = sink.bytes();
    expect(byteSize).toBe(bytes.byteLength);
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual(["recordings/20261006-114731_north-reviewed.mp3", "manifest.csv"]);
    expect(files["recordings/20261006-114731_north-reviewed.mp3"]).toEqual(mp3);
    expect(new TextDecoder().decode(files["manifest.csv"])).toBe("Call ID,Workspace\r\nnorth-reviewed,Nørth Plumbing\r\n");
    expect(centralEntries(bytes)).toEqual([
      { method: 0, name: "recordings/20261006-114731_north-reviewed.mp3" },
      { method: 0, name: "manifest.csv" },
    ]);
    expect(signatureOffsets(bytes, 0x06064b50)).toEqual([]);
  });

  it("writes ZIP64 sizes, offsets, and end records once an archive passes the 32-bit limit, still readable by a standard unzip", async () => {
    const sink = memorySink();
    const zip = createZipWriter(sink, { zip64Threshold: 1_843 });

    await zip.addFile("recordings/20261011-175841_south-assessed.mp3", mp3, modifiedAt);
    await zip.addFile("manifest.csv", encoder.encode("Call ID\r\nsouth-assessed\r\n"), modifiedAt);
    const { byteSize } = await zip.finish();

    const bytes = sink.bytes();
    expect(byteSize).toBe(bytes.byteLength);
    const files = unzipSync(bytes);
    expect(files["recordings/20261011-175841_south-assessed.mp3"]).toEqual(mp3);
    expect(new TextDecoder().decode(files["manifest.csv"])).toBe("Call ID\r\nsouth-assessed\r\n");
    const [record] = signatureOffsets(bytes, 0x06064b50);
    const [locator] = signatureOffsets(bytes, 0x07064b50);
    expect(locator).toBe(record + 56);
    expect(Number(view(bytes).getBigUint64(locator + 8, true))).toBe(record);
    expect(Number(view(bytes).getBigUint64(record + 32, true))).toBe(2);
    const [mp3Entry] = signatureOffsets(bytes, 0x02014b50);
    expect(view(bytes).getUint32(mp3Entry + 20, true)).toBe(0xffffffff);
    expect(view(bytes).getUint16(mp3Entry + 6, true)).toBe(45);
  });
});
