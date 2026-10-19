/**
 * -------------------------------------------------------------------------
 * @file   zip-writer.ts
 * @brief  Streams a STORE-mode ZIP archive entry by entry into a byte sink.
 *
 * @description
 *  Writes each file as a local header followed by its bytes, uncompressed,
 *  straight into the sink, then writes the central directory and end
 *  record on finish. Only the small central directory records are kept in
 *  memory, never the archive. Names are UTF-8 and flagged as such. Once an
 *  entry's size or offset, or the central directory, reaches the 32-bit
 *  limit, the writer switches to ZIP64 extra fields and end records, so
 *  an export of 500 multi-hour MP3s past 4 GiB stays readable.
 *
 * @remarks
 *  Recording MP3s are already compressed, so deflate would cost CPU and
 *  save almost nothing; STORE also lets the CRC and sizes go in the local
 *  header, because each entry's bytes are known before it is written, so
 *  no data descriptor is needed. Node's built-in zlib CRC-32 computes the
 *  checksum. A small writer replaces a dependency because the maintained
 *  small streaming ZIP libraries either omit ZIP64 writing, as fflate
 *  does, or pull in Node stream stacks, as archiver and yazl do, while
 *  STORE with ZIP64 is a few fixed record layouts. The ZIP64 threshold can
 *  be lowered so tests reach that path without gigabytes of data. Entry
 *  times are UTC in the DOS date and time fields.
 *
 * @see
 *  data/report-generation.ts
 *  https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { crc32 } from "node:zlib";

export interface ZipSink {
  write(chunk: Uint8Array): Promise<void>;
}

export interface ZipWriter {
  addFile(name: string, data: Uint8Array, modifiedAt: Date): Promise<void>;
  finish(): Promise<{ byteSize: number }>;
}

const utf8Flag = 0x0800;

const max32 = 0xffffffff;

const max16 = 0xffff;

function dosDateTime(at: Date): { date: number; time: number } {
  return {
    date: ((at.getUTCFullYear() - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
  };
}

interface CentralRecord {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  date: number;
  time: number;
  zip64: boolean;
}

function zip64Extra(values: number[]): Uint8Array {
  const extra = new Uint8Array(4 + values.length * 8);
  const view = new DataView(extra.buffer);
  view.setUint16(0, 0x0001, true);
  view.setUint16(2, values.length * 8, true);
  values.forEach((value, index) => view.setBigUint64(4 + index * 8, BigInt(value), true));
  return extra;
}

export function createZipWriter(sink: ZipSink, options: { zip64Threshold?: number } = {}): ZipWriter {
  const threshold = options.zip64Threshold ?? max32;
  const records: CentralRecord[] = [];
  let offset = 0;

  async function emit(bytes: Uint8Array): Promise<void> {
    await sink.write(bytes);
    offset += bytes.byteLength;
  }

  return {
    async addFile(fileName, data, modifiedAt) {
      const name = new TextEncoder().encode(fileName);
      const { date, time } = dosDateTime(modifiedAt);
      const zip64 = data.byteLength >= threshold || offset >= threshold;
      const record: CentralRecord = { name, crc: crc32(data), size: data.byteLength, offset, date, time, zip64 };
      const extra = zip64 ? zip64Extra([record.size, record.size]) : new Uint8Array(0);
      const header = new Uint8Array(30 + name.byteLength + extra.byteLength);
      const view = new DataView(header.buffer);
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, zip64 ? 45 : 20, true);
      view.setUint16(6, utf8Flag, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, time, true);
      view.setUint16(12, date, true);
      view.setUint32(14, record.crc, true);
      view.setUint32(18, zip64 ? max32 : record.size, true);
      view.setUint32(22, zip64 ? max32 : record.size, true);
      view.setUint16(26, name.byteLength, true);
      view.setUint16(28, extra.byteLength, true);
      header.set(name, 30);
      header.set(extra, 30 + name.byteLength);
      await emit(header);
      await emit(data);
      records.push(record);
    },

    async finish() {
      const directoryOffset = offset;
      for (const record of records) {
        const extra = record.zip64 ? zip64Extra([record.size, record.size, record.offset]) : new Uint8Array(0);
        const entry = new Uint8Array(46 + record.name.byteLength + extra.byteLength);
        const view = new DataView(entry.buffer);
        const version = record.zip64 ? 45 : 20;
        view.setUint32(0, 0x02014b50, true);
        view.setUint16(4, version, true);
        view.setUint16(6, version, true);
        view.setUint16(8, utf8Flag, true);
        view.setUint16(10, 0, true);
        view.setUint16(12, record.time, true);
        view.setUint16(14, record.date, true);
        view.setUint32(16, record.crc, true);
        view.setUint32(20, record.zip64 ? max32 : record.size, true);
        view.setUint32(24, record.zip64 ? max32 : record.size, true);
        view.setUint16(28, record.name.byteLength, true);
        view.setUint16(30, extra.byteLength, true);
        view.setUint32(42, record.zip64 ? max32 : record.offset, true);
        entry.set(record.name, 46);
        entry.set(extra, 46 + record.name.byteLength);
        await emit(entry);
      }
      const directorySize = offset - directoryOffset;
      const zip64 = records.length >= max16 || directoryOffset >= threshold || directorySize >= threshold;
      if (zip64) {
        const recordOffset = offset;
        const tail = new Uint8Array(56 + 20);
        const view = new DataView(tail.buffer);
        view.setUint32(0, 0x06064b50, true);
        view.setBigUint64(4, 44n, true);
        view.setUint16(12, 45, true);
        view.setUint16(14, 45, true);
        view.setBigUint64(24, BigInt(records.length), true);
        view.setBigUint64(32, BigInt(records.length), true);
        view.setBigUint64(40, BigInt(directorySize), true);
        view.setBigUint64(48, BigInt(directoryOffset), true);
        view.setUint32(56, 0x07064b50, true);
        view.setBigUint64(64, BigInt(recordOffset), true);
        view.setUint32(72, 1, true);
        await emit(tail);
      }
      const end = new Uint8Array(22);
      const view = new DataView(end.buffer);
      view.setUint32(0, 0x06054b50, true);
      view.setUint16(8, zip64 ? max16 : records.length, true);
      view.setUint16(10, zip64 ? max16 : records.length, true);
      view.setUint32(12, zip64 ? max32 : directorySize, true);
      view.setUint32(16, zip64 ? max32 : directoryOffset, true);
      await emit(end);
      return { byteSize: offset };
    },
  };
}
