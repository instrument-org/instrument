import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type KeptVersion, keepVersion, trimVersions } from "./file-versions";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "versions-"));
});
afterEach(async () => {
  await fs.rm(dir, { force: true, recursive: true });
});

/** Where a kept version's copy is, from `dir`. */
const at = (version: KeptVersion | undefined) =>
  path.relative(dir, version?.copy ?? "");

describe("keepVersion", () => {
  it("numbers a file's versions in a folder named for it, the newest's contents keeping its number", async () => {
    const file = path.join(dir, "moon.svg");
    const folder = path.join(dir, "Versions");
    const kept: KeptVersion[] = [];
    const keep = async (contents: string) => {
      await fs.writeFile(file, contents);
      const version = await keepVersion({ file, folder, kept });
      if (version) {
        kept.push(version);
      }
      return version;
    };
    await keep("<svg>small</svg>");
    await keep("<svg>small</svg>");
    await keep("<svg>big</svg>");
    await keep("<svg>small</svg>");
    expect(
      kept.map(
        (version) =>
          `v${String(version.number)} ${at(version).split(path.sep).join("/")}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "v1 Versions/moon.svg/v1.svg",
        "v1 Versions/moon.svg/v1.svg",
        "v2 Versions/moon.svg/v2.svg",
        "v3 Versions/moon.svg/v3.svg",
      ]
    `);
    expect(await fs.readFile(kept[0]?.copy ?? "", "utf8")).toBe(
      "<svg>small</svg>",
    );
  });

  it("gives a restore a number of its own, even for the newest's contents", async () => {
    const file = path.join(dir, "notes.md");
    const folder = path.join(dir, "Versions");
    await fs.writeFile(file, "A");
    const first = await keepVersion({ file, folder });
    const restored = await keepVersion({
      file,
      folder,
      fresh: true,
      kept: first ? [first] : [],
    });
    expect(at(restored)).toBe(path.join("Versions", "notes.md", "v2.md"));
  });

  it("makes a fresh copy, under the next number, when the newest's was edited since", async () => {
    const file = path.join(dir, "notes.md");
    const folder = path.join(dir, "Versions");
    await fs.writeFile(file, "A");
    const first = await keepVersion({ file, folder });
    await fs.writeFile(first?.copy ?? "", "edited");
    const again = await keepVersion({
      file,
      folder,
      kept: first ? [first] : [],
    });
    expect(again?.number).toBe(2);
    expect(await fs.readFile(again?.copy ?? "", "utf8")).toBe("A");
    expect(await fs.readFile(first?.copy ?? "", "utf8")).toBe("edited");
  });

  it("copies the newest version here under its number when its copy is on another computer", async () => {
    const file = path.join(dir, "notes.md");
    await fs.writeFile(file, "A");
    const elsewhere = await keepVersion({
      file,
      folder: path.join(dir, "elsewhere"),
    });
    const here = await keepVersion({
      file,
      folder: path.join(dir, "Versions"),
      kept: elsewhere
        ? [{ hash: elsewhere.hash, number: 4, size: elsewhere.size }]
        : [],
    });
    expect(at(here)).toBe(path.join("Versions", "notes.md", "v4.md"));
  });

  it("numbers a file too big to copy without a copy", async () => {
    const file = path.join(dir, "big.bin");
    await fs.writeFile(file, Buffer.alloc(11 * 1024 * 1024, 1));
    const folder = path.join(dir, "Versions");
    const first = await keepVersion({ file, folder });
    const again = await keepVersion({
      file,
      folder,
      kept: first ? [first] : [],
    });
    expect(
      [first, again].map((version) => [version?.copy, version?.number]),
    ).toEqual([
      [undefined, 1],
      [undefined, 1],
    ]);
  });

  it("keeps nothing for a folder or a missing file", async () => {
    expect(await keepVersion({ file: dir, folder: dir })).toBeUndefined();
    expect(
      await keepVersion({ file: path.join(dir, "no"), folder: dir }),
    ).toBeUndefined();
  });

  it("gives two files of one name their own folders, two keepers at once included", async () => {
    const first = path.join(dir, "a", "report.md");
    const second = path.join(dir, "b", "report.md");
    const third = path.join(dir, "c", "report.md");
    for (const [file, contents] of [
      [first, "sales"],
      [second, "staffing"],
      [third, "hiring"],
    ] as const) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, contents);
    }
    const folder = path.join(dir, "Versions");
    const kept = await Promise.all(
      [first, second].map((file) => keepVersion({ file, folder })),
    );
    const copies = await Promise.all(
      kept.map((version) => fs.readFile(version?.copy ?? "", "utf8")),
    );
    expect(copies).toEqual(["sales", "staffing"]);
    expect(new Set(kept.map((version) => path.dirname(at(version)))).size).toBe(
      2,
    );
    // A folder another file's records name is passed over even once the
    // trim has removed it.
    await fs.rm(path.join(folder, "report.md"), { recursive: true });
    const later = await keepVersion({
      file: third,
      folder,
      taken: new Set(["report.md", "report.md 2"]),
    });
    expect(at(later)).toBe(path.join("Versions", "report.md 3", "v1.md"));
  });

  it("cuts a second same-name folder's name to fit when the file's name is at the limit", async () => {
    const name = `${"a".repeat(252)}.md`;
    const first = path.join(dir, "a", name);
    const second = path.join(dir, "b", name);
    for (const file of [first, second]) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, file);
    }
    const folder = path.join(dir, "Versions");
    await keepVersion({ file: first, folder });
    const later = await keepVersion({ file: second, folder });
    const named = path.basename(path.dirname(later?.copy ?? ""));
    expect(named.endsWith(" 2")).toBe(true);
    expect(Buffer.byteLength(named)).toBeLessThanOrEqual(255);
  });

  it("keeps a file's later versions in the folder its first went in", async () => {
    const file = path.join(dir, "report.md");
    const folder = path.join(dir, "Versions");
    await fs.writeFile(file, "one");
    const first = await keepVersion({
      file,
      folder,
      taken: new Set(["report.md"]),
    });
    await fs.writeFile(file, "two");
    const second = await keepVersion({
      file,
      folder,
      kept: first ? [first] : [],
      taken: new Set(["report.md"]),
    });
    expect(at(second)).toBe(path.join("Versions", "report.md 2", "v2.md"));
  });

  it.each([
    ["deck.key", "deck/v1.key"],
    ["Budget.numbers", "Budget/v1.numbers"],
    ["notes.rtfd", "notes/v1.rtfd"],
    ["moon.svg", "moon.svg/v1.svg"],
    ["Makefile", "Makefile/v1"],
    ["deck .key", "deck/v1.key"],
  ])("keeps %s's versions in %s", async (name, kept) => {
    const file = path.join(dir, name);
    await fs.writeFile(file, "x");
    const version = await keepVersion({
      file,
      folder: path.join(dir, "Versions"),
    });
    expect(at(version)).toBe(path.join("Versions", kept));
  });

  it("keeps nothing when the agent's rules refuse the read", async () => {
    const file = path.join(dir, "linked.txt");
    await fs.writeFile(file, "closed");
    const kept = await keepVersion({
      file,
      folder: path.join(dir, "Versions"),
      read: () => Promise.reject(new Error("EACCES")),
    });
    expect(kept).toBeUndefined();
    await expect(fs.readdir(path.join(dir, "Versions"))).rejects.toThrow();
  });

  it("copies the bytes the agent's read returned", async () => {
    const file = path.join(dir, "notes.md");
    await fs.writeFile(file, "on disk");
    const kept = await keepVersion({
      file,
      folder: path.join(dir, "Versions"),
      read: () => Promise.resolve(new TextEncoder().encode("as read")),
    });
    expect(await fs.readFile(kept?.copy ?? "", "utf8")).toBe("as read");
  });
});

describe("trimVersions", () => {
  it("removes the oldest copies past the limit, across every folder", async () => {
    const folders = [path.join(dir, "Versions"), path.join(dir, ".versions")];
    for (const [i, [folder, name]] of [
      [folders[1], "a"],
      [folders[0], "b"],
      [folders[0], "c"],
    ].entries()) {
      await fs.mkdir(path.join(folder ?? "", name ?? ""), { recursive: true });
      const file = path.join(folder ?? "", name ?? "", "v.txt");
      await fs.writeFile(file, "x".repeat(10));
      await fs.utimes(file, i + 1, i + 1);
    }
    await trimVersions(folders, 20);
    expect((await fs.readdir(folders[0] ?? "")).toSorted()).toEqual(["b", "c"]);
    expect(await fs.readdir(folders[1] ?? "")).toEqual([]);
  });
});
