import { describe, expect, it } from "vitest";

import { packageScopeNote } from "./package-scope-note";

// What the agent is told when Node, started by some other program, died
// because the sandbox refused it a package.json above the script.
describe("packageScopeNote", () => {
  it.each([
    [
      "macOS",
      "Error: Cannot read package config /Users/mac-user/package.json: operation not permitted",
      "/Users/mac-user/package.json",
    ],
    [
      "Linux",
      "Error: Cannot read package config /home/linux-user/package.json: Permission denied",
      "/home/linux-user/package.json",
    ],
    [
      "Windows, long-path prefix dropped",
      String.raw`Cannot read package config \\?\C:\Users\windows-user\package.json: operation not permitted`,
      String.raw`C:\Users\windows-user\package.json`,
    ],
  ])("names the refused package.json on %s", (_, output, named) => {
    expect(packageScopeNote(`noise\n${output}\nmore`)).toContain(`(${named})`);
  });

  it.each([
    ["an unrelated failure", "Error: Cannot find module 'left-pad'"],
    [
      "a package.json that is malformed rather than refused",
      "Cannot read package config /x/package.json: Unexpected token",
    ],
  ])("says nothing for %s", (_, output) => {
    expect(packageScopeNote(output)).toBeUndefined();
  });
});
