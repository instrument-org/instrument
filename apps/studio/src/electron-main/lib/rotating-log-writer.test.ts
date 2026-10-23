import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { boundedLogLine, createRotatingLogWriter } from "./rotating-log-writer";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rotating-log-"));
  directories.push(dir);
  const file = path.join(dir, "main.log");
  const archive = path.join(dir, "main.old.log");
  return { archive, dir, file };
}

describe("rotating log writer", () => {
  it("rotates asynchronous bursts before either file exceeds its byte limit", async () => {
    const { archive, file } = await fixture();
    const limit = 128 * 1024;
    const writer = createRotatingLogWriter(() => file, limit);
    for (let batch = 0; batch < 4; batch++) {
      for (let index = 0; index < 100; index++) writer.write("🙂".repeat(8000));
      await writer.flush();
    }
    for (const candidate of [file, archive]) {
      expect((await fs.stat(candidate)).size).toBeLessThanOrEqual(limit);
      expect(await fs.readFile(candidate, "utf8")).not.toContain("�");
    }
  });

  it("bounds pending bytes while a write is blocked", async () => {
    const { file } = await fixture();
    const append = fs.appendFile.bind(fs);
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(fs, "appendFile").mockImplementation(async (...args) => {
      await blocked;
      return append(...args);
    });
    const writer = createRotatingLogWriter(() => file, 8 * 1024 * 1024);
    for (let index = 0; index < 1000; index++) writer.write("x".repeat(32768));
    release?.();
    await writer.flush();
    expect((await fs.stat(file)).size).toBeLessThanOrEqual(1024 * 1024);
  });

  it("repairs oversized retained files", async () => {
    const { archive, file } = await fixture();
    await fs.writeFile(file, "x".repeat(256 * 1024));
    await fs.writeFile(archive, "y".repeat(256 * 1024));
    const writer = createRotatingLogWriter(() => file, 128 * 1024);
    writer.write("next");
    await writer.flush();
    expect((await fs.stat(archive)).size).toBe(128 * 1024);
    expect(await fs.readFile(file, "utf8")).toBe("next\n");
  });

  it("rests after a failed write and retries after a minute", async () => {
    const { file } = await fixture();
    const append = vi
      .spyOn(fs, "appendFile")
      .mockRejectedValueOnce(new Error("ENOSPC"));
    const clock = vi.spyOn(Date, "now").mockReturnValue(0);
    const writer = createRotatingLogWriter(() => file, 128 * 1024);
    writer.write("failed");
    await writer.flush();
    writer.write("while full");
    await writer.flush();
    expect(append).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(60_000);
    writer.write("recovered");
    await writer.flush();
    expect(await fs.readFile(file, "utf8")).toBe("recovered\n");
  });

  it("truncates oversized Unicode entries on a UTF-8 boundary", () => {
    const line = boundedLogLine("🙂".repeat(100_000));
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(64 * 1024);
    expect(line).not.toContain("�");
    expect(line).toContain("[log entry truncated]");
  });
});
