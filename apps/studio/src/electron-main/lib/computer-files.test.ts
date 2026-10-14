import { app } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  computerFileBase,
  handleComputerFileRequest,
  hostPathOfComputerFileUrl,
} from "./computer-files";
import { fileThumbnail } from "./file-thumbnails";

vi.mock(import("./file-thumbnails"), async (importOriginal) => ({
  ...(await importOriginal()),
  fileThumbnail: vi.fn(),
  fileThumbnailDeps: () => ({ dir: "" }),
}));

let folder: string;
let file: string;
let mtimeMs: number;
/** This computer's folder, Electron's userData. */
let machine: string;

const urlFor = (hostPath: string, query = "") =>
  `${computerFileBase()}${hostPath.split("/").map(encodeURIComponent).join("/")}${query}`;

const request = (url: string, init?: RequestInit) =>
  handleComputerFileRequest(new Request(url, init));

beforeAll(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "computer-files-"));
  file = path.join(folder, "notes.txt");
  await fs.writeFile(file, "hello, computer");
  await fs.mkdir(path.join(folder, ".instrument"));
  await fs.writeFile(path.join(folder, ".instrument", "chat.db"), "secret");
  const stats = await fs.stat(file);
  mtimeMs = stats.mtimeMs;

  machine = path.join(folder, "machine");
  vi.spyOn(app, "getPath").mockImplementation((name) =>
    name === "userData" ? machine : "/mock/path",
  );
  const machineFiles = {
    attachment: "workspace/.instrument/chats/2026-10-01-chat/attachments/a.png",
    "browser-cookies": "workspaces-data/default/browser/app-session/Cookies",
    "chat-db": "workspace/.instrument/chats/2026-10-01-chat/chat.db",
    keys: "workspaces-data/default/keys/providers.json",
    note: "workspace/Reports/notes.md",
  };
  for (const relative of Object.values(machineFiles)) {
    await fs.mkdir(path.dirname(path.join(machine, relative)), {
      recursive: true,
    });
    await fs.writeFile(path.join(machine, relative), relative);
  }
  await fs.symlink(
    path.join(machine, machineFiles.keys),
    path.join(folder, "leads-to-keys.json"),
  );
});

afterAll(async () => {
  await fs.rm(folder, { force: true, recursive: true });
});

describe("handleComputerFileRequest", () => {
  it("serves a file by its host path, immutable when the version names its mtime", async () => {
    const response = await request(urlFor(file, `?version=${mtimeMs}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toMatch(/^text\/plain/);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response.text()).toBe("hello, computer");
  });

  // On a Mac or Linux a backslash is a character a name can hold.
  it.skipIf(process.platform === "win32")(
    "serves a file whose name holds a backslash",
    async () => {
      const named = path.join(folder, "a\\b.html");
      await fs.writeFile(named, "<p>a or b</p>");
      const response = await request(urlFor(named));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("<p>a or b</p>");
    },
  );

  it.each([
    ["the person's own file", "workspace/Reports/notes.md"],
    [
      "what a chat was sent, in the workspace's .instrument/",
      "workspace/.instrument/chats/2026-10-01-chat/attachments/a.png",
    ],
  ])(
    "serves %s in a workspace the machine folder keeps",
    async (_name, relative) => {
      const response = await request(urlFor(path.join(machine, relative)));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(relative);
    },
  );

  it("does not let an unversioned read be kept", async () => {
    const response = await request(urlFor(file));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each([
    [true, "public, max-age=31536000, immutable"],
    [false, "no-store"],
  ])(
    "answers a versioned thumbnail drawn complete: %s with %s",
    async (complete, cacheControl) => {
      vi.mocked(fileThumbnail).mockResolvedValueOnce({
        complete,
        png: Buffer.from("png"),
      });
      const response = await request(
        urlFor(file, `?thumbnail=512&version=${mtimeMs}`),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe(cacheControl);
    },
  );

  it("answers a range with the slice and the whole's size", async () => {
    const response = await request(urlFor(file), {
      headers: { Range: "bytes=0-4" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 0-4/15");
    expect(await response.text()).toBe("hello");
  });

  it("answers HEAD with the length and no body", async () => {
    const response = await request(urlFor(file), { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("15");
    expect(await response.text()).toBe("");
  });

  it.each([
    [
      "a wrong token",
      () => urlFor(file).replace(/computer-[a-f0-9]+/, "computer-0"),
    ],
    ["a folder", () => urlFor(folder)],
    ["a missing file", () => urlFor(path.join(folder, "gone.txt"))],
    [
      "the private directory",
      () => urlFor(path.join(folder, ".instrument", "chat.db")),
    ],
    [
      "the private directory in another case",
      () => urlFor(path.join(folder, ".INSTRUMENT", "chat.db")),
    ],
    [
      "a chat's database beside what it was sent",
      () =>
        urlFor(
          path.join(
            machine,
            "workspace",
            ".instrument",
            "chats",
            "2026-10-01-chat",
            "chat.db",
          ),
        ),
    ],
    // A literal `..` never reaches the handler: URL parsing collapses it, so
    // the request names whatever the collapsed path is. The encoded spelling
    // survives parsing and is the one the decode has to catch.
    [
      "a percent-encoded traversal",
      () => `${computerFileBase()}${folder}/%2E%2E/notes.txt`,
    ],
    ["an empty path", () => `${computerFileBase()}/`],
    // The machine folder's names carry no private segment.
    [
      "a workspace's keys",
      () =>
        urlFor(
          path.join(
            machine,
            "workspaces-data",
            "default",
            "keys",
            "providers.json",
          ),
        ),
    ],
    [
      "a browser profile's cookies",
      () =>
        urlFor(
          path.join(
            machine,
            "workspaces-data",
            "default",
            "browser",
            "app-session",
            "Cookies",
          ),
        ),
    ],
    [
      "the machine folder in another case",
      () =>
        urlFor(
          path.join(
            machine,
            "WORKSPACES-DATA",
            "default",
            "keys",
            "providers.json",
          ),
        ),
    ],
    [
      "a symlink into the machine folder",
      () => urlFor(path.join(folder, "leads-to-keys.json")),
    ],
  ])("refuses %s", async (_name, url) => {
    const response = await request(url());
    expect(response.status).toBe(404);
  });

  it("refuses every method but GET and HEAD", async () => {
    const response = await request(urlFor(file), { method: "POST" });
    expect(response.status).toBe(404);
  });
});

describe("hostPathOfComputerFileUrl", () => {
  it("decodes each segment once", () => {
    const url = new URL(urlFor(path.join(folder, "Smith, John #2.pdf")));
    expect(hostPathOfComputerFileUrl(url)).toBe(
      path.join(folder, "Smith, John #2.pdf"),
    );
  });

  // A backslash separates names in a Windows path, and in every path on
  // Windows, so there `..\` climbs out of the folder before it.
  it.each([
    ["a Windows path", "/C:/Users/sam/Documents/..%5C..%5Ckey.txt", path.win32],
    ["a rooted path on Windows", "/Users/sam/..%5C..%5Ckey.txt", path.win32],
  ])("refuses a backslash traversal in %s", (_name, pathname, hostPaths) => {
    const url = new URL(`${computerFileBase()}${pathname}`);
    expect(
      hostPathOfComputerFileUrl(url, undefined, hostPaths),
    ).toBeUndefined();
  });

  it.skipIf(process.platform !== "win32")(
    "keeps a drive letter as the first segment",
    () => {
      const url = new URL(`${computerFileBase()}/C%3A/Users/sam/notes.txt`);
      expect(hostPathOfComputerFileUrl(url)).toBe("C:\\Users\\sam\\notes.txt");
    },
  );
});

/**
 * The token is what keeps the channel the person's, and it rests on two facts
 * that are true only by absence: no frame in the app's own session grants
 * content it did not write an origin, and the preload bridge that hands the
 * renderer the token loads in the top frame alone. Either one flipped for an
 * unrelated reason hands the token to agent HTML with nothing else failing,
 * so they are pinned here, beside the channel they protect.
 */
describe("what the token rests on", () => {
  const studioSrc = path.resolve(import.meta.dirname, "../..");

  it("no frame in the renderer grants embedded content an origin", async () => {
    const offenders = await filesMatching(
      path.join(studioSrc, "client"),
      /allow-same-origin/,
    );
    expect(offenders).toEqual([]);
  });

  it("no window loads the preload bridge into sub-frames", async () => {
    const offenders = await filesMatching(
      path.join(studioSrc, "electron-main"),
      /nodeIntegrationInSubFrames\s*:\s*true/,
    );
    expect(offenders).toEqual([]);
  });

  /** Source files under a tree, minus tests, whose text matches. */
  async function filesMatching(root: string, pattern: RegExp) {
    const entries = await fs.readdir(root, {
      recursive: true,
      withFileTypes: true,
    });
    const offenders: string[] = [];
    for (const entry of entries) {
      if (
        !entry.isFile() ||
        !/\.tsx?$/.test(entry.name) ||
        /\.test\.tsx?$/.test(entry.name)
      ) {
        continue;
      }
      const filePath = path.join(entry.parentPath, entry.name);
      const source = await fs.readFile(filePath, "utf8");
      if (pattern.test(source)) {
        offenders.push(path.relative(studioSrc, filePath));
      }
    }
    return offenders;
  }
});
