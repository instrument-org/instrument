import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { watchHostFile } from "./watch-host-file";

const INTERVAL_MS = 20;

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "watch-host-file-test-"));
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

function watch(filePath: string, signal: AbortSignal) {
  return watchHostFile({ intervalMs: INTERVAL_MS, path: filePath, signal });
}

describe("watchHostFile", () => {
  it("reports a file that is already there, then each write to it", async () => {
    const page = path.join(root, "page.html");
    await fs.writeFile(page, "<p>one</p>");
    const controller = new AbortController();
    const seen: (null | { modifiedAt: number })[] = [];

    for await (const value of watch(page, controller.signal)) {
      seen.push(value);
      if (seen.length === 1) {
        // A write inside the same stat tick would carry the same mtime.
        await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
        await fs.writeFile(page, "<p>two</p>");
      } else {
        controller.abort();
      }
    }

    expect(seen).toHaveLength(2);
    expect(seen[0]?.modifiedAt).toBeTypeOf("number");
    expect(seen[1]?.modifiedAt).toBeGreaterThan(seen[0]?.modifiedAt ?? 0);
  });

  it("starts on a file that is not there yet and reports it appearing", async () => {
    const page = path.join(root, "late.html");
    const controller = new AbortController();
    const seen: (null | { modifiedAt: number })[] = [];

    for await (const value of watch(page, controller.signal)) {
      seen.push(value);
      if (value === null) {
        await fs.writeFile(page, "<p>arrived</p>");
      } else {
        controller.abort();
      }
    }

    expect(seen[0]).toBeNull();
    expect(seen.at(-1)?.modifiedAt).toBeTypeOf("number");
  });

  it("reports a file taken away as gone", async () => {
    const page = path.join(root, "page.html");
    await fs.writeFile(page, "<p>one</p>");
    const controller = new AbortController();
    const seen: (null | { modifiedAt: number })[] = [];

    for await (const value of watch(page, controller.signal)) {
      seen.push(value);
      if (value === null) {
        controller.abort();
      } else {
        await fs.rm(page);
      }
    }

    expect(seen[0]).not.toBeNull();
    expect(seen.at(-1)).toBeNull();
  });
});
