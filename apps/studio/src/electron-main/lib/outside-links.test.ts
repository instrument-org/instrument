import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  asksOfOutsideLink,
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

describe("asksOfOutsideLink", () => {
  it("opens a screen a noun names", async () => {
    expect(await asksOfOutsideLink("instrument://chat/ses_01J9")).toEqual([
      {
        href: "/chats/ses_01J9",
        type: "openScreen",
      },
    ]);
  });

  it("starts a new chat with the words", async () => {
    expect(
      await asksOfOutsideLink("instrument://new?text=Plan%20my%20week"),
    ).toEqual([{ type: "newChat", words: "Plan my week" }]);
  });

  it("opens a file, and a folder in Files", async () => {
    const url = (name: string) =>
      `instrument://file${encodeURI(path.join(folder, name))}`;
    expect(
      await asksOfOutsideLink(url("plan.md"), { isRefused: allowed }),
    ).toEqual([{ hostPath: path.join(folder, "plan.md"), type: "openFile" }]);
    expect(
      await asksOfOutsideLink(url("Notes"), { isRefused: allowed }),
    ).toMatchObject([{ type: "openScreen" }]);
  });

  it("opens a page the system does not mark as downloaded", async () => {
    expect(
      await asksOfOutsideLink(
        "instrument://file/Users/mac-user/Work/page.html",
        {
          hostPaths: path.posix,
          isDownloaded: allowed,
          isRefused: allowed,
          placeOf: aFile,
        },
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "hostPath": "/Users/mac-user/Work/page.html",
          "type": "openFile",
        },
      ]
    `);
  });

  it("opens a Windows page by its drive letter", async () => {
    expect(
      await asksOfOutsideLink(
        "instrument://file/C:/Users/windows-user/a.html",
        {
          hostPaths: path.win32,
          isDownloaded: allowed,
          isRefused: allowed,
          placeOf: aFile,
        },
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "hostPath": "C:\\Users\\windows-user\\a.html",
          "type": "openFile",
        },
      ]
    `);
  });

  it("shows a downloaded page selected in its folder rather than opening it", async () => {
    expect(
      await asksOfOutsideLink(
        "instrument://file/Users/mac-user/Downloads/page.html",
        {
          hostPaths: path.posix,
          isDownloaded: marked,
          isRefused: allowed,
          placeOf: aFile,
        },
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "href": "/files?path=&root=%2FUsers%2Fmac-user%2FDownloads&select=page.html",
          "type": "openScreen",
        },
      ]
    `);
  });

  it("opens a Windows path by its drive letter", async () => {
    expect(
      await asksOfOutsideLink(
        "instrument://file/C:/Users/windows-user/report.pdf",
        { hostPaths: path.win32, isRefused: allowed, placeOf: aFile },
      ),
    ).toEqual([
      {
        hostPath: "C:\\Users\\windows-user\\report.pdf",
        type: "openFile",
      },
    ]);
  });

  it.each([
    "instrument://file/home/linux-user/e2e/stats.py",
    "instrument://file//home/linux-user/e2e/stats.py",
  ])("opens a Linux home path from %s", async (url) => {
    expect(
      await asksOfOutsideLink(url, {
        hostPaths: path.posix,
        isRefused: allowed,
        placeOf: aFile,
      }),
    ).toEqual([
      { hostPath: "/home/linux-user/e2e/stats.py", type: "openFile" },
    ]);
  });

  // The address itself takes a step up, encoded or not, before anything
  // reads it, so the path judged is the one it leads to.
  it.each([
    "instrument://file/Users/mac-user/Notes/../.ssh/id_ed25519",
    "instrument://file/Users/mac-user/Notes/%2E%2E/.ssh/id_ed25519",
  ])("judges %s where it leads", async (url) => {
    const judged: string[] = [];
    await asksOfOutsideLink(url, {
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
      await asksOfOutsideLink(url, { hostPaths, isRefused: allowed }),
    ).toEqual([]);
  });

  // A file a link names that is not there is never one to open, so a page
  // that turns up there later is not run straight from the link; the window
  // says it is gone, over its folder when that is there.
  it.each(["pricing.html", "notes.md"])(
    "says %s is not there, over its folder",
    async (name) => {
      expect(
        await asksOfOutsideLink(
          `instrument://file${encodeURI(path.join(folder, "Notes", name))}`,
          { isDownloaded: allowed, isRefused: allowed },
        ),
      ).toEqual([
        {
          folder: path.join(folder, "Notes"),
          name,
          type: "missingFile",
        },
      ]);
    },
  );

  it("says a file is not there with no folder when that is gone too", async () => {
    expect(
      await asksOfOutsideLink(
        `instrument://file${encodeURI(path.join(folder, "Gone", "pricing.html"))}`,
        { isDownloaded: allowed, isRefused: allowed },
      ),
    ).toEqual([{ name: "pricing.html", type: "missingFile" }]);
  });

  it("opens nothing in a place the app refuses", async () => {
    expect(
      await asksOfOutsideLink("instrument://file/Users/mac-user/a.md", {
        hostPaths: path.posix,
        isRefused: () => Promise.resolve(true),
      }),
    ).toEqual([]);
  });

  it("reads a page's mark only once the app shows its place", async () => {
    const read: string[] = [];
    const isDownloaded = (hostPath: string) => {
      read.push(hostPath);
      return Promise.resolve(false);
    };
    await asksOfOutsideLink("instrument://file/Users/mac-user/a.html", {
      hostPaths: path.posix,
      isDownloaded,
      isRefused: marked,
    });
    await asksOfOutsideLink("instrument://file/Users/mac-user/b.html", {
      hostPaths: path.posix,
      isDownloaded,
      isRefused: allowed,
      placeOf: aFile,
    });
    expect(read).toEqual(["/Users/mac-user/b.html"]);
  });
});

describe("asksOfOutsideLink with several files", () => {
  // Written by the website as `encodeURIComponent` writes each path.
  const filesLink = (...paths: string[]) =>
    `instrument://files?${paths.map((each) => `path=${encodeURIComponent(each)}`).join("&")}`;

  /** Made-up paths: `Work` and `Downloads` folders, `gone.md` not there, `.ssh` refused, `Downloads` marked. */
  const checks = {
    hostPaths: path.posix,
    isDownloaded: (hostPath: string) =>
      Promise.resolve(hostPath.includes("/Downloads/")),
    isRefused: (hostPath: string) =>
      Promise.resolve(hostPath.includes("/.ssh")),
    placeOf: (hostPath: string): Promise<"folder" | "missing" | "other"> =>
      Promise.resolve(
        hostPath.endsWith("/Work") || hostPath.endsWith("/Downloads")
          ? "folder"
          : hostPath.endsWith("/gone.md")
            ? "missing"
            : "other",
      ),
  };

  it("asks for each path as a link to it alone would, in the order written", async () => {
    expect(
      await asksOfOutsideLink(
        filesLink(
          "/Users/mac-user/Work/plan.md",
          "/Users/mac-user/.ssh/id_ed25519",
          "/Users/mac-user/Downloads/page.html",
          "https://example.com/page.html",
          "/Users/mac-user/Work/gone.md",
          "/Users/mac-user/Work",
          "/Users/mac-user/Work/page.html",
          "Work/relative.md",
          "/Users/mac-user/Work/../.ssh/id_ed25519",
          "//server/share/a.md",
        ),
        checks,
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "hostPath": "/Users/mac-user/Work/plan.md",
          "type": "openFile",
        },
        {
          "href": "/files?path=&root=%2FUsers%2Fmac-user%2FDownloads&select=page.html",
          "type": "openScreen",
        },
        {
          "folder": "/Users/mac-user/Work",
          "name": "gone.md",
          "type": "missingFile",
        },
        {
          "href": "/files?path=&root=%2FUsers%2Fmac-user%2FWork",
          "type": "openScreen",
        },
        {
          "hostPath": "/Users/mac-user/Work/page.html",
          "type": "openFile",
        },
      ]
    `);
  });

  it("asks once for a path written twice, or two ways", async () => {
    expect(
      await asksOfOutsideLink(
        filesLink(
          "/Users/mac-user/Work/plan.md",
          "/Users/mac-user/Work",
          "/Users/mac-user/Work/plan.md",
          "/Users/mac-user/Work/",
          "/Users/mac-user/Work/gone.md",
          "/Users/mac-user/Work/gone.md",
        ),
        checks,
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "hostPath": "/Users/mac-user/Work/plan.md",
          "type": "openFile",
        },
        {
          "href": "/files?path=&root=%2FUsers%2Fmac-user%2FWork",
          "type": "openScreen",
        },
        {
          "folder": "/Users/mac-user/Work",
          "name": "gone.md",
          "type": "missingFile",
        },
      ]
    `);
  });

  it("reads Windows paths by their drive letter", async () => {
    expect(
      await asksOfOutsideLink(
        filesLink(
          "C:/Users/windows-user/Work/report.pdf",
          "C:/Users/windows-user/Work",
          "/Users/windows-user/no-drive.pdf",
          "C:\\Users\\windows-user\\backslashed.pdf",
        ),
        {
          hostPaths: path.win32,
          isRefused: allowed,
          placeOf: (hostPath): Promise<"folder" | "other"> =>
            Promise.resolve(hostPath.endsWith("Work") ? "folder" : "other"),
        },
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "hostPath": "C:\\Users\\windows-user\\Work\\report.pdf",
          "type": "openFile",
        },
        {
          "href": "/files?path=&root=C%3A%5CUsers%5Cwindows-user%5CWork",
          "type": "openScreen",
        },
      ]
    `);
  });

  it("opens the first twenty and says how many more it left", async () => {
    const asked = await asksOfOutsideLink(
      filesLink(
        ...Array.from(
          { length: 23 },
          (_, at) => `/Users/mac-user/Work/${at.toString()}.md`,
        ),
      ),
      checks,
    );
    expect(asked.filter((ask) => ask.type === "openFile")).toHaveLength(20);
    expect(asked.at(19)).toEqual({
      hostPath: "/Users/mac-user/Work/19.md",
      type: "openFile",
    });
    expect(asked.at(-1)).toEqual({ count: 3, type: "notOpened" });
  });
});

// A hosted page is kept as a copy in Downloads and opened from there, where
// a page reaches only itself; one the host does not hand over is said.
describe("a page link", () => {
  const body = new TextEncoder().encode("<title>Weekly</title>");
  const handed = () => Promise.resolve({ body });
  const refused = () => Promise.resolve({ failed: "answered 404" });
  const kept = (id: string) =>
    Promise.resolve(`/Users/mac-user/Downloads/${id}.html`);

  it("opens the copy kept of the page", async () => {
    const fetched: string[] = [];
    const keptAs: [string, Uint8Array][] = [];
    expect(
      await asksOfOutsideLink("instrument://page/weekly", {
        fetchPage: (id) => {
          fetched.push(id);
          return handed();
        },
        keepPage: (id, bytes) => {
          keptAs.push([id, bytes]);
          return kept(id);
        },
      }),
    ).toEqual([
      { hostPath: "/Users/mac-user/Downloads/weekly.html", type: "openFile" },
    ]);
    expect(fetched).toEqual(["weekly"]);
    expect(keptAs).toEqual([["weekly", body]]);
  });

  it("says the host did not answer, keeping nothing", async () => {
    let keeps = 0;
    expect(
      await asksOfOutsideLink("instrument://page/weekly", {
        fetchPage: refused,
        keepPage: (id) => {
          keeps += 1;
          return kept(id);
        },
      }),
    ).toEqual([
      {
        host: "weekly.instrument.page",
        type: "pageNotOpened",
        why: "noAnswer",
      },
    ]);
    expect(keeps).toBe(0);
  });

  it("says when no copy could be kept", async () => {
    expect(
      await asksOfOutsideLink("instrument://page/weekly", {
        fetchPage: handed,
        keepPage: () => Promise.reject(new Error("EACCES")),
      }),
    ).toEqual([
      { host: "weekly.instrument.page", type: "pageNotOpened", why: "notKept" },
    ]);
  });

  it("passes the gate once and asks the window to open the file", async () => {
    const gated: string[] = [];
    const asked: unknown[] = [];
    const logged: string[] = [];
    await openOutsideLink("instrument://page/weekly", {
      ask: (asks) => asked.push(asks),
      checks: { fetchPage: handed, keepPage: kept },
      gate: (each) => {
        gated.push(each);
        return true;
      },
      log: (line) => logged.push(line),
      waiting: () => 0,
    });
    expect(gated).toEqual(["instrument://page/weekly"]);
    expect(logged).toEqual(["A page link asks the window to openFile"]);
    expect(asked).toEqual([
      [{ hostPath: "/Users/mac-user/Downloads/weekly.html", type: "openFile" }],
    ]);
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

  it("asks for everything a link to several files names at once, past the gate once", async () => {
    const gated: string[] = [];
    const calls: unknown[] = [];
    const logged: string[] = [];
    const url =
      "instrument://files?path=%2Fhome%2Flinux-user%2Fa.md&path=%2Fhome%2Flinux-user%2Fb.md";
    await openOutsideLink(url, {
      ask: (asks) => calls.push(asks),
      checks: { hostPaths: path.posix, isRefused: allowed, placeOf: aFile },
      gate: (each) => {
        gated.push(each);
        return true;
      },
      log: (line) => logged.push(line),
      waiting: () => 0,
    });
    expect(gated).toEqual([url]);
    expect(logged).toEqual([
      "A files link asks the window to openFile, openFile",
    ]);
    expect(calls).toMatchInlineSnapshot(`
      [
        [
          {
            "hostPath": "/home/linux-user/a.md",
            "type": "openFile",
          },
          {
            "hostPath": "/home/linux-user/b.md",
            "type": "openFile",
          },
        ],
      ]
    `);
  });

  it("says what each link came to, by its noun alone", async () => {
    expect(await open("instrument://new?text=private%20words"))
      .toMatchInlineSnapshot(`
        {
          "asked": [
            [
              {
                "type": "newChat",
                "words": "private words",
              },
            ],
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
