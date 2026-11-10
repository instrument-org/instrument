import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  askOfOutsideLink,
  createLinkGate,
  openOutsideLink,
} from "./outside-links";

// A link from outside can come from any site the person visits, so it puts
// something in front of them and nothing more: no path past a plain
// absolute one, no refused place, and no downloaded page run straight from
// a link.

let folder: string;

beforeAll(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "outside-links-"));
  await fs.mkdir(path.join(folder, "Notes"));
  await fs.writeFile(path.join(folder, "plan.md"), "");
});

afterAll(async () => {
  await fs.rm(folder, { force: true, recursive: true });
});

const allowed = () => Promise.resolve(false);
const marked = () => Promise.resolve(true);
/** A path made up for a test, read as a file that is there. */
const aFile = (): Promise<"other"> => Promise.resolve("other");

describe("askOfOutsideLink", () => {
  it("opens a screen a noun names", async () => {
    expect(await askOfOutsideLink("instrument://chat/ses_01J9")).toEqual({
      href: "/chats/ses_01J9",
      type: "openScreen",
    });
  });

  it("starts a new chat with the words", async () => {
    expect(
      await askOfOutsideLink("instrument://new?text=Plan%20my%20week"),
    ).toEqual({ type: "newChat", words: "Plan my week" });
  });

  it("opens a file, and a folder in Files", async () => {
    const url = (name: string) =>
      `instrument://file${encodeURI(path.join(folder, name))}`;
    expect(
      await askOfOutsideLink(url("plan.md"), { isRefused: allowed }),
    ).toEqual({ hostPath: path.join(folder, "plan.md"), type: "openFile" });
    expect(
      await askOfOutsideLink(url("Notes"), { isRefused: allowed }),
    ).toMatchObject({ type: "openScreen" });
  });

  it("opens a page the system does not mark as downloaded", async () => {
    expect(
      await askOfOutsideLink(
        "instrument://file/Users/mac-user/Work/page.html",
        {
          hostPaths: path.posix,
          isDownloaded: allowed,
          isRefused: allowed,
          placeOf: aFile,
        },
      ),
    ).toMatchInlineSnapshot(`
      {
        "hostPath": "/Users/mac-user/Work/page.html",
        "type": "openFile",
      }
    `);
  });

  it("opens a Windows page by its drive letter", async () => {
    expect(
      await askOfOutsideLink("instrument://file/C:/Users/windows-user/a.html", {
        hostPaths: path.win32,
        isDownloaded: allowed,
        isRefused: allowed,
        placeOf: aFile,
      }),
    ).toMatchInlineSnapshot(`
      {
        "hostPath": "C:\\Users\\windows-user\\a.html",
        "type": "openFile",
      }
    `);
  });

  it("shows a downloaded page selected in its folder rather than opening it", async () => {
    expect(
      await askOfOutsideLink(
        "instrument://file/Users/mac-user/Downloads/page.html",
        {
          hostPaths: path.posix,
          isDownloaded: marked,
          isRefused: allowed,
          placeOf: aFile,
        },
      ),
    ).toMatchInlineSnapshot(`
      {
        "href": "/files?path=&root=%2FUsers%2Fmac-user%2FDownloads&select=page.html",
        "type": "openScreen",
      }
    `);
  });

  it("opens a Windows path by its drive letter", async () => {
    expect(
      await askOfOutsideLink(
        "instrument://file/C:/Users/windows-user/report.pdf",
        { hostPaths: path.win32, isRefused: allowed, placeOf: aFile },
      ),
    ).toEqual({
      hostPath: "C:\\Users\\windows-user\\report.pdf",
      type: "openFile",
    });
  });

  it.each([
    "instrument://file/home/linux-user/e2e/stats.py",
    "instrument://file//home/linux-user/e2e/stats.py",
  ])("opens a Linux home path from %s", async (url) => {
    expect(
      await askOfOutsideLink(url, {
        hostPaths: path.posix,
        isRefused: allowed,
        placeOf: aFile,
      }),
    ).toEqual({ hostPath: "/home/linux-user/e2e/stats.py", type: "openFile" });
  });

  // The address itself takes a step up, encoded or not, before anything
  // reads it, so the path judged is the one it leads to.
  it.each([
    "instrument://file/Users/mac-user/Notes/../.ssh/id_ed25519",
    "instrument://file/Users/mac-user/Notes/%2E%2E/.ssh/id_ed25519",
  ])("judges %s where it leads", async (url) => {
    const judged: string[] = [];
    await askOfOutsideLink(url, {
      hostPaths: path.posix,
      isRefused: (hostPath) => {
        judged.push(hostPath);
        return Promise.resolve(true);
      },
    });
    expect(judged).toEqual(["/Users/mac-user/.ssh/id_ed25519"]);
  });

  it.each([
    [
      "a network share",
      "instrument://file/%5C%5Cserver%5Cshare%5Cx.txt",
      path.win32,
    ],
    ["a share by slashes", "instrument://file/C:/x//server/share", path.win32],
    [
      "a long-path prefix",
      "instrument://file/%5C%5C%3F%5CUNC%5Cserver%5Cx",
      path.win32,
    ],
    ["a relative path", "instrument://file/C:x.txt", path.win32],
    [
      "a record",
      "instrument://file/Users/mac-user/Work/.instrument/chats/a/b.jsonl",
      path.posix,
    ],
  ])("opens nothing for %s", async (_case, url, hostPaths) => {
    expect(
      await askOfOutsideLink(url, { hostPaths, isRefused: allowed }),
    ).toBeUndefined();
  });

  // A file a link names that is not there is never one to open, so a page
  // that turns up there later is not run straight from the link; the window
  // says it is gone, over its folder when that is there.
  it.each(["pricing.html", "notes.md"])(
    "says %s is not there, over its folder",
    async (name) => {
      expect(
        await askOfOutsideLink(
          `instrument://file${encodeURI(path.join(folder, "Notes", name))}`,
          { isDownloaded: allowed, isRefused: allowed },
        ),
      ).toEqual({
        folder: path.join(folder, "Notes"),
        name,
        type: "missingFile",
      });
    },
  );

  it("says a file is not there with no folder when that is gone too", async () => {
    expect(
      await askOfOutsideLink(
        `instrument://file${encodeURI(path.join(folder, "Gone", "pricing.html"))}`,
        { isDownloaded: allowed, isRefused: allowed },
      ),
    ).toEqual({ name: "pricing.html", type: "missingFile" });
  });

  it("opens nothing in a place the app refuses", async () => {
    expect(
      await askOfOutsideLink("instrument://file/Users/mac-user/a.md", {
        hostPaths: path.posix,
        isRefused: () => Promise.resolve(true),
      }),
    ).toBeUndefined();
  });

  it("reads a page's mark only once the app shows its place", async () => {
    const read: string[] = [];
    const isDownloaded = (hostPath: string) => {
      read.push(hostPath);
      return Promise.resolve(false);
    };
    await askOfOutsideLink("instrument://file/Users/mac-user/a.html", {
      hostPaths: path.posix,
      isDownloaded,
      isRefused: marked,
    });
    await askOfOutsideLink("instrument://file/Users/mac-user/b.html", {
      hostPaths: path.posix,
      isDownloaded,
      isRefused: allowed,
      placeOf: aFile,
    });
    expect(read).toEqual(["/Users/mac-user/b.html"]);
  });
});

describe("openOutsideLink", () => {
  const open = async (
    url: string,
    {
      gate = () => true,
      waiting = 0,
    }: { gate?: (url: string) => boolean; waiting?: number } = {},
  ) => {
    const asked: unknown[] = [];
    const logged: string[] = [];
    await openOutsideLink(url, {
      ask: (ask) => asked.push(ask),
      gate,
      log: (line) => logged.push(line),
      waiting: () => waiting,
    });
    return { asked, logged };
  };

  it("says what each link came to, by its noun alone", async () => {
    expect(await open("instrument://new?text=private%20words"))
      .toMatchInlineSnapshot(`
      {
        "asked": [
          {
            "type": "newChat",
            "words": "private words",
          },
        ],
        "logged": [
          "A new link asks the window to newChat",
        ],
      }
    `);
    expect(await open("instrument://chat")).toMatchInlineSnapshot(`
      {
        "asked": [],
        "logged": [
          "A chat link opens nothing: it names nothing here, or a path that is not plainly this computer's or that the app refuses",
        ],
      }
    `);
    expect(await open("instrument://new?text=again", { gate: () => false }))
      .toMatchInlineSnapshot(`
      {
        "asked": [],
        "logged": [
          "Let a new link go: the same link again, or too many this minute",
        ],
      }
    `);
    expect(
      await open("instrument://file/home/linux-user/a.md", { waiting: 10 }),
    ).toMatchInlineSnapshot(`
      {
        "asked": [],
        "logged": [
          "Let a file link go: 10 asks already wait for the window",
        ],
      }
    `);
  });
});

describe("createLinkGate", () => {
  it("lets the same link again through only after a moment", () => {
    let now = 0;
    const gate = createLinkGate({ now: () => now });
    expect(gate("instrument://chat/a")).toBe(true);
    now = 1000;
    expect(gate("instrument://chat/a")).toBe(false);
    expect(gate("instrument://chat/b")).toBe(true);
    now = 4000;
    expect(gate("instrument://chat/a")).toBe(true);
  });

  it("lets a few a minute through", () => {
    let now = 0;
    const gate = createLinkGate({ now: () => now });
    const through = Array.from({ length: 12 }, (_, at) =>
      gate(`instrument://chat/${at}`),
    );
    expect(through.filter(Boolean)).toHaveLength(10);
    now = 60_000;
    expect(gate("instrument://chat/later")).toBe(true);
  });
});
