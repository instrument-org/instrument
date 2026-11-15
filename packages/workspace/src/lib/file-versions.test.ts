import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { keepVersion, trimVersions } from "./file-versions";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "versions-"));
});
afterEach(async () => {
  await fs.rm(dir, { force: true, recursive: true });
});

const at = new Date(2026, 10, 15, 12, 1);

describe("keepVersion", () => {
  it("copies a file under a folder named for it, reusing the copy while it is unchanged", async () => {
    const file = path.join(dir, "moon.svg");
    await fs.writeFile(file, "<svg>small</svg>");
    const folder = path.join(dir, ".versions");
    const first = await keepVersion({
      file,
      folder,
      label: "make a moon",
      now: at,
    });
    expect(path.relative(dir, first?.copy ?? "")).toBe(
      ".versions/moon.svg/2026-11-15 12.01 make a moon.svg",
    );
    const again = await keepVersion({
      file,
      folder,
      label: "and again",
      kept: first ? [first] : [],
    });
    expect(again).toEqual(first);

    await fs.writeFile(file, "<svg>big</svg>");
    const bigger = await keepVersion({
      file,
      folder,
      label: "make a moon",
      now: at,
      kept: first ? [first] : [],
    });
    expect(path.basename(bigger?.copy ?? "")).toBe(
      "2026-11-15 12.01 make a moon 2.svg",
    );
    expect(await fs.readFile(first?.copy ?? "", "utf8")).toBe(
      "<svg>small</svg>",
    );
    expect(bigger?.hash).not.toBe(first?.hash);

    await fs.writeFile(file, "<svg>small</svg>");
    const back = await keepVersion({
      file,
      folder,
      kept: [first, bigger].filter((each) => each !== undefined),
      label: "go back",
    });
    expect(back?.copy).toBe(first?.copy);
  });

  it("keeps nothing for a folder or a missing file", async () => {
    expect(
      await keepVersion({ file: dir, folder: dir, label: "" }),
    ).toBeUndefined();
    expect(
      await keepVersion({ file: path.join(dir, "no"), folder: dir, label: "" }),
    ).toBeUndefined();
  });
});

describe("trimVersions", () => {
  it("removes the oldest copies past the limit", async () => {
    const folder = path.join(dir, ".versions");
    for (const [i, name] of ["a", "b", "c"].entries()) {
      await fs.mkdir(path.join(folder, name), { recursive: true });
      const file = path.join(folder, name, "v.txt");
      await fs.writeFile(file, "x".repeat(10));
      await fs.utimes(file, i + 1, i + 1);
    }
    await trimVersions(folder, 20);
    expect((await fs.readdir(folder)).toSorted()).toEqual(["b", "c"]);
  });
});
