import { Hono } from "hono";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { serveStaticFile } from "./serve-static";

describe("serveStaticFile", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "serve-static-"));
    await fs.writeFile(path.join(root, "style.css"), "plain");
  });

  afterEach(async () => {
    await fs.rm(root, { force: true, recursive: true });
  });

  it("serves nothing for a folder", async () => {
    const app = new Hono();
    app.get("/*", async (c) => {
      const result = await serveStaticFile(c, {
        filePath: root,
        onFound: () => undefined,
      });
      return result ?? c.notFound();
    });
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(404);
  });

  it("streams only the requested byte range", async () => {
    const response = await requestStatic({
      headers: { range: "bytes=1-3" },
    });

    expect(response.status).toBe(206);
    await expect(response.text()).resolves.toBe("lai");
    expect(response.headers.get("content-length")).toBe("3");
    expect(response.headers.get("content-range")).toBe("bytes 1-3/5");
  });

  // A range ending past the file is the rest of the file (RFC 9110 14.1.2);
  // only one starting past it can't be met.
  it.each([
    ["bytes=0-4095", 206, "plain", "bytes 0-4/5"],
    ["bytes=2-", 206, "ain", "bytes 2-4/5"],
    ["bytes=4-9", 206, "n", "bytes 4-4/5"],
    ["bytes=5-9", 416, "", null],
    ["bytes=3-1", 416, "", null],
  ])("answers %s with %i", async (range, status, body, contentRange) => {
    const response = await requestStatic({
      headers: { range },
    });

    expect(response.status).toBe(status);
    await expect(response.text()).resolves.toBe(body);
    expect(response.headers.get("content-range")).toBe(contentRange);
  });

  function requestStatic({ headers }: { headers: Record<string, string> }) {
    const app = new Hono();
    app.get("/*", async (c) => {
      const result = await serveStaticFile(c, {
        filePath: path.join(root, "style.css"),
        onFound: () => undefined,
      });
      return result ?? c.notFound();
    });
    return app.request("http://localhost/style.css", {
      headers,
    });
  }
});
