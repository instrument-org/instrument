import { describe, expect, it } from "vitest";

import { locationCrumbs, type TabLocation } from "./tab-location";

const HOME = "/Users/casey";

/** What each part says, and where it goes, as one line per part. */
function readable(location: TabLocation, home: null | string = HOME) {
  return locationCrumbs(location, { home: home ?? undefined }).map((crumb) =>
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
        "~ -> /orchestrator/computer?path=&root=%2FUsers%2Fcasey",
        "Documents -> /orchestrator/computer?path=&root=%2FUsers%2Fcasey%2FDocuments",
        "Instrument",
      ]
    `);
  });

  it("keeps `~` where the window has not been told where home is", () => {
    expect(readable({ kind: "folder", path: "~/Documents" }, null))
      .toMatchInlineSnapshot(`
      [
        "~ -> /orchestrator/computer?path=&root=~",
        "Documents",
      ]
    `);
  });

  it("walks a folder up from the root of the disk", () => {
    expect(readable({ kind: "folder", path: "/Volumes/Backup/Photos" }))
      .toMatchInlineSnapshot(`
      [
        "Volumes -> /orchestrator/computer?path=&root=%2FVolumes",
        "Backup -> /orchestrator/computer?path=&root=%2FVolumes%2FBackup",
        "Photos",
      ]
    `);
  });

  it("walks a Windows folder up from its volume", () => {
    expect(readable({ kind: "folder", path: "C:\\Users\\casey\\Downloads" }))
      .toMatchInlineSnapshot(`
      [
        "C: -> /orchestrator/computer?path=&root=C%3A%5C",
        "Users -> /orchestrator/computer?path=&root=C%3A%5CUsers",
        "casey -> /orchestrator/computer?path=&root=C%3A%5CUsers%5Ccasey",
        "Downloads",
      ]
    `);
  });

  it("takes a file to the folders it sits in, from the home folder", () => {
    expect(
      readable({
        hostPath: "/Users/casey/Downloads/lisbon.md",
        kind: "file",
        name: "lisbon.md",
        path: "/Users/casey/Downloads/lisbon.md",
      }),
    ).toMatchInlineSnapshot(`
      [
        "~ -> /orchestrator/computer?path=&root=%2FUsers%2Fcasey",
        "Downloads -> /orchestrator/computer?path=&root=%2FUsers%2Fcasey%2FDownloads",
        "lisbon.md",
      ]
    `);
  });

  it("takes a file outside the home folder up from the disk", () => {
    expect(
      readable({
        hostPath: "/Volumes/Backup/lisbon.md",
        kind: "file",
        name: "lisbon.md",
        path: "/Volumes/Backup/lisbon.md",
      }),
    ).toMatchInlineSnapshot(`
      [
        "Volumes -> /orchestrator/computer?path=&root=%2FVolumes",
        "Backup -> /orchestrator/computer?path=&root=%2FVolumes%2FBackup",
        "lisbon.md",
      ]
    `);
  });

  it("leaves a file nothing knows the place of as words alone", () => {
    expect(
      readable({
        kind: "file",
        name: "report.md",
        path: "/tasks/pelican-news/report.md",
      }),
    ).toMatchInlineSnapshot(`
      [
        "tasks",
        "pelican-news",
        "report.md",
      ]
    `);
  });

  it("puts a task under the work and an app page under Apps", () => {
    expect(readable({ kind: "task", title: "Book the hotel" }))
      .toMatchInlineSnapshot(`
      [
        "Tasks -> /orchestrator/tasks",
        "Book the hotel",
      ]
    `);
    expect(readable({ kind: "app", name: "Notion" })).toMatchInlineSnapshot(`
      [
        "Apps -> /orchestrator/apps",
        "Notion",
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
