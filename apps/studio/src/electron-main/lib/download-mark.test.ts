import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isFromInternet, markFromInternet, zoneOf } from "./download-mark";

let folder: string;
let downloads: string;

beforeAll(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "download-mark-"));
  downloads = path.join(folder, "Downloads");
  await fs.mkdir(downloads);
  await fs.writeFile(path.join(downloads, "page.html"), "");
  await fs.writeFile(path.join(folder, "page.html"), "");
  // A link elsewhere is judged where it leads.
  await fs.symlink(
    path.join(downloads, "page.html"),
    path.join(folder, "link.html"),
  );
});

afterAll(async () => {
  await fs.rm(folder, { force: true, recursive: true });
});

describe("isFromInternet on Linux", () => {
  const linux = (name: string) =>
    isFromInternet(path.join(folder, name), {
      downloads: () => downloads,
      platform: "linux",
    });

  it.each([
    ["a page in Downloads", "Downloads/page.html", true],
    ["a page elsewhere", "page.html", false],
    ["a link into Downloads", "link.html", true],
    ["a page that is not there", "gone.html", true],
  ])("marks %s: %s", async (_case, name, expected) => {
    expect(await linux(name)).toBe(expected);
  });

  it("marks nothing when there is no Downloads folder", async () => {
    expect(
      await isFromInternet(path.join(folder, "page.html"), {
        downloads: () => {
          throw new Error("no downloads folder");
        },
        platform: "linux",
      }),
    ).toBe(false);
  });
});

describe.runIf(process.platform === "darwin")("isFromInternet on macOS", () => {
  it("marks a page by its quarantine attribute, through a link to it", async () => {
    const page = path.join(folder, "quarantined.html");
    const link = path.join(folder, "quarantined-link.html");
    await fs.writeFile(page, "");
    await fs.symlink(page, link);
    expect(await isFromInternet(page)).toBe(false);
    execFileSync("/usr/bin/xattr", [
      "-w",
      "com.apple.quarantine",
      "0083;00000000;Chrome;",
      page,
    ]);
    expect(await isFromInternet(page)).toBe(true);
    expect(await isFromInternet(link)).toBe(true);
  });
});

describe("zoneOf", () => {
  it.each([
    ["[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://example.com/\r\n", 3],
    ["[ZoneTransfer]\nZoneId = 4\n", 4],
    ["[ZoneTransfer]\r\nZoneId=2\r\n", 2],
    ["", undefined],
    ["[ZoneTransfer]\r\nZoneId=x\r\n", undefined],
  ])("reads %j as zone %s", (stream, zone) => {
    expect(zoneOf(stream)).toBe(zone);
  });
});

describe("markFromInternet", () => {
  it("writes the quarantine attribute on macOS", async () => {
    const written: string[][] = [];
    await markFromInternet("/Users/mac-user/Downloads/page.html", {
      now: () => 1_700_000_000_000,
      platform: "darwin",
      write: (args) => {
        written.push(args);
        return Promise.resolve();
      },
    });
    expect(written).toMatchInlineSnapshot(`
      [
        [
          "-w",
          "com.apple.quarantine",
          "0081;6553f100;Instrument;",
          "/Users/mac-user/Downloads/page.html",
        ],
      ]
    `);
  });

  it.each(["win32", "linux"] as const)(
    "writes nothing on %s",
    async (platform) => {
      const written: string[][] = [];
      await markFromInternet("/x/page.html", {
        platform,
        write: (args) => {
          written.push(args);
          return Promise.resolve();
        },
      });
      expect(written).toEqual([]);
    },
  );

  it.runIf(process.platform === "darwin")(
    "leaves a mark isFromInternet reads",
    async () => {
      const page = path.join(folder, "saved.html");
      await fs.writeFile(page, "");
      await markFromInternet(page);
      expect(await isFromInternet(page)).toBe(true);
    },
  );
});
