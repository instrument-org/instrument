import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BoundedLogWriter } from "./bounded-log-writer";

describe("BoundedLogWriter", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "bounded-log-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { force: true, recursive: true });
  });

  it("awaits writes and closes with complete content under the limit", async () => {
    const logPath = path.join(testDir, "complete.log");
    const writer = new BoundedLogWriter({
      maxContentBytes: 100,
      path: logPath,
    });

    await writer.write("one\n");
    await writer.write("two\n");
    writer.close();
    await writer.closed;

    await expect(fs.readFile(logPath, "utf8")).resolves.toBe("one\ntwo\n");
    expect(writer.omittedBytes).toBe(0);
  });

  it("keeps the file bounded and records omitted output", async () => {
    const logPath = path.join(testDir, "bounded.log");
    const writer = new BoundedLogWriter({
      maxContentBytes: 5,
      path: logPath,
    });

    await writer.write("abc");
    await writer.write("defgh");
    writer.close();
    await writer.closed;

    const content = await fs.readFile(logPath, "utf8");
    expect(content).toMatchInlineSnapshot(`
      "abcde
      [3 bytes omitted because this background log reached its size limit]
      "
    `);
    expect(writer.omittedBytes).toBe(3);
    expect(Buffer.byteLength(content, "utf8")).toBeLessThan(100);
  });

  it("does not split UTF-8 when the limit falls inside a character", async () => {
    const logPath = path.join(testDir, "utf8.log");
    const writer = new BoundedLogWriter({
      maxContentBytes: 3,
      path: logPath,
    });

    await writer.write("a€");
    await writer.write("b");
    writer.close();
    await writer.closed;

    expect(writer.omittedBytes).toBe(4);
    await expect(fs.readFile(logPath, "utf8")).resolves.toContain("a\n[");
    await expect(fs.readFile(logPath, "utf8")).resolves.not.toContain("ab");
  });

  it("does not expose the host path in write errors", async () => {
    const logPath = path.join(testDir, "missing", "private-name.log");
    const writer = new BoundedLogWriter({
      maxContentBytes: 100,
      path: logPath,
    });

    await writer.write("content");
    await writer.closed;

    expect(writer.errorMessage).toBe(
      "Could not write the background process log (ENOENT).",
    );
    expect(writer.errorMessage).not.toContain(logPath);
  });
});
