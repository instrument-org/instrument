import path from "node:path";
import { describe, expect, it } from "vitest";

import { isClosedDiskRoot } from "../disk-root";
import { windowsDrives, windowsProgramFolders } from "./places";
import { reachOf, rulesFor } from "./rules";

describe("windowsDrives", () => {
  it("lists every present drive but the system one", () => {
    const present = new Set(["C:\\", "D:\\", "E:\\"]);
    expect(windowsDrives((root) => present.has(root), "C:")).toEqual([
      "D:\\",
      "E:\\",
    ]);
  });

  it("leaves out a system drive that is not C:", () => {
    const present = new Set(["C:\\", "D:\\"]);
    expect(windowsDrives((root) => present.has(root), "d:")).toEqual(["C:\\"]);
  });
});

describe("windowsProgramFolders", () => {
  // As the layout adds them on Windows: the app's own, over the app-files
  // place that holds AppData, with a browser profile in it closed.
  const home = "/home/someone";
  const programs = windowsProgramFolders(home);
  const rules = {
    dangerouslyAllowEveryFolder: false,
    home,
    rules: [
      {
        level: "ask" as const,
        path: `${home}/AppData`,
        place: "appFiles" as const,
        source: "place" as const,
      },
      {
        level: "never" as const,
        path: `${home}/AppData/Local/Google/Chrome/User Data`,
        place: "passwords" as const,
        source: "place" as const,
      },
      ...programs.map((folder) => ({
        level: "readOnly" as const,
        path: folder,
        source: "system" as const,
      })),
    ],
  };

  it("lets Programs be read, and leaves the rest asking", () => {
    expect(
      (
        [
          ["AppData/Local/Packages/PythonSoftwareFoundation/x", "write"],
          ["AppData/Local/Programs/Python/python.exe", "read"],
          ["AppData/Local/Programs/Python/python.exe", "write"],
          ["AppData/Local/Other/x", "read"],
          ["AppData/Local/Google/Chrome/User Data/x", "read"],
        ] as const
      ).map(
        ([place, op]) =>
          `${op} ${place}: ${reachOf(rules, path.join(home, place), op).level}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "write AppData/Local/Packages/PythonSoftwareFoundation/x: ask",
        "read AppData/Local/Programs/Python/python.exe: allow",
        "write AppData/Local/Programs/Python/python.exe: never",
        "read AppData/Local/Other/x: ask",
        "read AppData/Local/Google/Chrome/User Data/x: never",
      ]
    `);
  });
});

describe("what runs code later stays closed with folders open unasked", () => {
  const home = "/home/someone";
  const rules = rulesFor({
    home,
    settings: {
      apps: [],
      chats: {},
      folders: [],
      places: {},
      dangerouslyAllowEveryFolder: true,
    },
  });

  it.each([
    ".config/fish/conf.d/x.fish",
    ".config/fish/functions/ls.fish",
    ".config/systemd/user/x.service",
    ".config/environment.d/x.conf",
    // Windows' own, which sit under Documents where a card can open the
    // folder around them.
    "Documents/PowerShell/Microsoft.PowerShell_profile.ps1",
    "Documents/WindowsPowerShell/profile.ps1",
    "OneDrive/Documents/PowerShell/Microsoft.PowerShell_profile.ps1",
  ])("~/%s", (place) => {
    expect(reachOf(rules, `${home}/${place}`, "write").level).toBe("never");
  });
});

describe("isClosedDiskRoot", () => {
  it.each([
    ["/", "darwin", true],
    ["/Volumes", "darwin", false],
    ["C:\\", "win32", true],
    ["D:\\", "win32", false],
    ["D:\\Photos", "win32", false],
  ] as const)("%s on %s is %s", (folder, platform, closed) => {
    expect(isClosedDiskRoot(folder, platform, "C:")).toBe(closed);
  });
});
