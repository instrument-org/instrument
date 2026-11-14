import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { COMPUTER_ROOT } from "@/shared/computer-href";
import { describe, expect, it } from "vitest";

import {
  chatOfTaskAddress,
  fieldScopeOf,
  locationCrumbs,
  locationChip,
  type TabLocation,
  tasksOfHref,
} from "./tab-location";

const CHAT = ChatIdSchema.parse("2026-10-01-roofer");
const TASK = StoreId.SessionSchema.parse("ses_01M3AX9RF3C2E9RTATMB602W0B");

const HOME = "/Users/casey";

/** What each part says, and where it goes, as one line per part. */
function readable(location: TabLocation, home = HOME) {
  return locationCrumbs(location, { home }).map((crumb) =>
    crumb.to?.kind === "screen"
      ? `${crumb.label} -> ${crumb.to.href}`
      : crumb.label,
  );
}

describe("locationCrumbs", () => {
  it("walks a folder up from the home folder, written out", () => {
    expect(readable({ kind: "folder", path: "~/Documents/Instrument" }))
      .toMatchInlineSnapshot(`
        [
          "casey -> /files?path=&root=%2FUsers%2Fcasey",
          "Documents -> /files?path=&root=%2FUsers%2Fcasey%2FDocuments",
          "Instrument",
        ]
      `);
  });

  it("names several picked as a count under their folder, which is somewhere to go", () => {
    expect(
      readable({
        kind: "folder",
        path: "/Users/casey/Documents/Lisbon trip",
        picked: 3,
      }),
    ).toMatchInlineSnapshot(`
      [
        "casey -> /files?path=&root=%2FUsers%2Fcasey",
        "Documents -> /files?path=&root=%2FUsers%2Fcasey%2FDocuments",
        "Lisbon trip -> /files?path=&root=%2FUsers%2Fcasey%2FDocuments%2FLisbon+trip",
        "3 items",
      ]
    `);
  });

  it("names several picked from the recents as a count alone", () => {
    expect(readable({ kind: "folder", path: "", picked: 4 })).toEqual([
      "4 items",
    ]);
  });

  it("walks a Windows folder up from the home folder", () => {
    expect(
      readable(
        { kind: "folder", path: "C:\\Users\\casey\\Downloads" },
        "C:\\Users\\casey",
      ),
    ).toMatchInlineSnapshot(`
      [
        "casey -> /files?path=&root=C%3A%5CUsers%5Ccasey",
        "Downloads",
      ]
    `);
  });

  it("starts a path outside home at the disk's name", () => {
    const volumes = [
      { name: "Macintosh HD", path: "/" },
      { name: "Backup", path: "/Volumes/Backup" },
    ];
    const crumbsOf = (path: string) =>
      locationCrumbs({ kind: "folder", path }, { home: HOME, volumes }).map(
        (crumb) =>
          crumb.to?.kind === "screen"
            ? `${crumb.label} -> ${crumb.to.href}`
            : crumb.label,
      );
    expect({
      bootDisk: crumbsOf("/"),
      onBootDisk: crumbsOf("/Applications/Utilities"),
      onOtherDisk: crumbsOf("/Volumes/Backup/Photos"),
    }).toMatchInlineSnapshot(`
      {
        "bootDisk": [
          "Macintosh HD",
        ],
        "onBootDisk": [
          "Macintosh HD -> /files?path=&root=%2F",
          "Applications -> /files?path=&root=%2FApplications",
          "Utilities",
        ],
        "onOtherDisk": [
          "Backup -> /files?path=&root=%2FVolumes%2FBackup",
          "Photos",
        ],
      }
    `);
  });

  // Below the disk's name the path splits the way the whole path does: at
  // every backslash on Windows, and at a slash alone on a Mac or Linux, where
  // a backslash is a letter in a name.
  it.each([
    [
      "C:\\Windows\\Web\\Wallpaper",
      { name: "Local Disk (C:)", path: "C:\\" },
      [
        "Local Disk (C:) -> /files?path=&root=C%3A%5C",
        "Windows -> /files?path=&root=C%3A%5CWindows",
        "Web -> /files?path=&root=C%3A%5CWindows%5CWeb",
        "Wallpaper",
      ],
    ],
    [
      "/Volumes/Backup/a\\b/c",
      { name: "Backup", path: "/Volumes/Backup" },
      [
        "Backup -> /files?path=&root=%2FVolumes%2FBackup",
        "a\\b -> /files?path=&root=%2FVolumes%2FBackup%2Fa%5Cb",
        "c",
      ],
    ],
  ])("splits %s below its disk's name", (path, volume, crumbs) => {
    expect(
      locationCrumbs(
        { kind: "folder", path },
        { home: HOME, volumes: [volume] },
      ).map((crumb) =>
        crumb.to?.kind === "screen"
          ? `${crumb.label} -> ${crumb.to.href}`
          : crumb.label,
      ),
    ).toEqual(crumbs);
  });

  it("starts a path in iCloud Drive at iCloud Drive rather than home", () => {
    const volumes = [
      { name: "Macintosh HD", path: "/" },
      {
        name: "iCloud Drive",
        path: "/Users/casey/Library/Mobile Documents/com~apple~CloudDocs",
      },
    ];
    expect(
      locationCrumbs(
        {
          kind: "folder",
          path: "~/Library/Mobile Documents/com~apple~CloudDocs/Obsidian/Vault",
        },
        { home: HOME, volumes },
      ).map((crumb) =>
        crumb.to?.kind === "screen"
          ? `${crumb.label} -> ${crumb.to.href}`
          : crumb.label,
      ),
    ).toMatchInlineSnapshot(`
      [
        "iCloud Drive -> /files?path=&root=%2FUsers%2Fcasey%2FLibrary%2FMobile+Documents%2Fcom%7Eapple%7ECloudDocs",
        "Obsidian -> /files?path=&root=%2FUsers%2Fcasey%2FLibrary%2FMobile+Documents%2Fcom%7Eapple%7ECloudDocs%2FObsidian",
        "Vault",
      ]
    `);
  });

  it("walks a folder up from the root of the disk", () => {
    expect(readable({ kind: "folder", path: "/Volumes/Backup/Photos" }))
      .toMatchInlineSnapshot(`
      [
        "Volumes -> /files?path=&root=%2FVolumes",
        "Backup -> /files?path=&root=%2FVolumes%2FBackup",
        "Photos",
      ]
    `);
  });

  it("walks a Windows folder outside home up from its volume", () => {
    expect(readable({ kind: "folder", path: "D:\\Photos\\2024" }))
      .toMatchInlineSnapshot(`
        [
          "D: -> /files?path=&root=D%3A%5C",
          "Photos -> /files?path=&root=D%3A%5CPhotos",
          "2024",
        ]
      `);
  });

  it("takes a file to the folders it sits in, from the home folder", () => {
    expect(
      readable({
        kind: "file",
        name: "lisbon.md",
        path: "/Users/casey/Downloads/lisbon.md",
      }),
    ).toMatchInlineSnapshot(`
      [
        "casey -> /files?path=&root=%2FUsers%2Fcasey",
        "Downloads -> /files?path=&root=%2FUsers%2Fcasey%2FDownloads",
        "lisbon.md",
      ]
    `);
  });

  it("takes a file outside the home folder up from the disk", () => {
    expect(
      readable({
        kind: "file",
        name: "lisbon.md",
        path: "/Volumes/Backup/lisbon.md",
      }),
    ).toMatchInlineSnapshot(`
      [
        "Volumes -> /files?path=&root=%2FVolumes",
        "Backup -> /files?path=&root=%2FVolumes%2FBackup",
        "lisbon.md",
      ]
    `);
  });

  it("reads a task as its title and an app page as its name", () => {
    expect(readable({ kind: "task", title: "Book the hotel" }))
      .toMatchInlineSnapshot(`
      [
        "Book the hotel",
      ]
    `);
    expect(readable({ kind: "app", name: "Notion" })).toMatchInlineSnapshot(`
      [
        "Notion",
      ]
    `);
  });

  it("gives a chat one part, going nowhere, and Apps and a built-in page's start none past the chip", () => {
    expect(readable({ kind: "apps" })).toMatchInlineSnapshot(`[]`);
    expect(
      readable({ kind: "builtin", screen: "activity" }),
    ).toMatchInlineSnapshot(`[]`);
    expect(readable({ kind: "builtin", part: "Requests", screen: "activity" }))
      .toMatchInlineSnapshot(`
      [
        "Requests",
      ]
    `);
    expect(readable({ kind: "chat", title: "Caffeine mixes" }))
      .toMatchInlineSnapshot(`
      [
        "Caffeine mixes",
      ]
    `);
  });

  it("makes what Activity shows a place to step back out to while one of its rows is open", () => {
    expect(
      readable({
        item: "Read report.pdf",
        kind: "builtin",
        part: "Files",
        partHref: "/activity?show=files",
        screen: "activity",
      }),
    ).toMatchInlineSnapshot(`
      [
        "Files -> /activity?show=files",
        "Read report.pdf",
      ]
    `);
    expect(
      readable({
        item: "Read report.pdf",
        kind: "builtin",
        screen: "activity",
      }),
    ).toMatchInlineSnapshot(`
      [
        "Read report.pdf",
      ]
    `);
    expect(
      readable({
        kind: "builtin",
        part: "Files",
        partHref: "/activity?show=files",
        screen: "activity",
      }),
    ).toMatchInlineSnapshot(`
      [
        "Files",
      ]
    `);
  });

  it("gives every chat none past the chip", () => {
    expect(readable({ kind: "chats" })).toMatchInlineSnapshot(`[]`);
  });

  it("says an address whole, and a new tab not at all", () => {
    expect(
      readable({ kind: "page", url: "https://example.com/a/b" }),
    ).toMatchInlineSnapshot(`[]`);
    expect(readable({ kind: "newTab" })).toMatchInlineSnapshot(`[]`);
  });

  it("offers nowhere to go from a folder named under its root", () => {
    expect(readable({ kind: "folder", path: "Documents/Instrument" }))
      .toMatchInlineSnapshot(`
      [
        "Documents",
        "Instrument",
      ]
    `);
  });
});

describe("locationChip", () => {
  it.each<[string, TabLocation, string | undefined]>([
    ["an app page", { kind: "app", name: "Gmail" }, "apps"],
    ["Apps", { kind: "apps" }, "apps"],
    [
      "a file",
      { kind: "file", name: "a.md", path: "~/Documents/a.md" },
      "files",
    ],
    ["the home folder", { kind: "folder", path: "~" }, "files"],
    [
      "the top of the computer",
      { kind: "folder", path: COMPUTER_ROOT },
      "files",
    ],
    ["a chat", { kind: "chat", title: "Caffeine mixes" }, "chat"],
    ["every chat", { kind: "chats" }, "chat"],
    ["a new chat, which is a new tab", { kind: "newChat" }, undefined],
    ["a task", { kind: "task", title: "Book the hotel" }, "chat"],
    ["Activity", { kind: "builtin", screen: "activity" }, "activity"],
    ["a page", { kind: "page", url: "https://example.com/" }, undefined],
    ["a new tab", { kind: "newTab" }, undefined],
    ["Extensions", { kind: "builtin", screen: "extensions" }, "extensions"],
    [
      "a part of Settings",
      { kind: "builtin", part: "Providers", screen: "settings" },
      "settings",
    ],
  ])("%s", (_, location, chip) => {
    expect(locationChip(location)).toBe(chip);
  });
});

describe("fieldScopeOf", () => {
  it.each<[string, TabLocation, string | undefined]>([
    ["a chat", { kind: "chat", title: "Caffeine mixes" }, "chat"],
    ["every chat", { kind: "chats" }, "chat"],
    ["a task", { kind: "task", title: "Book the hotel" }, "chat"],
    [
      "a part of Settings",
      { kind: "builtin", part: "Providers", screen: "settings" },
      "settings",
    ],
    ["History", { kind: "builtin", screen: "history" }, "history"],
    [
      "an Activity row",
      { item: "Read report.pdf", kind: "builtin", screen: "activity" },
      "activity",
    ],
    ["Memory", { kind: "builtin", screen: "memory" }, "memory"],
    ["Skills", { kind: "builtin", screen: "skills" }, "skills"],
    ["an app page", { kind: "app", name: "Gmail" }, "apps"],
    ["Apps", { kind: "apps" }, "apps"],
    // A path and an address are typed and edited where they are.
    [
      "a file",
      { kind: "file", name: "a.md", path: "~/Documents/a.md" },
      undefined,
    ],
    ["a folder", { kind: "folder", path: "~" }, undefined],
    ["a page", { kind: "page", url: "https://example.com/" }, undefined],
    // A page with nothing of its own to search, and a new tab, search
    // everything.
    ["Extensions", { kind: "builtin", screen: "extensions" }, undefined],
    ["a new tab", { kind: "newTab" }, undefined],
    ["a new chat, which is a new tab", { kind: "newChat" }, undefined],
  ])("%s", (_, location, scope) => {
    expect(fieldScopeOf(location)).toBe(scope);
  });
});

describe("tasksOfHref", () => {
  it.each([
    ["/tasks", undefined],
    [`/tasks/${TASK}`, { task: TASK }],
    [`/tasks/${TASK}?chat=${CHAT}`, { chat: CHAT, task: TASK }],
    ["/tasks/book", undefined],
    [`/tasks/${TASK}/edit`, undefined],
    ["/memory/book", undefined],
  ])("reads %s", (href, expected) => {
    expect(tasksOfHref(href)).toEqual(expected);
  });
});

describe("chatOfTaskAddress", () => {
  it.each([
    [undefined, undefined],
    ["Not a chat", undefined],
    [CHAT, CHAT],
  ])("reads the list for %s as %s's", (chat, expected) => {
    expect(chatOfTaskAddress(chat)).toBe(expected);
  });
});
