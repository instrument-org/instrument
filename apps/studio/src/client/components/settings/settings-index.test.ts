import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { matchSettings, SETTINGS_INDEX } from "./settings-index";

const COMPONENTS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.")
      ? [full]
      : [];
  });
}

describe("SETTINGS_INDEX", () => {
  it("names only rows some page marks, so a jump has somewhere to land", () => {
    const marked = new Set(
      sourceFiles(COMPONENTS_DIR).flatMap((file) =>
        [
          ...fs
            .readFileSync(file, "utf8")
            .matchAll(/settingAnchor\(\s*"([^"]+)"\s*\)/g),
        ].map((match) => match[1]),
      ),
    );
    expect(
      SETTINGS_INDEX.map((entry) => entry.id).filter((id) => !marked.has(id)),
    ).toEqual([]);
  });
});

describe("matchSettings", () => {
  const titles = (query: string) =>
    matchSettings([...SETTINGS_INDEX], query).map((match) => match.entry.title);

  it.each([
    ["theme", "Theme"],
    ["dark", "Theme"],
    ["beta", "Update from"],
    ["logs", "Diagnostic log"],
    ["api key", "Add provider"],
  ])("finds %s", (query, title) => {
    expect(titles(query)[0]).toBe(title);
  });

  it("finds nothing for an empty search", () => {
    expect(titles("  ")).toEqual([]);
  });

  it("highlights only the title", () => {
    expect(matchSettings([...SETTINGS_INDEX], "zoom")[0])
      .toMatchInlineSnapshot(`
      {
        "entry": {
          "aliases": "text size bigger smaller scale font",
          "detail": "Make everything in the app larger or smaller.",
          "id": "zoom",
          "tab": "General",
          "title": "Zoom",
        },
        "titleRanges": [
          0,
          4,
        ],
      }
    `);
  });
});
