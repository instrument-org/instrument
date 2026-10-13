import { Hono } from "hono";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { serveStaticFile } from "./serve-static";

describe("serveStaticFile", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "serve-static-"));
    await fs.writeFile(path.join(root, "style.css"), "plain");
    await fs.writeFile(path.join(root, "style.css.br"), "compressed");
  });

  afterEach(async () => {
    await fs.rm(root, { force: true, recursive: true });
  });

  it("serves precompressed content with the original MIME type and live mtime", async () => {
    const response = await requestStatic();

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("compressed");
    expect(response.headers.get("content-encoding")).toBe("br");
    expect(response.headers.get("content-type")).toBe("text/css");
    const compressedStats = await fs.stat(path.join(root, "style.css.br"));
    expect(response.headers.get("last-modified")).toBe(
      compressedStats.mtime.toUTCString(),
    );
  });

  it("checks the final precompressed path before opening it", async () => {
    const isPathAllowed = vi.fn(() => false);
    const response = await requestStatic({ isPathAllowed });

    expect(response.status).toBe(404);
    expect(isPathAllowed).toHaveBeenCalledWith(path.join(root, "style.css.br"));
  });

  it("streams only the requested byte range", async () => {
    const response = await requestStatic({
      headers: { range: "bytes=1-3" },
      precompressed: false,
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
      precompressed: false,
    });

    expect(response.status).toBe(status);
    await expect(response.text()).resolves.toBe(body);
    expect(response.headers.get("content-range")).toBe(contentRange);
  });

  function requestStatic({
    headers = { "accept-encoding": "br" },
    isPathAllowed,
    precompressed = true,
  }: {
    headers?: Record<string, string>;
    isPathAllowed?: (filePath: string) => boolean;
    precompressed?: boolean;
  } = {}) {
    const app = new Hono();
    app.get("/*", async (c) => {
      const result = await serveStaticFile(c, {
        filePath: path.join(root, "style.css"),
        isPathAllowed,
        precompressed,
      });
      return result ?? c.notFound();
    });
    return app.request("http://localhost/style.css", {
      headers,
    });
  }
});
