import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withTempDir } from "../test/helpers/temp-dir";
import {
  CachedReads,
  keptByNameOnly,
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

  it.runIf(process.platform === "darwin")(
    "waits for a file kept in the cloud only",
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

  it("keeps only the files a prune names", async () => {
    const kept = await write("kept.md", "kept");
    const gone = await write("gone.md", "gone");
    const parse = vi.fn((text: string) => text);
    const reads = new CachedReads(parse);
    await reads.read(kept);
    await reads.read(gone);

    reads.prune([kept]);
    await reads.read(kept);
    await reads.read(gone);

    expect(parse.mock.calls.map(([text]) => text)).toEqual([
      "kept",
      "gone",
      "gone",
    ]);
  });
});
