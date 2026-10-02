import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { folderLabel, folderParentLabel } from "./folder-parent-label";

describe("folderLabel", () => {
  it("calls a folder what it is called on disk", () => {
    expect(folderLabel("/base/project/Downloads")).toMatchInlineSnapshot(
      `"Downloads"`,
    );
  });

  // The account name is the one folder name the agent must not quote back.
  it("calls the home folder Home, not the account name", () => {
    expect(folderLabel(os.homedir())).toMatchInlineSnapshot(`"Home"`);
  });
});

describe("folderParentLabel", () => {
  it("names the folder one level up", () => {
    expect(folderParentLabel("/base/project/Downloads")).toMatchInlineSnapshot(
      `"project"`,
    );
  });

  it("names the home folder Home", () => {
    expect(
      folderParentLabel(path.join(os.homedir(), "Downloads")),
    ).toMatchInlineSnapshot(`"Home"`);
  });

  it("has nothing to point at from a filesystem root", () => {
    expect(folderParentLabel("/Downloads")).toMatchInlineSnapshot(`undefined`);
  });
});
