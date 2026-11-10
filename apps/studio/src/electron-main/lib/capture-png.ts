import { crc32 } from "node:zlib";

/**
 * A PNG's own text chunk (iTXt) carrying JSON under one keyword, so what a
 * capture says about itself travels inside the picture: dragged into Slack,
 * Finder or another app's feedback, the file still names the build it came
 * from. Written just after the header, where a reader stops looking long
 * before the pixels.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const KEYWORD = "instrument-capture";

type Chunk = { data: Buffer; end: number; start: number; type: string };

function* chunksOf(png: Buffer): Generator<Chunk> {
  let offset = SIGNATURE.length;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > png.length) {
      return;
    }
    yield {
      data: png.subarray(offset + 8, offset + 8 + length),
      end,
      start: offset,
      type,
    };
    if (type === "IEND") {
      return;
    }
    offset = end;
  }
}

function chunk(type: string, data: Buffer) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** Whether `bytes` start as a PNG does. */
export function isPng(bytes: Buffer) {
  return (
    bytes.length >= SIGNATURE.length && bytes.subarray(0, 8).equals(SIGNATURE)
  );
}

/** The PNG with `value` as its capture text, replacing any it had. */
export function withCaptureText(png: Buffer, value: unknown): Buffer {
  if (!isPng(png)) {
    throw new Error("Not a PNG");
  }
  const text = Buffer.concat([
    Buffer.from(KEYWORD, "latin1"),
    // Keyword's end, then no compression, the method, an empty language tag
    // and an empty translated keyword.
    Buffer.from([0, 0, 0, 0, 0]),
    Buffer.from(JSON.stringify(value), "utf8"),
  ]);
  const parts: Buffer[] = [SIGNATURE];
  for (const each of chunksOf(png)) {
    if (each.type === "iTXt" && isCaptureText(each.data)) {
      continue;
    }
    parts.push(png.subarray(each.start, each.end));
    if (each.type === "IHDR") {
      parts.push(chunk("iTXt", text));
    }
  }
  return Buffer.concat(parts);
}

function isCaptureText(data: Buffer) {
  return data
    .subarray(0, KEYWORD.length + 1)
    .equals(Buffer.from(`${KEYWORD}\0`, "latin1"));
}

/** The capture text a PNG carries, parsed, or undefined for one that has none. */
export function readCaptureText(png: Buffer): unknown {
  if (!isPng(png)) {
    return undefined;
  }
  for (const each of chunksOf(png)) {
    if (each.type === "IDAT") {
      return undefined;
    }
    if (each.type === "iTXt" && isCaptureText(each.data)) {
      // Past the keyword's NUL: compression flag and method, then the
      // language tag and translated keyword, each ended by a NUL.
      let at = KEYWORD.length + 3;
      at = each.data.indexOf(0, at) + 1;
      at = each.data.indexOf(0, at) + 1;
      try {
        return JSON.parse(each.data.subarray(at).toString("utf8"));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
