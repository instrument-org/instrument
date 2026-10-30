import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withTempDir } from "../test/helpers/temp-dir";
import {
  CachedReads,
  keptByNameOnly,
  NOT_HERE_YET,
  readBytes,
  readHead,
  readLinesFrom,
  readText,
} from "./workspace-files";

const dir = withTempDir("workspace-files");

afterEach(() => {
  vi.restoreAllMocks();
});

async function write(name: string, text: string): Promise<string> {
  const file = path.join(dir.path, name);
  await fs.writeFile(file, text);
  return file;
}

/** Every file stats as one with contents and no blocks on disk: kept in the cloud only. */
function evictEverything() {
  const stat = fsSync.promises.stat;
  vi.spyOn(fsSync.promises, "stat").mockImplementation(async (file) =>
    Object.assign(await stat(file), { blocks: 0 }),
  );
  return vi.spyOn(fsSync.promises, "open");
}

describe("keptByNameOnly", () => {
  it.each([
    ["darwin", 12, 0, true],
    ["darwin", 12, 8, false],
    ["darwin", 0, 0, false],
    ["linux", 12, 0, false],
  ] as const)(
    "on %s, size %d and %d blocks: %s",
    (platform, size, blocks, kept) => {
      const stats = Object.assign(fsSync.statSync(dir.path), { blocks, size });
      vi.spyOn(stats, "isFile").mockReturnValue(true);
      expect(keptByNameOnly(stats, platform)).toBe(kept);
    },
  );

  it("never says a folder is kept by name only", () => {
    const stats = Object.assign(fsSync.statSync(dir.path), {
      blocks: 0,
      size: 64,
    });
    expect(keptByNameOnly(stats, "darwin")).toBe(false);
  });
});

describe("reads", () => {
  it("reads a whole file, its head, and its whole lines from an offset", async () => {
    const file = await write("log.jsonl", "one\ntwo\nthree\nhalf");
    expect({
      bytes: (await readBytes(file)).toString("utf8"),
      head: await readHead(file, 6),
      lines: await readLinesFrom(file, 4),
      text: await readText(file),
    }).toMatchInlineSnapshot(`
      {
        "bytes": "one
      two
      three
      half",
        "head": "one
      tw",
        "lines": {
          "end": 14,
          "lines": [
            "two",
            "three",
          ],
        },
        "text": "one
      two
      three
      half",
      }
    `);
  });

  it("fails for a file that is not there", async () => {
    await expect(
      readText(path.join(dir.path, "missing.md")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.runIf(process.platform === "darwin").each([
    ["readText", (file: string) => readText(file, { evicted: "pass" })],
    ["readBytes", (file: string) => readBytes(file, { evicted: "pass" })],
    ["readHead", (file: string) => readHead(file, 8, { evicted: "pass" })],
    [
      "readLinesFrom",
      (file: string) => readLinesFrom(file, 0, { evicted: "pass" }),
    ],
    [
      "CachedReads",
      (file: string) =>
        new CachedReads((text) => text).read(file, { evicted: "pass" }),
    ],
  ])(
    "%s passes over a file kept in the cloud only, unopened",
    async (_name, read) => {
      const file = await write("APP.md", "contents\n");
      const opened = evictEverything();
      expect(await read(file)).toBe(NOT_HERE_YET);
      expect(opened).not.toHaveBeenCalled();
    },
  );

  it.runIf(process.platform === "darwin")(
    "waits for a file kept in the cloud only unless asked to pass over it",
    async () => {
      const file = await write("APP.md", "contents\n");
      evictEverything();
      expect(await readText(file)).toBe("contents\n");
    },
  );
});

describe("CachedReads", () => {
  it("reads a file again only once its size or modification time changes", async () => {
    const file = await write("APP.md", "first");
    const parse = vi.fn((text: string) => text.toUpperCase());
    const reads = new CachedReads(parse);
    expect(await reads.read(file)).toBe("FIRST");
    expect(await reads.read(file)).toBe("FIRST");
    expect(parse).toHaveBeenCalledTimes(1);
    await fs.writeFile(file, "second");
    expect(await reads.read(file)).toBe("SECOND");
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it.runIf(process.platform === "darwin")(
    "answers what it kept for a file evicted since, without passing over it",
    async () => {
      const file = await write("APP.md", "kept");
      const reads = new CachedReads((text) => text);
      await reads.read(file);
      evictEverything();
      expect(await reads.read(file, { evicted: "pass" })).toBe("kept");
    },
  );
});
