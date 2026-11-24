import { type Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type FileNames, walkFileNames } from "./walk";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "file-names-"));
});
afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

/** Makes files under `root`, and folders for the paths ending in a slash. */
async function make(...paths: string[]) {
  for (const each of paths) {
    const at = path.join(root, each);
    if (each.endsWith("/")) {
      await fs.mkdir(at, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(at), { recursive: true });
      await fs.writeFile(at, "");
    }
  }
}

/** What a walk found, as paths from `root` in the order found, folders ending in a slash. */
function listed(found: FileNames): string[] {
  return found.names.map((name, at) => {
    const folder = found.folders[found.parents[at] ?? -1] ?? "";
    const from = path.relative(root, path.join(folder, name));
    return `${from.split(path.sep).join("/")}${found.isFolder[at] ? "/" : ""}`;
  });
}

describe("walkFileNames", () => {
  it("lists files and folders a level at a time, each folder's names in order", async () => {
    await make("b.txt", "a/deep/c.txt", "a/Notes.md", "z/");
    const found = await walkFileNames({ roots: [root] });
    expect(listed(found)).toMatchInlineSnapshot(`
      [
        "a/",
        "b.txt",
        "z/",
        "a/Notes.md",
        "a/deep/",
        "a/deep/c.txt",
      ]
    `);
    expect(found.capped).toBe(false);
    expect(found.folded).toContain("notes.md");
  });

  it("leaves out hidden names, node_modules, and what a package has inside", async () => {
    await make(
      ".env",
      ".git/config",
      "node_modules/left-pad/index.js",
      "app/node_modules/left-pad/index.js",
      "app/main.ts",
      "Tool.app/Contents/Info.plist",
      "Trip.PhotosLibrary/database/photos.db",
    );
    expect(listed(await walkFileNames({ roots: [root] })))
      .toMatchInlineSnapshot(`
        [
          "Tool.app",
          "Trip.PhotosLibrary",
          "app/",
          "app/main.ts",
        ]
      `);
  });

  it.skipIf(process.platform === "win32")(
    "leaves links out, so a loop of links ends",
    async () => {
      await make("a/b/file.txt");
      await fs.symlink(root, path.join(root, "a", "b", "up"));
      await fs.symlink(path.join(root, "a"), path.join(root, "again"));
      await fs.symlink(
        path.join(root, "a", "b", "file.txt"),
        path.join(root, "linked.txt"),
      );
      expect(listed(await walkFileNames({ roots: [root] })))
        .toMatchInlineSnapshot(`
          [
            "a/",
            "a/b/",
            "a/b/file.txt",
          ]
        `);
    },
  );

  it.skipIf(process.platform === "win32")(
    "gives nothing for a root that is a link, a file, or missing",
    async () => {
      await make("real/file.txt", "plain.txt");
      await fs.symlink(path.join(root, "real"), path.join(root, "link"));
      const found = await walkFileNames({
        roots: ["link", "plain.txt", "missing"].map((name) =>
          path.join(root, name),
        ),
      });
      expect(listed(found)).toEqual([]);
    },
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "passes over a folder it cannot read",
    async () => {
      await make("shut/secret.txt", "open/file.txt");
      await fs.chmod(path.join(root, "shut"), 0o000);
      try {
        const found = await walkFileNames({ roots: [root] });
        expect(listed(found)).toMatchInlineSnapshot(`
          [
            "open/",
            "shut/",
            "open/file.txt",
          ]
        `);
        expect(found.capped).toBe(false);
      } finally {
        await fs.chmod(path.join(root, "shut"), 0o700);
      }
    },
  );

  it("lists a folder it stays out of and never reads it, as a root or below one", async () => {
    await make("open/file.txt", "closed/inner/file.txt");
    const read: string[] = [];
    const found = await walkFileNames({
      readFolder: (folder) => {
        read.push(path.relative(root, folder));
        return fs.readdir(folder, { withFileTypes: true });
      },
      roots: [root, path.join(root, "closed", "inner")],
      staysOut: (folder) =>
        path.relative(root, folder).split(path.sep)[0] === "closed",
    });
    expect(listed(found)).toMatchInlineSnapshot(`
      [
        "closed/",
        "open/",
        "open/file.txt",
      ]
    `);
    expect(read).toEqual(["", "open"]);
  });

  it("stops a root at its cap with the names nearest the top", async () => {
    await make("a/1.txt", "a/2.txt", "b/3.txt", "c.txt", "d.txt");
    const found = await walkFileNames({ maxNamesPerRoot: 5, roots: [root] });
    expect(listed(found)).toMatchInlineSnapshot(`
      [
        "a/",
        "b/",
        "c.txt",
        "d.txt",
        "a/1.txt",
      ]
    `);
    expect(found.capped).toBe(true);
  });

  it("is not capped by a root that fits exactly", async () => {
    await make("a/1.txt", "c.txt");
    const found = await walkFileNames({ maxNamesPerRoot: 3, roots: [root] });
    expect(listed(found)).toHaveLength(3);
    expect(found.capped).toBe(false);
  });

  it("stops every root at the cap in total, earlier roots first", async () => {
    await make(
      "one/a.txt",
      "one/b.txt",
      "two/c.txt",
      "two/d.txt",
      "three/e.txt",
    );
    const found = await walkFileNames({
      maxNames: 3,
      roots: ["one", "two", "three"].map((name) => path.join(root, name)),
    });
    expect(listed(found)).toMatchInlineSnapshot(`
      [
        "one/a.txt",
        "one/b.txt",
        "two/c.txt",
      ]
    `);
    expect(found.capped).toBe(true);
  });

  it("walks a root inside another root once, under its own cap", async () => {
    await make("top.txt", "inner/a.txt", "inner/b.txt", "inner/c.txt", "z.txt");
    const found = await walkFileNames({
      maxNamesPerRoot: 3,
      roots: [root, path.join(root, "inner"), root],
    });
    expect(listed(found)).toMatchInlineSnapshot(`
      [
        "inner/",
        "top.txt",
        "z.txt",
        "inner/a.txt",
        "inner/b.txt",
        "inner/c.txt",
      ]
    `);
    expect(found.capped).toBe(false);
  });

  it("ends a root whose folder never answers and goes on to the next", async () => {
    await make("dead/file.txt", "alive/file.txt");
    const dead = path.join(root, "dead");
    const found = await walkFileNames({
      readFolder: (folder) =>
        folder === dead
          ? new Promise<Dirent[]>(() => {})
          : fs.readdir(folder, { withFileTypes: true }),
      roots: [dead, path.join(root, "alive")],
      stallMs: 1,
    });
    expect(listed(found)).toMatchInlineSnapshot(`
      [
        "alive/file.txt",
      ]
    `);
    expect(found.capped).toBe(true);
  });
});
