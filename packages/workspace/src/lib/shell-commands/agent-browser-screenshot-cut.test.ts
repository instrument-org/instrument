import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cutScreenshotNote,
  MAX_SCREENSHOT_PIXELS,
} from "./agent-browser-screenshot-cut";

/** A PNG that declares a size, which is all a reader of its size opens. */
function pngOf(width: number, height: number) {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    // The checksum is left empty: nothing here checks it.
    return Buffer.concat([length, Buffer.from(type), data, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc(0))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("cutScreenshotNote", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "screenshot-cut-"));
  });
  afterAll(async () => {
    await fs.rm(dir, { force: true, recursive: true });
  });

  async function noteFor(width: number, height: number) {
    const file = path.join(dir, `${width}x${height}.png`);
    await fs.writeFile(file, pngOf(width, height));
    return await cutScreenshotNote(file);
  }

  it("says nothing of a screenshot smaller than the most one has", async () => {
    expect(await noteFor(2560, MAX_SCREENSHOT_PIXELS - 1)).toBeUndefined();
  });

  it("says a screenshot as tall as one gets may stop short of the page", async () => {
    expect(await noteFor(2560, MAX_SCREENSHOT_PIXELS)).toMatchInlineSnapshot(`"The screenshot is 16384 pixels tall, the most one has: anything of the page past that is not in it. For the rest, capture an element lower down (\`screenshot <selector>\`), scroll and capture the viewport, or \`pdf\` the page."`);
  });

  it("names both sides when both are at the most", async () => {
    expect(
      await noteFor(MAX_SCREENSHOT_PIXELS, MAX_SCREENSHOT_PIXELS),
    ).toContain("16384 pixels tall and wide");
  });

  it("says nothing of a file it cannot read as an image", async () => {
    expect(await cutScreenshotNote(path.join(dir, "missing.png"))).toBe(
      undefined,
    );
  });
});
