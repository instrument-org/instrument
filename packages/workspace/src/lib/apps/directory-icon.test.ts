import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getAppCatalog } from "./catalog";
import {
  DIRECTORY_ICON_MANIFEST_FILE_NAME,
  DIRECTORY_ICONS_DIR_NAME,
  DirectoryIconManifestSchema,
  readDirectoryIcons,
} from "./directory-icon";
import { checkAppIcon } from "./icon";

const ICONS_DIR = path.resolve(
  import.meta.dirname,
  "../../..",
  DIRECTORY_ICONS_DIR_NAME,
);

const manifest = DirectoryIconManifestSchema.parse(
  JSON.parse(
    await fs.readFile(
      path.join(ICONS_DIR, DIRECTORY_ICON_MANIFEST_FILE_NAME),
      "utf8",
    ),
  ),
);
const shipped = await readDirectoryIcons(ICONS_DIR);

describe("the shipped directory icons", () => {
  it("name only services the directory lists", () => {
    const slugs = new Set(getAppCatalog().map((entry) => entry.slug));
    expect(Object.keys(manifest).filter((slug) => !slugs.has(slug))).toEqual(
      [],
    );
  });

  it("are one file for each manifest entry, and nothing else", () => {
    expect([...shipped.keys()].toSorted()).toEqual(
      Object.keys(manifest).toSorted(),
    );
  });

  it("take thesvg's files only under CC0 or MIT", () => {
    expect(
      Object.entries(manifest)
        .filter(
          ([, entry]) =>
            entry.source === "thesvg" &&
            !["CC0-1.0", "MIT"].includes(entry.license),
        )
        .map(([slug]) => slug),
    ).toEqual([]);
  });

  it.each([...shipped.values()])("%s draws as an app icon", async (file) => {
    const bytes = await fs.readFile(path.join(ICONS_DIR, file));
    expect(checkAppIcon(bytes)).toEqual({
      fileName: file.endsWith(".svg") ? "icon.svg" : "icon.png",
    });
    if (file.endsWith(".svg")) {
      const svg = bytes.toString("utf8");
      expect(svg).not.toMatch(/<script|<foreignObject|<image/i);
      expect(svg).not.toMatch(/\son[\w-]+\s*=/i);
      expect(svg).not.toMatch(/href\s*=\s*["'](?!#)/i);
      expect(svg).not.toMatch(/url\(\s*["']?(?!#)/i);
    }
  });
});

describe("readDirectoryIcons", () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { force: true, recursive: true });
    }
  });

  it("maps each slug to its file, the SVG over a PNG, skipping anything else", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "directory-icons-"));
    for (const file of [
      "both.png",
      "both.svg",
      "only-png.png",
      "manifest.json",
      "Upper.svg",
      "notes.txt",
    ]) {
      await fs.writeFile(path.join(dir, file), "");
    }
    expect(Object.fromEntries(await readDirectoryIcons(dir)))
      .toMatchInlineSnapshot(`
      {
        "both": "both.svg",
        "only-png": "only-png.png",
      }
    `);
  });
});
