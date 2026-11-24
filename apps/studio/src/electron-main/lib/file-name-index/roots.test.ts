import { describe, expect, it, vi } from "vitest";

import { walkStaysOut } from "./roots";

vi.mock("electron", () => ({ app: {} }));

describe("walkStaysOut", () => {
  const mac = {
    answered: ["/Users/mac-user/Documents", "/Volumes/Work/Workspace"],
    home: "/Users/mac-user",
    platform: "darwin",
  } as const;

  it.each([
    ["/Users/mac-user", false],
    ["/Users/mac-user/Projects/site", false],
    ["/Applications", false],
    // Answered for, itself and inside.
    ["/Users/mac-user/Documents", false],
    ["/Users/mac-user/documents/Taxes/2026", false],
    ["/Volumes/Work/Workspace/Projects", false],
    ["/System/Volumes/Data/Users/mac-user/Documents/Taxes", false],
    // Guarded, and nobody answered yet.
    ["/Users/mac-user/Desktop", true],
    ["/Users/mac-user/Downloads/installer", true],
    ["/Users/mac-user/DOWNLOADS", true],
    ["/Users/mac-user/Library", true],
    ["/Users/mac-user/Library/Mobile Documents/com~apple~CloudDocs", true],
    ["/Users/mac-user/Pictures", true],
    ["/System/Volumes/Data/Users/mac-user/Desktop", true],
    ["/Volumes/Work", true],
    ["/Volumes/Work/Other", true],
    ["/Volumes/Backup/2026", true],
    // A name that only starts like a guarded one.
    ["/Users/mac-user/Desktop notes", false],
  ])("on macOS, staying out of %s is %s", (folder, expected) => {
    expect(walkStaysOut(folder, mac)).toBe(expected);
  });

  it.each([
    ["C:\\Users\\windows-user\\AppData", true],
    ["c:\\users\\windows-user\\appdata\\Local\\Temp", true],
    ["C:\\Users\\windows-user\\Documents", false],
    ["C:\\Users\\windows-user\\AppData Notes", false],
  ])("on Windows, staying out of %s is %s", (folder, expected) => {
    expect(
      walkStaysOut(folder, {
        answered: [],
        home: "C:\\Users\\windows-user",
        platform: "win32",
      }),
    ).toBe(expected);
  });

  it("stays out of nothing on Linux", () => {
    expect(
      walkStaysOut("/home/linux-user/Documents", {
        answered: [],
        home: "/home/linux-user",
        platform: "linux",
      }),
    ).toBe(false);
  });
});
