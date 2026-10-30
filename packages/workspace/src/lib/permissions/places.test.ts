import path from "node:path";
import { describe, expect, it } from "vitest";

import { isClosedDiskRoot } from "../disk-root";
import {
  appFolderParents,
  appUpdateCaches,
  placePaths,
  windowsDrives,
  windowsProgramFolders,
} from "./places";
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

describe("the app-files place", () => {
  const home = "/h";
  const relative = (paths: string[] | undefined) =>
    paths?.map((each) => path.relative(home, each).replaceAll("\\", "/"));

  it("is listed but on Linux, with its caches open", () => {
    const platforms = ["darwin", "linux", "win32"] as const;
    expect(
      Object.fromEntries(
        platforms.map((platform) => {
          const place = placePaths(home, platform).find(
            (each) => each.id === "appFiles",
          );
          return [
            platform,
            {
              listed: place?.listed ?? false,
              openUnlessClosed: relative(place?.openUnlessClosed),
              parents: relative(appFolderParents(home, platform)),
              paths: relative(place?.paths),
              unlisted: relative(place?.unlisted),
              updateCaches: relative(appUpdateCaches(home, platform)),
            },
          ];
        }),
      ),
    ).toMatchInlineSnapshot(`
      {
        "darwin": {
          "listed": true,
          "openUnlessClosed": [
            "Library/Caches",
            ".cache",
          ],
          "parents": [
            "Library/Application Support",
            "Library/Containers",
            "Library/Group Containers",
            "Library/Logs",
          ],
          "paths": [
            "Library",
          ],
          "unlisted": [
            "Library/Containers",
            "Library/Group Containers",
          ],
          "updateCaches": [
            "Library/Caches/instrument-desktop-updater",
            "Library/Caches/com.finalpoint.instrument.ShipIt",
            "Library/Caches/com.finalpoint.instrument",
          ],
        },
        "linux": {
          "listed": false,
          "openUnlessClosed": [
            ".cache",
          ],
          "parents": [],
          "paths": [
            ".config",
            ".local/share",
          ],
          "unlisted": undefined,
          "updateCaches": [
            ".cache/instrument-desktop-updater",
          ],
        },
        "win32": {
          "listed": true,
          "openUnlessClosed": undefined,
          "parents": [
            "AppData/Roaming",
            "AppData/Local",
            "AppData/LocalLow",
            "AppData/Local/Packages",
          ],
          "paths": [
            "AppData",
          ],
          "unlisted": undefined,
          "updateCaches": [
            "AppData/Local/Instrument/packages",
          ],
        },
      }
    `);
  });
});

describe.runIf(process.platform === "darwin")("App files on a Mac", () => {
  const home = "/nope/home";
  const rulesAt = (level?: "allow" | "never") =>
    rulesFor({
      home,
      settings: {
        apps: [],
        chats: {},
        topics: {},
        dangerouslyAllowEveryFolder: false,
        folders: [],
        places: level ? { appFiles: level } : {},
      },
    });

  it("lists while it asks, and follows the person's level", () => {
    const cases = [
      ["Library/Application Support", "list"],
      ["Library/Application Support/Code/User/settings.json", "read"],
      ["Library/Preferences/com.apple.finder.plist", "write"],
      ["Library/Keychains", "list"],
      ["Library/Containers/com.apple.mail", "list"],
      ["Library/LaunchAgents", "list"],
      ["Library/Caches/pnpm/x", "write"],
      ["Library/Caches/Google/Chrome/Default", "list"],
      [".cache/huggingface/hub/x", "write"],
    ] as const;
    const levels = [undefined, "allow", "never"] as const;
    expect(
      cases.map(
        ([place, op]) =>
          `${op} ${place}: ${levels
            .map(
              (level) =>
                `${level ?? "ask"} ${reachOf(rulesAt(level), path.join(home, place), op).level}`,
            )
            .join(", ")}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "list Library/Application Support: ask allow, allow allow, never never",
        "read Library/Application Support/Code/User/settings.json: ask ask, allow allow, never never",
        "write Library/Preferences/com.apple.finder.plist: ask ask, allow allow, never never",
        "list Library/Keychains: ask never, allow never, never never",
        "list Library/Containers/com.apple.mail: ask ask, allow allow, never never",
        "list Library/LaunchAgents: ask never, allow never, never never",
        "write Library/Caches/pnpm/x: ask allow, allow allow, never never",
        "list Library/Caches/Google/Chrome/Default: ask never, allow never, never never",
        "write .cache/huggingface/hub/x: ask allow, allow allow, never never",
      ]
    `);
  });
});

describe("windowsProgramFolders", () => {
  // As the layout adds them on Windows: the app's own, over the app-files
  // place that holds AppData, with a browser profile in it closed.
  const home = "/nope/home";
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

  it("keeps the app's install read-only and its packages closed with App files allowed", () => {
    const allowed = {
      ...rules,
      rules: [
        ...rules.rules.map((rule) =>
          "place" in rule && rule.place === "appFiles"
            ? { ...rule, level: "allow" as const }
            : rule,
        ),
        ...appUpdateCaches(home, "win32").map((folder) => ({
          appData: true as const,
          level: "never" as const,
          path: folder,
          source: "system" as const,
        })),
      ],
    };
    expect(
      (
        [
          ["AppData/Local/Instrument/Update.exe", "read"],
          ["AppData/Local/Instrument/Update.exe", "write"],
          ["AppData/Local/Instrument/Instrument.exe", "write"],
          ["AppData/Local/Instrument/current/Instrument.exe", "read"],
          ["AppData/Local/Instrument/current/resources/app.asar", "write"],
          [
            "AppData/Local/Instrument/packages/Instrument-1.0.0-full.nupkg",
            "read",
          ],
          [
            "AppData/Local/Instrument/packages/Instrument-1.0.0-full.nupkg",
            "write",
          ],
          ["AppData/Local/Other/x", "write"],
        ] as const
      ).map(
        ([place, op]) =>
          `${op} ${place}: ${reachOf(allowed, path.join(home, place), op).level}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "read AppData/Local/Instrument/Update.exe: allow",
        "write AppData/Local/Instrument/Update.exe: never",
        "write AppData/Local/Instrument/Instrument.exe: never",
        "read AppData/Local/Instrument/current/Instrument.exe: allow",
        "write AppData/Local/Instrument/current/resources/app.asar: never",
        "read AppData/Local/Instrument/packages/Instrument-1.0.0-full.nupkg: never",
        "write AppData/Local/Instrument/packages/Instrument-1.0.0-full.nupkg: never",
        "write AppData/Local/Other/x: allow",
      ]
    `);
  });
});

describe("what runs code later stays closed with folders open unasked", () => {
  const home = "/nope/home";
  const rules = rulesFor({
    home,
    settings: {
      apps: [],
      chats: {},
      topics: {},
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
