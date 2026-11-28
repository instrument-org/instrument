import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { matchWalked, walkForSearch } from "./folder-search";

describe("folder search", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), "folder-search-")),
    );
    await fs.mkdir(path.join(root, "Projects", "Research"), {
      recursive: true,
    });
    await fs.mkdir(path.join(root, "Downloads"));
    await fs.writeFile(path.join(root, "Projects", "pricing-notes.md"), "");
    await fs.writeFile(
      path.join(root, "Projects", "Research", "pricing-tiers.md"),
      "",
    );
    await fs.writeFile(path.join(root, "Projects", "roadmap.pdf"), "");
    await fs.writeFile(path.join(root, "Downloads", "pricing-sheet.pdf"), "");
  });
  afterEach(async () => {
    await fs.rm(root, { force: true, recursive: true });
  });

  const found = (entries: { folder: string; name: string }[]) =>
    entries.map(({ folder, name }) => `${folder}/${name}`).toSorted();

  it("matches names word by word, and by kind, from one walk", async () => {
    const walked = await walkForSearch({
      also: [],
      root,
      walkId: `${root}:words`,
    });
    if (!walked) throw new Error("not walked");

    expect(found(matchWalked(walked, { query: "pric not" }))).toEqual([
      "Projects/pricing-notes.md",
    ]);
    expect(
      found(
        matchWalked(walked, {
          kinds: { extensions: ["pdf"], folders: false },
          query: "",
        }),
      ),
    ).toEqual(["Downloads/pricing-sheet.pdf", "Projects/roadmap.pdf"]);
    expect(
      found(
        matchWalked(walked, {
          kinds: { extensions: [], folders: true },
          query: "",
        }),
      ),
    ).toEqual(["/Downloads", "/Projects", "Projects/Research"]);
  });

  it("goes into a folder it was let into, listed where it is", async () => {
    const downloads = path.join(root, "Downloads");
    const skips = new Set([downloads]);
    const without = await walkForSearch({
      also: [],
      root,
      skips,
      walkId: `${root}:without`,
    });
    const walked = await walkForSearch({
      also: [downloads],
      root,
      skips,
      walkId: `${root}:also`,
    });
    if (!without || !walked) throw new Error("not walked");

    expect(found(matchWalked(without, { query: "sheet" }))).toEqual([]);
    expect(without.notSearched).toEqual([downloads]);
    expect(found(matchWalked(walked, { query: "sheet" }))).toEqual([
      "Downloads/pricing-sheet.pdf",
    ]);
    expect(walked.notSearched).toEqual([]);
  });

  it("keeps the walk for a search's every keystroke", async () => {
    const walkId = `${root}:kept`;
    const first = await walkForSearch({ also: [], root, walkId });
    await fs.writeFile(path.join(root, "pricing-late.md"), "");
    const again = await walkForSearch({ also: [], root, walkId });

    expect(again).toBe(first);
  });
});
