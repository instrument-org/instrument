import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { withTempDir } from "../test/helpers/temp-dir";
import { settleKeyFolderCase } from "./key-folder-case";

const workspace = withTempDir("key-folder-case-workspace");

function write(...segments: string[]) {
  const file = path.join(workspace.path, ...segments);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "");
}

/** Whether the file system the tests run on reads `a` and `A` as one name. */
function ignoresCase() {
  const probe = path.join(workspace.path, "case-probe");
  fs.mkdirSync(probe);
  const ignores = fs.existsSync(path.join(workspace.path, "CASE-PROBE"));
  fs.rmdirSync(probe);
  return ignores;
}

describe("settleKeyFolderCase", () => {
  it("gives a folder of the six its own name where the case is all that differs", () => {
    write("skills", "tdd", "SKILL.md");
    write("drafts", "2026-10-09", "DRAFT.md");
    const ignores = ignoresCase();

    const done = settleKeyFolderCase(workspace.path);

    if (ignores) {
      expect(done).toEqual([
        "renamed drafts/ to Drafts/",
        "renamed skills/ to Skills/",
      ]);
      expect(fs.readdirSync(workspace.path).toSorted()).toEqual([
        "Drafts",
        "Skills",
      ]);
      expect(
        fs.existsSync(path.join(workspace.path, "Skills", "tdd", "SKILL.md")),
      ).toBe(true);
    } else {
      // Two folders here: the lowercase one is the person's.
      expect(done).toEqual([]);
      expect(fs.readdirSync(workspace.path).toSorted()).toEqual([
        "drafts",
        "skills",
      ]);
    }
  });

  it("leaves a folder already under its own name, and anything not one of the six", () => {
    write("Skills", "tdd", "SKILL.md");
    write("notes", "a.md");

    expect(settleKeyFolderCase(workspace.path)).toEqual([]);
    expect(fs.readdirSync(workspace.path).toSorted()).toEqual([
      "Skills",
      "notes",
    ]);
  });

  it("leaves a file under one of the six names", () => {
    write("memory");

    expect(settleKeyFolderCase(workspace.path)).toEqual([]);
    expect(fs.readdirSync(workspace.path)).toEqual(["memory"]);
  });
});
