import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { askOfOutsideLink, createLinkGate } from "./outside-links";

// A link from outside can come from any site the person visits, so it puts
// something in front of them and nothing more: no path past a plain
// absolute one, no refused place, and no page run straight from a link.

let folder: string;

beforeAll(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "outside-links-"));
  await fs.mkdir(path.join(folder, "Notes"));
});

afterAll(async () => {
  await fs.rm(folder, { force: true, recursive: true });
});

const allowed = () => Promise.resolve(false);

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

  it("shows a page selected in its folder rather than opening it", async () => {
    expect(
      await askOfOutsideLink(
        "instrument://file/Users/mac-user/Downloads/page.html",
        { hostPaths: path.posix, isRefused: allowed },
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
        { hostPaths: path.win32, isRefused: allowed },
      ),
    ).toEqual({
      hostPath: "C:\\Users\\windows-user\\report.pdf",
      type: "openFile",
    });
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

  it("opens nothing in a place the app refuses", async () => {
    expect(
      await askOfOutsideLink("instrument://file/Users/mac-user/a.md", {
        hostPaths: path.posix,
        isRefused: () => Promise.resolve(true),
      }),
    ).toBeUndefined();
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
