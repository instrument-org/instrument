import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { readLogTail } from "./diagnostic-log";

/**
 * Real files rather than a mocked `fs`, because what is being tested is the
 * arithmetic against a file's actual size and the bytes actually at an offset.
 * A mock would answer with whatever the test already assumed.
 */
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "diagnostic-log-"));

afterAll(() => {
  fs.rmSync(directory, { force: true, recursive: true });
});

function writeLog(name: string, contents: string): string {
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, contents);
  return filePath;
}

describe("readLogTail", () => {
  it("returns the whole file when it is shorter than the cap", () => {
    const filePath = writeLog("short.log", "first\nsecond\nthird\n");

    expect(readLogTail(filePath)).toEqual({
      text: "first\nsecond\nthird\n",
      totalBytes: 19,
      truncated: false,
    });
  });

  // The case the byte cap exists for. What matters is that the end survives,
  // that the size reported is the whole file rather than the slice, and that
  // the slice is announced as one.
  it("keeps the end of a file past the cap and says it did", () => {
    const line = `${"x".repeat(99)}\n`;
    const lineCount = 4000;
    const filePath = writeLog("long.log", line.repeat(lineCount));

    const tail = readLogTail(filePath);

    expect(tail?.truncated).toBe(true);
    expect(tail?.totalBytes).toBe(line.length * lineCount);
    expect(tail?.text.endsWith(line)).toBe(true);
    // Under the cap, because a byte offset lands mid-line and that first
    // partial line is dropped rather than shown.
    expect(tail?.text.length).toBeLessThan(256 * 1024);
    expect(tail?.text.length).toBeGreaterThan(256 * 1024 - line.length - 1);
  });

  // A byte offset has no idea where a line starts, so the first line in the
  // slice is normally half a line. Showing it reads as a corrupted file.
  it("drops the partial first line rather than showing half of one", () => {
    const filePath = writeLog(
      "partial.log",
      `${"a".repeat(300 * 1024)}\nCOMPLETE LINE\n`,
    );

    const tail = readLogTail(filePath);

    expect(tail?.truncated).toBe(true);
    expect(tail?.text).toBe("COMPLETE LINE\n");
  });

  // Every one of these is an ordinary state on a build whose log has not been
  // written yet, and none of them may throw: the caller is a button.
  it.each([
    { name: "a path that does not exist", setup: () => "/nowhere/at/all.log" },
    { name: "no path at all", setup: () => undefined },
    { name: "a directory", setup: () => directory },
  ])("answers with nothing for $name", ({ setup }) => {
    expect(readLogTail(setup())).toBeUndefined();
  });

  it("reads an empty file as empty rather than missing", () => {
    const filePath = writeLog("empty.log", "");

    expect(readLogTail(filePath)).toEqual({
      text: "",
      totalBytes: 0,
      truncated: false,
    });
  });

  // Multi-byte characters straddle the offset the same way lines do. Dropping
  // the partial first line takes the broken character with it, so nothing
  // downstream has to cope with a replacement character mid-word.
  it("survives a file whose text is not ASCII", () => {
    const filePath = writeLog("utf8.log", "héllo wörld\nsecond ✓\n");

    expect(readLogTail(filePath)?.text).toBe("héllo wörld\nsecond ✓\n");
  });
});
