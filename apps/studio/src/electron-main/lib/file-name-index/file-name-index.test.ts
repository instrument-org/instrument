import path from "node:path";
import { describe, expect, it } from "vitest";

import { foldName } from "@/shared/name-match";

import { createFileNameIndex, searchFileNames } from "./file-name-index";
import { type FileNames } from "./walk";

const FOLDER = path.resolve("/files");

/** Names as a walk would have found them: all in one folder, a folder where the name ends in a slash. */
function namesOf(...entries: string[]): FileNames {
  const names = entries.map((entry) => entry.replace(/\/$/, ""));
  return {
    capped: false,
    folded: names.map(foldName),
    folders: [FOLDER],
    isFolder: entries.map((entry) => entry.endsWith("/")),
    names,
    parents: entries.map(() => 0),
  };
}

/** A walk the test finishes by hand, counted. */
function heldWalk() {
  const waiting: ((names: FileNames) => void)[] = [];
  let started = 0;
  return {
    finish: (...entries: string[]) => {
      waiting.shift()?.(namesOf(...entries));
    },
    get started() {
      return started;
    },
    walk: () => {
      started += 1;
      return new Promise<FileNames>((resolve) => {
        waiting.push(resolve);
      });
    },
  };
}

describe("searchFileNames", () => {
  const names = namesOf(
    "Rebudgeted.xlsx",
    "2026 Budget.xlsx",
    "Budget final.xlsx",
    "Budget.xlsx",
    "budget/",
    "Budget.md",
    "Notes.md",
  );

  it("answers best first, the shorter name first among equals", () => {
    expect(searchFileNames(names, "budget", 10).map((entry) => entry.name))
      .toMatchInlineSnapshot(`
      [
        "budget",
        "Budget.md",
        "Budget.xlsx",
        "Budget final.xlsx",
        "2026 Budget.xlsx",
        "Rebudgeted.xlsx",
      ]
    `);
  });

  it("answers with each entry's path and whether it is a folder", () => {
    expect(searchFileNames(names, "BUDGET", 2)).toEqual([
      { isFolder: true, name: "budget", path: path.join(FOLDER, "budget") },
      {
        isFolder: false,
        name: "Budget.md",
        path: path.join(FOLDER, "Budget.md"),
      },
    ]);
  });

  it.each([
    {
      finds: ["2026 Budget.xlsx"],
      typed: "bud 2026",
      why: "words in any order",
    },
    {
      finds: ["Budget final.xlsx"],
      typed: "bf",
      why: "the words' first letters",
    },
    { finds: [], typed: "notse", why: "one wrong letter" },
    { finds: [], typed: "bdgt", why: "scattered letters" },
  ])("finds $finds for $typed: $why", ({ finds, typed }) => {
    expect(searchFileNames(names, typed, 1).map((entry) => entry.name)).toEqual(
      finds,
    );
  });

  it("reports a walk's cost", async () => {
    const reports: unknown[] = [];
    const index = createFileNameIndex({
      report: (cost) => reports.push({ ...cost, ms: 0 }),
      walk: () => Promise.resolve(namesOf("a.txt", "b.txt")),
    });
    await index.search("a", 5);
    expect(reports).toEqual([{ capped: false, kind: "walk", ms: 0, names: 2 }]);
  });

  it.each([
    ["", 10],
    ["   ", 10],
    ["budget", 0],
    ["missing", 10],
  ])("answers nothing for %j with a limit of %i", (typed, limit) => {
    expect(searchFileNames(names, typed, limit)).toEqual([]);
  });
});

describe("createFileNameIndex", () => {
  it("walks once for searches that come in together, and each waits for it", async () => {
    const held = heldWalk();
    const index = createFileNameIndex({ walk: held.walk });
    const searches = [index.search("a", 5), index.search("b", 5)];
    expect(held.started).toBe(1);
    held.finish("a.txt", "b.txt");
    expect(
      (await Promise.all(searches)).map((found) =>
        found.map((entry) => entry.name),
      ),
    ).toEqual([["a.txt"], ["b.txt"]]);
    expect(held.started).toBe(1);
  });

  it("answers from the last walk while it is fresh, and walks again behind an old one", async () => {
    const held = heldWalk();
    let now = 0;
    const index = createFileNameIndex({
      freshForMs: 60_000,
      now: () => now,
      walk: held.walk,
    });
    const first = index.search("a", 5);
    held.finish("a.txt");
    await first;

    now = 59_999;
    expect(await index.search("a", 5)).toHaveLength(1);
    expect(held.started).toBe(1);

    now = 60_000;
    expect((await index.search("a", 5)).map((entry) => entry.name)).toEqual([
      "a.txt",
    ]);
    expect(held.started).toBe(2);
    // The walk in flight is shared, and the last finished one still answers.
    expect(await index.search("a", 5)).toHaveLength(1);
    expect(held.started).toBe(2);

    held.finish("a.txt", "a2.txt");
    await Promise.resolve();
    expect((await index.search("a", 5)).map((entry) => entry.name)).toEqual([
      "a.txt",
      "a2.txt",
    ]);
    expect(held.started).toBe(2);
  });

  it("starts the walk for a search with no words without waiting for it", async () => {
    const held = heldWalk();
    const index = createFileNameIndex({ walk: held.walk });
    expect(await index.search("", 5)).toEqual([]);
    expect(await index.search(" ", 5)).toEqual([]);
    expect(held.started).toBe(1);
    const search = index.search("a", 5);
    held.finish("a.txt");
    expect(await search).toHaveLength(1);
    expect(held.started).toBe(1);
  });

  it("keeps answering from the last walk when the next one fails, and tries again", async () => {
    let fails = false;
    let now = 0;
    let started = 0;
    const index = createFileNameIndex({
      freshForMs: 1,
      now: () => now,
      walk: () => {
        started += 1;
        return fails
          ? Promise.reject(new Error("no roots"))
          : Promise.resolve(namesOf("a.txt"));
      },
    });
    await index.search("a", 5);
    fails = true;
    now = 1;
    expect(await index.search("a", 5)).toHaveLength(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(await index.search("a", 5)).toHaveLength(1);
    expect(started).toBe(3);
  });

  it("fails the first search when the first walk fails", async () => {
    const index = createFileNameIndex({
      walk: () => Promise.reject(new Error("no roots")),
    });
    await expect(index.search("a", 5)).rejects.toThrow("no roots");
  });
});
