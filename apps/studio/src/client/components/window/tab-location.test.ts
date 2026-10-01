import { StoreId } from "@instrument-org/workspace/client";
import { describe, expect, it } from "vitest";

import {
  locationCrumbs,
  memoryOfHref,
  type TabLocation,
  tasksOfHref,
} from "./tab-location";

const CHAT = StoreId.SessionSchema.parse("ses_01ARZ3NDEKTSV4RRFFQ69G5FAV");

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
    expect(readable({ kind: "task", title: "Book the hotel" }))
      .toMatchInlineSnapshot(`
      [
        "Tasks -> /tasks",
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
        "Tasks -> /tasks?chat=ses_01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "Book the hotel",
      ]
    `);
  });

  it("puts a skill under Skills, by its name", () => {
    expect(readable({ kind: "skill", name: "create-page" }))
      .toMatchInlineSnapshot(`
      [
        "Skills -> /skills",
        "create-page",
      ]
    `);
    expect(readable({ kind: "skills" })).toMatchInlineSnapshot(`
      [
        "Skills",
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

describe("tasksOfHref", () => {
  it.each([
    ["/tasks", {}],
    [`/tasks?chat=${CHAT}`, { chat: CHAT }],
    ["/tasks?chat=nonsense", {}],
    ["/tasks/book", { task: "book" }],
    [`/tasks/book?chat=${CHAT}`, { chat: CHAT, task: "book" }],
    ["/tasks/book/edit", undefined],
    ["/memory/book", undefined],
  ])("reads %s", (href, expected) => {
    expect(tasksOfHref(href)).toEqual(expected);
  });
});
