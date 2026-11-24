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
    ["C:\\Users\\windows-user\\AppData", true],
    ["c:\\users\\windows-user\\appdata\\Local\\Temp", true],
    ["C:\\Users\\windows-user\\Documents", false],
    ["C:\\Users\\windows-user\\AppData Notes", false],
  ])("on Windows, staying out of %s is %s", (folder, expected) => {
    expect(windows.staysOut(folder)).toBe(expected);
  });

  it("stays out of nothing on Linux", () => {
    const rules = stayOutRules({
      answered: new Set(),
      home: "/home/linux-user",
      platform: "linux",
      workspace: undefined,
    });
    expect(rules.staysOut("/home/linux-user/Documents")).toBe(false);
  });
});
