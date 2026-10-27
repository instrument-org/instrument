import { execa } from "execa";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { descendantsOf, isInside, stopProcessesIn } from "./process-guard";

describe("descendantsOf", () => {
  it("finds children's children and nothing beside them", () => {
    const table = [
      { pid: 2, ppid: 1, rssBytes: 0 },
      { pid: 3, ppid: 2, rssBytes: 0 },
      { pid: 4, ppid: 3, rssBytes: 0 },
      { pid: 5, ppid: 1, rssBytes: 0 },
    ];
    expect(descendantsOf(table, 2).map(({ pid }) => pid)).toEqual([3, 4]);
  });
});

describe("isInside", () => {
  it.each([
    { cwd: "/tmp/case", expected: true },
    { cwd: "/tmp/case/site", expected: true },
    { cwd: "/tmp/case-2", expected: false },
    { cwd: "/tmp", expected: false },
  ])("$cwd in /tmp/case: $expected", ({ cwd, expected }) => {
    expect(isInside(cwd, ["/tmp/case"])).toBe(expected);
  });
});

// Read through `lsof` or `/proc`, which Windows has neither of; there the
// guard finds nothing and stops nothing.
describe.skipIf(process.platform === "win32")("stopProcessesIn", () => {
  it("stops a program left running in the folder, and only it", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "process-guard-"));
    const other = await fs.mkdtemp(path.join(os.tmpdir(), "process-guard-"));
    const left = execa("sleep", ["30"], { cwd: folder, reject: false });
    const kept = execa("sleep", ["30"], { cwd: other, reject: false });
    try {
      // `lsof` sees a process once it has started.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await stopProcessesIn([folder])).toBe(1);
      expect((await left).isTerminated).toBe(true);
      expect(kept.exitCode).toBeNull();
    } finally {
      kept.kill();
      await kept;
      await fs.rm(folder, { force: true, recursive: true });
      await fs.rm(other, { force: true, recursive: true });
    }
  });
});
