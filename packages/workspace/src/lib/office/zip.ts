import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Just enough of the ZIP format to read an Office package's parts and write
 * it back with some of them replaced, every other part copied byte for
 * byte, compressed data included. No ZIP64 and no encryption, which no
 * Office package uses.
 */

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * The most a part inflates to: well past any real sheet's XML, and short of
 * what a crafted package inflating to gigabytes would take the process down
 * with.
 */
const MAX_PART_BYTES = 1024 * 1024 * 1024;

type Entry = {
  centralHeader: Buffer;
  compressedSize: number;
  method: number;
  /** What the central directory says the part inflates to. */
  size: number;
  name: string;
  offset: number;
};

export class ZipPackage {
  private constructor(
    private readonly bytes: Buffer,
    private readonly entries: Entry[],
    private readonly comment: Buffer,
  ) {}

  static read(bytes: Uint8Array): ZipPackage {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
    // The end record is the last 22 bytes, before a comment of up to 64 KB.
    let end = -1;
    for (
      let at = buffer.length - 22;
      at >= Math.max(0, buffer.length - 22 - 0xffff);
      at--
    ) {
      if (buffer.readUInt32LE(at) === EOCD) {
        end = at;
        break;
      }
    }
    if (end < 0) {
      throw new Error("not a ZIP file");
    }
    const count = buffer.readUInt16LE(end + 10);
    const centralOffset = buffer.readUInt32LE(end + 16);
    if (count === 0xffff || centralOffset === 0xffffffff) {
      throw new Error("ZIP64 packages are not supported");
    }
    const commentLength = buffer.readUInt16LE(end + 20);
    const entries: Entry[] = [];
    let at = centralOffset;
    for (let i = 0; i < count; i++) {
      if (buffer.readUInt32LE(at) !== CENTRAL) {
        throw new Error("damaged ZIP central directory");
      }
      const flags = buffer.readUInt16LE(at + 8);
      if (flags & 1) {
        throw new Error("encrypted ZIP packages are not supported");
      }
      const nameLength = buffer.readUInt16LE(at + 28);
      const extraLength = buffer.readUInt16LE(at + 30);
      const entryComment = buffer.readUInt16LE(at + 32);
      const length = 46 + nameLength + extraLength + entryComment;
      entries.push({
        centralHeader: buffer.subarray(at, at + length),
        compressedSize: buffer.readUInt32LE(at + 20),
        method: buffer.readUInt16LE(at + 10),
        name: buffer.toString("utf8", at + 46, at + 46 + nameLength),
        offset: buffer.readUInt32LE(at + 42),
        size: buffer.readUInt32LE(at + 24),
      });
      at += length;
    }
    return new ZipPackage(
      buffer,
      entries,
      buffer.subarray(end + 22, end + 22 + commentLength),
    );
  }

  names(): string[] {
    return this.entries.map((entry) => entry.name);
  }

  has(name: string): boolean {
    return this.entries.some((entry) => entry.name === name);
  }

  /** A part's bytes, inflated. */
  get(name: string): Buffer | undefined {
    const entry = this.entries.find((each) => each.name === name);
    if (!entry) {
      return undefined;
    }
    const at = entry.offset;
    if (this.bytes.readUInt32LE(at) !== LOCAL) {
      throw new Error(`damaged ZIP entry ${name}`);
    }
    const start =
      at +
      30 +
      this.bytes.readUInt16LE(at + 26) +
      this.bytes.readUInt16LE(at + 28);
    const data = this.bytes.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) {
      return Buffer.from(data);
    }
    if (entry.method === 8) {
      if (entry.size > MAX_PART_BYTES) {
        throw new Error(`ZIP part ${name} is too large to read`);
      }
      // No larger than the directory says, so a part that claims to be small
      // and inflates without end stops there.
      return inflateRawSync(data, { maxOutputLength: Math.max(entry.size, 1) });
    }
    throw new Error(`unsupported ZIP compression in ${name}`);
  }

  text(name: string): string | undefined {
    return this.get(name)?.toString("utf8");
  }

  /**
   * The package with each part in `replaced` written anew, deflated, and
   * every other part copied as it was, in the same order.
   */
  withParts(replaced: ReadonlyMap<string, Buffer>): Buffer {
    const sorted = [...this.entries].sort((a, b) => a.offset - b.offset);
    const centralStart = this.bytes.readUInt32LE(this.endRecordOffset() + 16);
    // Where each entry's local record ends: at the next one, or the central
    // directory, so a data descriptor after it travels with it.
    const ends = new Map(
      sorted.map((entry, i) => [entry, sorted[i + 1]?.offset ?? centralStart]),
    );
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const entry of this.entries) {
      const replacement = replaced.get(entry.name);
      let local: Buffer;
      let central: Buffer;
      if (replacement === undefined) {
        local = this.bytes.subarray(entry.offset, ends.get(entry));
        central = Buffer.from(entry.centralHeader);
      } else {
        const compressed = deflateRawSync(replacement);
        const sum = crc32(replacement);
        const name = Buffer.from(entry.name, "utf8");
        const header = Buffer.alloc(30);
        header.writeUInt32LE(LOCAL, 0);
        header.writeUInt16LE(20, 4);
        // UTF-8 names, and sizes in this header rather than a descriptor.
        header.writeUInt16LE(0x0800, 6);
        header.writeUInt16LE(8, 8);
        // The time and date of the part it replaces.
        header.writeUInt32LE(entry.centralHeader.readUInt32LE(12), 10);
        header.writeUInt32LE(sum, 14);
        header.writeUInt32LE(compressed.length, 18);
        header.writeUInt32LE(replacement.length, 22);
        header.writeUInt16LE(name.length, 26);
        header.writeUInt16LE(0, 28);
        local = Buffer.concat([header, name, compressed]);
        central = Buffer.from(entry.centralHeader);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(8, 10);
        central.writeUInt32LE(sum, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(replacement.length, 24);
      }
      central.writeUInt32LE(offset, 42);
      locals.push(local);
      centrals.push(central);
      offset += local.length;
    }
    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(EOCD, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(this.comment.length, 20);
    return Buffer.concat([...locals, directory, end, this.comment]);
  }

  private endRecordOffset(): number {
    return this.bytes.length - 22 - this.comment.length;
  }
}

/** A new package of `parts`, deflated, for tests and fixtures. */
export function zipOf(parts: ReadonlyMap<string, Buffer | string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [entryName, content] of parts) {
    const data = Buffer.from(content);
    const compressed = deflateRawSync(data);
    const sum = crc32(data);
    const name = Buffer.from(entryName, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(Buffer.concat([local, name, compressed]));
    centrals.push(Buffer.concat([central, name]));
    offset += 30 + name.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(parts.size, 8);
  end.writeUInt16LE(parts.size, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
