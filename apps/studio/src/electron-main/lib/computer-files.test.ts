import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  computerFileBase,
  handleComputerFileRequest,
  hostPathOfComputerFileUrl,
} from "./computer-files";

let folder: string;
let file: string;
let mtimeMs: number;

const urlFor = (hostPath: string, query = "") =>
  `${computerFileBase()}${hostPath.split("/").map(encodeURIComponent).join("/")}${query}`;

const request = (url: string, init?: RequestInit) =>
  handleComputerFileRequest(new Request(url, init));

beforeAll(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), "computer-files-"));
  file = path.join(folder, "notes.txt");
  await fs.writeFile(file, "hello, computer");
  await fs.mkdir(path.join(folder, ".instrument"));
  await fs.writeFile(path.join(folder, ".instrument", "task.db"), "secret");
  mtimeMs = (await fs.stat(file)).mtimeMs;
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

  it("does not let an unversioned read be kept", async () => {
    const response = await request(urlFor(file));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

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
      () => urlFor(path.join(folder, ".instrument", "task.db")),
    ],
    [
      "the private directory in another case",
      () => urlFor(path.join(folder, ".INSTRUMENT", "task.db")),
    ],
    // A literal `..` never reaches the handler: URL parsing collapses it, so
    // the request names whatever the collapsed path is. The encoded spelling
    // survives parsing and is the one the decode has to catch.
    [
      "a percent-encoded traversal",
      () => `${computerFileBase()}${folder}/%2E%2E/notes.txt`,
    ],
    ["an empty path", () => `${computerFileBase()}/`],
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
 * that are true only by absence: agent-authored HTML runs in a frame with no
 * origin of its own, and the preload bridge that hands the renderer the token
 * loads in the top frame alone. Either one flipped for an unrelated reason
 * hands the token to agent HTML with nothing else failing, so they are pinned
 * here, beside the channel they protect.
 */
describe("what the token rests on", () => {
  const studioSrc = path.resolve(__dirname, "../..");

  it("the artifact preview never grants agent HTML an origin", async () => {
    const source = await fs.readFile(
      path.join(studioSrc, "client/components/sandboxed-html-iframe.tsx"),
      "utf8",
    );
    expect(source).not.toContain("allow-same-origin");
  });

  it("no window loads the preload bridge into sub-frames", async () => {
    const entries = await fs.readdir(path.join(studioSrc, "electron-main"), {
      recursive: true,
      withFileTypes: true,
    });
    const offenders: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) {
        continue;
      }
      const filePath = path.join(entry.parentPath, entry.name);
      const source = await fs.readFile(filePath, "utf8");
      if (/nodeIntegrationInSubFrames\s*:\s*true/.test(source)) {
        offenders.push(path.relative(studioSrc, filePath));
      }
    }
    expect(offenders).toEqual([]);
  });
});
