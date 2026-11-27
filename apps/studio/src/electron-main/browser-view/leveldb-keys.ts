import fs from "node:fs";
import path from "node:path";

/**
 * The keys a LevelDB database holds that start with `prefix`, read from its
 * files rather than by opening it, which the process holding it open
 * forbids: every table (`.ldb`, `.sst`) and write-ahead log (`.log`) in the
 * folder, the newest write of a key saying whether it is there. Values are
 * skipped, never kept. A file gone by the time it is read (a compaction) or
 * cut short (a log being written) gives what it has.
 *
 * Chromium keeps a profile's Local Storage this way, its keys naming the
 * origins it holds data for.
 */
export async function levelDbKeys(
  dir: string,
  prefix: string,
): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return [];
  }
  const wanted = Buffer.from(prefix, "latin1");
  const newest = new Map<string, { live: boolean; sequence: number }>();
  const write = (key: Uint8Array, sequence: number, live: boolean) => {
    if (wanted.some((byte, index) => key[index] !== byte)) {
      return;
    }
    const name = Buffer.from(key).toString("latin1");
    const seen = newest.get(name);
    if (seen === undefined || sequence > seen.sequence) {
      newest.set(name, { live, sequence });
    }
  };
  for (const name of names) {
    const extension = path.extname(name);
    if (extension !== ".ldb" && extension !== ".sst" && extension !== ".log") {
      continue;
    }
    let file: Buffer;
    try {
      file = await fs.promises.readFile(path.join(dir, name));
    } catch {
      continue;
    }
    try {
      if (extension === ".log") {
        readLog(file, write);
      } else {
        readTable(file, write);
      }
    } catch {
      // A file cut short or not LevelDB's: what it gave so far stands.
    }
  }
  return [...newest]
    .filter(([, { live }]) => live)
    .map(([key]) => key)
    .toSorted();
}

type Write = (key: Uint8Array, sequence: number, live: boolean) => void;

/** A varint at `at`, and where the bytes after it start. */
function varint(bytes: Uint8Array, at: number): [number, number] {
  let value = 0;
  let shift = 0;
  for (let index = at; index < bytes.length; index += 1) {
    const byte = bytes[index] ?? 0;
    value += (byte & 0x7f) * 2 ** shift;
    shift += 7;
    if (byte < 0x80) {
      return [value, index + 1];
    }
  }
  throw new Error("varint runs past the end");
}

function u32(bytes: Uint8Array, at: number): number {
  if (at + 4 > bytes.length) {
    throw new Error("u32 runs past the end");
  }
  return (
    ((bytes[at] ?? 0) |
      ((bytes[at + 1] ?? 0) << 8) |
      ((bytes[at + 2] ?? 0) << 16) |
      ((bytes[at + 3] ?? 0) << 24)) >>>
    0
  );
}

/**
 * A block compressed with Snappy, as LevelDB compresses a table's blocks:
 * its length, then literals and copies of what came before.
 */
export function unsnappy(input: Uint8Array): Uint8Array {
  const [length, start] = varint(input, 0);
  const output = new Uint8Array(length);
  let read = start;
  let written = 0;
  while (read < input.length) {
    const tag = input[read] ?? 0;
    read += 1;
    if ((tag & 3) === 0) {
      let size = tag >> 2;
      if (size >= 60) {
        const bytes = size - 59;
        size = 0;
        for (let index = 0; index < bytes; index += 1) {
          size += (input[read + index] ?? 0) * 2 ** (8 * index);
        }
        read += bytes;
      }
      size += 1;
      if (read + size > input.length || written + size > length) {
        throw new Error("literal runs past the end");
      }
      output.set(input.subarray(read, read + size), written);
      read += size;
      written += size;
      continue;
    }
    let size: number;
    let offset: number;
    if ((tag & 3) === 1) {
      size = ((tag >> 2) & 7) + 4;
      offset = ((tag >> 5) << 8) | (input[read] ?? 0);
      read += 1;
    } else if ((tag & 3) === 2) {
      size = (tag >> 2) + 1;
      offset = (input[read] ?? 0) | ((input[read + 1] ?? 0) << 8);
      read += 2;
    } else {
      size = (tag >> 2) + 1;
      offset = u32(input, read);
      read += 4;
    }
    if (offset === 0 || offset > written || written + size > length) {
      throw new Error("copy reaches outside the block");
    }
    // Byte by byte: a copy may overlap what it is writing.
    for (let index = 0; index < size; index += 1) {
      output[written] = output[written - offset] ?? 0;
      written += 1;
    }
  }
  return output;
}

/** A table's block at a handle: its bytes, uncompressed. */
function block(file: Uint8Array, offset: number, size: number): Uint8Array {
  if (offset + size + 5 > file.length) {
    throw new Error("block runs past the end");
  }
  const bytes = file.subarray(offset, offset + size);
  // The byte after a block says how it is compressed: 0 not, 1 Snappy.
  return file[offset + size] === 1 ? unsnappy(bytes) : bytes;
}

/** A block's entries, each key whole: a key keeps the start it shares with the one before it. */
function* entries(
  bytes: Uint8Array,
): Generator<{ key: Uint8Array; value: Uint8Array }> {
  const restarts = u32(bytes, bytes.length - 4);
  const end = bytes.length - 4 - restarts * 4;
  let key = new Uint8Array(0);
  let at = 0;
  while (at < end) {
    let shared: number;
    let unshared: number;
    let valueSize: number;
    [shared, at] = varint(bytes, at);
    [unshared, at] = varint(bytes, at);
    [valueSize, at] = varint(bytes, at);
    const next = new Uint8Array(shared + unshared);
    next.set(key.subarray(0, shared));
    next.set(bytes.subarray(at, at + unshared), shared);
    key = next;
    at += unshared;
    yield { key, value: bytes.subarray(at, at + valueSize) };
    at += valueSize;
  }
}

/** The number LevelDB ends every table with. */
const TABLE_MAGIC = [0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb];

/**
 * A table's keys: its footer names the index block, whose entries name the
 * data blocks, whose keys end in eight bytes of the write's sequence number
 * and whether it put the key or deleted it.
 */
function readTable(file: Uint8Array, write: Write) {
  const footer = file.subarray(file.length - 48);
  if (TABLE_MAGIC.some((byte, index) => footer[40 + index] !== byte)) {
    return;
  }
  let at = 0;
  [, at] = varint(footer, at);
  [, at] = varint(footer, at);
  const [indexOffset, afterOffset] = varint(footer, at);
  const [indexSize] = varint(footer, afterOffset);
  for (const { value } of entries(block(file, indexOffset, indexSize))) {
    const [offset, afterDataOffset] = varint(value, 0);
    const [size] = varint(value, afterDataOffset);
    for (const { key } of entries(block(file, offset, size))) {
      if (key.length < 8) {
        continue;
      }
      const trailer = key.length - 8;
      const low = u32(key, trailer);
      const sequence = u32(key, trailer + 4) * 2 ** 24 + (low >>> 8);
      write(key.subarray(0, trailer), sequence, (low & 0xff) === 1);
    }
  }
}

const LOG_BLOCK = 32_768;
const LOG_HEADER = 7;
const RECORD = { first: 2, full: 1, last: 4, middle: 3 } as const;

/**
 * A write-ahead log's keys: records in blocks of 32 KiB, a batch split
 * across them where it does not fit, each batch a sequence number, a count,
 * and its puts and deletes in order.
 */
function readLog(file: Uint8Array, write: Write) {
  let parts: Uint8Array[] = [];
  for (let blockStart = 0; blockStart < file.length; blockStart += LOG_BLOCK) {
    const blockEnd = Math.min(blockStart + LOG_BLOCK, file.length);
    let at = blockStart;
    while (at + LOG_HEADER <= blockEnd) {
      const size = (file[at + 4] ?? 0) | ((file[at + 5] ?? 0) << 8);
      const type = file[at + 6] ?? 0;
      const body = file.subarray(at + LOG_HEADER, at + LOG_HEADER + size);
      at += LOG_HEADER + size;
      if (type === 0 || at > blockEnd) {
        // The block's zeroed tail, or a record still being written.
        break;
      }
      if (type === RECORD.full) {
        readBatch(body, write);
      } else if (type === RECORD.first) {
        parts = [body];
      } else if (type === RECORD.middle) {
        parts.push(body);
      } else if (type === RECORD.last) {
        readBatch(Buffer.concat([...parts, body]), write);
        parts = [];
      }
    }
  }
}

function readBatch(batch: Uint8Array, write: Write) {
  let sequence = u32(batch, 0) + u32(batch, 4) * 2 ** 32;
  const count = u32(batch, 8);
  let at = 12;
  for (let index = 0; index < count; index += 1) {
    const kind = batch[at];
    if (kind !== 0 && kind !== 1) {
      throw new Error("not a put or a delete");
    }
    at += 1;
    let size: number;
    [size, at] = varint(batch, at);
    const key = batch.subarray(at, at + size);
    at += size;
    if (kind === 1) {
      [size, at] = varint(batch, at);
      at += size;
    }
    write(key, sequence, kind === 1);
    sequence += 1;
  }
}
