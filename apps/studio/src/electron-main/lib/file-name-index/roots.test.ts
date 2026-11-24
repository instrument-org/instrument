import { describe, expect, it, vi } from "vitest";

import { stayOutRules } from "./roots";

vi.mock("electron", () => ({ app: {} }));

describe("stayOutRules", () => {
  const home = "/Users/mac-user";
  const mac = stayOutRules({
    answered: new Set(["/users/mac-user/documents", "/volumes/work"]),
    home,
    platform: "darwin",
    workspace: `${home}/Desktop/Instrument`,
  });

  it.each([
    [`${home}/Projects/site`, false],
    [`${home}/Documents/Taxes`, false],
    [`${home}/Downloads`, true],
    [`${home}/Music`, true],
    ["/Volumes/Backup", true],
    // The workspace and what is in it, in a folder nobody answered for.
    [`${home}/Desktop/Instrument`, false],
    [`${home}/DESKTOP/instrument/Projects/Site`, false],
    [`${home}/Desktop/Instrument notes`, true],
    [`${home}/Desktop`, true],
  ])("on macOS, staying out of %s is %s", (folder, expected) => {
    expect(mac.staysOut(folder)).toBe(expected);
  });

  it.each([
    [home, true],
    [`${home}/Projects/site`, false],
    [`${home}/Documents/Code`, false],
    [`${home}/Desktop/Instrument/Projects`, false],
    [`${home}/Desktop`, true],
  ])("on macOS, a folder below %s may stay out: %s", (folder, expected) => {
    expect(mac.staysOutBelow(folder)).toBe(expected);
  });

  it.each([
    [`${home}/Projects/site`, true],
    [`${home}/Documents/Code/site`, true],
    ["/Volumes/Work/site", true],
    // Above the workspace is Desktop, which nobody answered for.
    [`${home}/Desktop/Instrument`, false],
    [`${home}/Desktop/Instrument/Projects/Site/repo`, false],
    [`${home}/Pictures/Site`, false],
    [`${home}/Library/Mobile Documents/com~apple~CloudDocs/site`, false],
  ])("on macOS, reading above %s is %s", (folder, expected) => {
    expect(mac.readsAbove(folder)).toBe(expected);
  });

  it("leaves the workspace's exception out when its folder is not known", () => {
    const rules = stayOutRules({
      answered: new Set(),
      home,
      platform: "darwin",
      workspace: undefined,
    });
    expect(rules.staysOut(`${home}/Desktop/Instrument`)).toBe(true);
  });

  const windows = stayOutRules({
    answered: new Set(),
    home: "C:\\Users\\windows-user",
    platform: "win32",
    workspace: undefined,
  });

  it.each([
    ["C:\\Users\\windows-user\\AppData", true, true],
    ["c:\\users\\windows-user\\appdata\\Local\\Temp", true, false],
    ["C:\\Users\\windows-user\\Documents", false, false],
    ["C:\\Users\\windows-user\\AppData Notes", false, false],
    ["C:\\Users\\windows-user", false, true],
    ["C:\\", false, true],
  ])(
    "on Windows, %s stays out: %s, a folder below may: %s",
    (folder, staysOut, below) => {
      expect(windows.staysOut(folder)).toBe(staysOut);
      expect(windows.staysOutBelow(folder)).toBe(below);
      expect(windows.readsAbove(folder)).toBe(true);
    },
  );

  it("stays out of nothing on Linux", () => {
    const rules = stayOutRules({
      answered: new Set(),
      home: "/home/linux-user",
      platform: "linux",
      workspace: undefined,
    });
    expect(rules.staysOut("/home/linux-user/Documents")).toBe(false);
    expect(rules.staysOutBelow("/home/linux-user")).toBe(false);
    expect(rules.readsAbove("/home/linux-user/code/site")).toBe(true);
  });
});
