import { ChatIdSchema, StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  chatOfTasksList,
  locationCrumbs,
  memoryOfHref,
  skillOfHref,
  type TabLocation,
  tasksHref,
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
        "iCloud Drive -> /files?path=&root=%2FUsers%2Fcasey%2FLibrary%2FMobile%20Documents%2Fcom~apple~CloudDocs",
        "Obsidian -> /files?path=&root=%2FUsers%2Fcasey%2FLibrary%2FMobile%20Documents%2Fcom~apple~CloudDocs%2FObsidian",
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

  it("puts a task under the work and an app page under Apps", () => {
    // Opened from no chat's list, a task has no list to go back to.
    expect(readable({ kind: "task", title: "Book the hotel" }))
      .toMatchInlineSnapshot(`
      [
        "Tasks",
        "Book the hotel",
      ]
    `);
    expect(readable({ kind: "app", name: "Notion" })).toMatchInlineSnapshot(`
      [
        "Apps -> /apps",
        "Notion",
      ]
    `);
  });

  it("puts a task opened from a chat's list under that list", () => {
    expect(readable({ chat: CHAT, kind: "task", title: "Book the hotel" }))
      .toMatchInlineSnapshot(`
      [
        "Tasks -> /tasks?chat=2026-10-01-roofer",
        "Book the hotel",
      ]
    `);
  });

  it("gives a screen that is under nothing one part, going nowhere", () => {
    expect(readable({ kind: "tasks" })).toMatchInlineSnapshot(`
      [
        "Tasks",
      ]
    `);
    expect(readable({ kind: "apps" })).toMatchInlineSnapshot(`
      [
        "Apps",
      ]
    `);
    expect(readable({ kind: "chat", title: "Caffeine mixes" }))
      .toMatchInlineSnapshot(`
      [
        "Caffeine mixes",
      ]
    `);
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

describe("memoryOfHref", () => {
  it.each([
    ["/memory/no-stevia", "no-stevia"],
    ["/memory/no-stevia?from=link", "no-stevia"],
    ["/memory", undefined],
    ["/memory/", undefined],
    ["/memory/no-stevia/edit", undefined],
    ["/tasks/no-stevia", undefined],
  ])("reads %s as %s", (href, name) => {
    expect(memoryOfHref(href)).toBe(name);
  });
});

describe("skillOfHref", () => {
  it.each([
    ["/skills/create-page", "create-page"],
    ["/skills/workspace%3Atdd", "workspace:tdd"],
    ["/skills/instrument:create-page", "instrument:create-page"],
    ["/skills", undefined],
    ["/skills/", undefined],
    ["/skills/create-page/files", undefined],
    ["/memory/create-page", undefined],
  ])("reads %s as %s", (href, name) => {
    expect(skillOfHref(href)).toBe(name);
  });
});

describe("tasksOfHref", () => {
  it.each([
    ["/tasks", {}],
    [`/tasks?chat=${CHAT}`, { chat: CHAT }],
    ["/tasks?chat=Not%20a%20chat", {}],
    [`/tasks/${TASK}`, { task: TASK }],
    [`/tasks/${TASK}?chat=${CHAT}`, { chat: CHAT, task: TASK }],
    ["/tasks/book", undefined],
    [`/tasks/${TASK}/edit`, undefined],
    ["/memory/book", undefined],
  ])("reads %s", (href, expected) => {
    expect(tasksOfHref(href)).toEqual(expected);
  });
});

describe("tasksHref", () => {
  it("addresses one chat's list", () => {
    expect(tasksHref(CHAT)).toBe(`/tasks?chat=${CHAT}`);
  });
});

describe("chatOfTasksList", () => {
  // A list with no chat is no list: its address goes to the inbox.
  it.each([
    [undefined, undefined],
    ["Not a chat", undefined],
    [CHAT, CHAT],
  ])("reads the list for %s as %s's", (chat, expected) => {
    expect(chatOfTasksList(chat)).toBe(expected);
  });
});
