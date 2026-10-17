import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { pathWithin, samePath } from "./path-identity";

const root = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "path-identity-")),
);
fs.mkdirSync(path.join(root, "Work", "Inside"), { recursive: true });
fs.symlinkSync(path.join(root, "Work"), path.join(root, "link"));

/** Whether the temp folder's volume ignores case, asked of the volume itself. */
const foldsCase = fs.existsSync(path.join(root, "WORK"));

afterAll(() => {
  fs.rmSync(root, { force: true, recursive: true });
});

describe("samePath", () => {
  it("follows a link to the folder it names", () => {
    expect(samePath(path.join(root, "link"), path.join(root, "Work"))).toBe(
      true,
    );
  });

  it("takes a folder not made yet as spelled, below one that is", () => {
    expect(
      samePath(
        path.join(root, "link", "later"),
        path.join(root, "Work", "later"),
      ),
    ).toBe(true);
    expect(samePath(path.join(root, "a"), path.join(root, "b"))).toBe(false);
  });

  it("matches another case exactly where the volume does", () => {
    expect(samePath(path.join(root, "WORK"), path.join(root, "Work"))).toBe(
      foldsCase,
    );
  });
});

describe("pathWithin", () => {
  it.each([
    ["the folder itself", "Work", true],
    ["a folder inside it", "Work/Inside", true],
    ["one inside it through a link", "link/Inside", true],
    ["a name that only starts the same", "Workshop", false],
    ["the folder holding it", ".", false],
  ])("counts %s", (_name, inner, within) => {
    expect(pathWithin(path.join(root, inner), path.join(root, "Work"))).toBe(
      within,
    );
  });
});
