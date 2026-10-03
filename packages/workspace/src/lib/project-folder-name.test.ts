import { describe, expect, it } from "vitest";

import { validateFolderName } from "./project-folder-name";

describe("validateFolderName", () => {
  it.each([
    ["Marketing Site", "Marketing Site"],
    ["  Trimmed  ", "Trimmed"],
    ["Q3 Report (v2)", "Q3 Report (v2)"],
    ["émojis 🚀 ok", "émojis 🚀 ok"],
  ])("accepts %j -> %j", (input, expected) => {
    expect(validateFolderName(input, "Topic")._unsafeUnwrap()).toBe(expected);
  });

  it.each([
    ["", "empty"],
    ["   ", "empty (whitespace)"],
    ["bad/slash", "slash"],
    ['has"quote', "quote"],
    ["pipe|name", "pipe"],
    ["star*name", "asterisk"],
    ["colon:name", "colon"],
    ["CON", "windows reserved"],
    ["lpt1", "windows reserved lowercase"],
    ["trailing.", "trailing period"],
    [".", "dot"],
    ["..", "dotdot"],
  ])("rejects %j (%s)", (input) => {
    expect(validateFolderName(input, "Topic").isErr()).toBe(true);
  });
});
